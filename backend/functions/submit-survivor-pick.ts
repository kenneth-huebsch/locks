import {
  GetCommand,
  TransactWriteCommand,
  type GetCommandOutput,
  type TransactWriteCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  gameSortKey,
  playerPartitionKey,
  seasonWeekToken,
  survivorChallengePartitionKey,
  survivorPickGsi1SortKey,
  survivorPickSortKey,
  survivorPlayerSortKey,
  SURVIVOR_META_SORT_KEY,
  weekPartitionKey,
  pickGsi1PartitionKey,
} from '../../shared/dynamo.js';
import {
  ErrorCodes,
  type ApiErrorResponse,
  type ErrorCode,
  type NotifySurvivorPickEvent,
  type SubmitSurvivorPickRequest,
  type SubmitSurvivorPickResponse,
  type SurvivorPick,
} from '../../shared/types.js';

export interface Clock {
  now(): Date;
}

export interface DynamoSubmitSurvivorClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
}

export interface ApiGatewayJwtEvent {
  body?: string;
  requestContext: {
    authorizer?: {
      jwt?: {
        claims: Record<string, string>;
      };
    };
  };
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

const GAME_CONDITION_EXPRESSION =
  'attribute_exists(PK) AND commenceTime > :now AND ' +
  '(awayTeam = :pickedTeam OR homeTeam = :pickedTeam)';

interface SubmitSurvivorDependencies {
  dynamoClient: DynamoSubmitSurvivorClient;
  clock: Clock;
  tableName: string;
  fallbackSeason?: number;
  fallbackWeek?: number;
  notifySurvivorPick?: (event: NotifySurvivorPickEvent) => Promise<void>;
  logger?: Pick<Console, 'error'>;
}

function parseRequest(body: string | undefined): SubmitSurvivorPickRequest | null {
  if (!body) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as SubmitSurvivorPickRequest).gameId !== 'string' ||
    (parsed as SubmitSurvivorPickRequest).gameId.length === 0 ||
    typeof (parsed as SubmitSurvivorPickRequest).pickedTeam !== 'string' ||
    (parsed as SubmitSurvivorPickRequest).pickedTeam.length === 0
  ) {
    return null;
  }

  return parsed as SubmitSurvivorPickRequest;
}

function errorResponse(
  statusCode: number,
  code: ErrorCode,
  message: string,
): LambdaResponse {
  const response: ApiErrorResponse = {
    error: { code, message },
  };

  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(response),
  };
}

function successResponse(pick: SurvivorPick): LambdaResponse {
  const response: SubmitSurvivorPickResponse = { pick };
  return {
    statusCode: 201,
    headers: JSON_HEADERS,
    body: JSON.stringify(response),
  };
}

function getPlayerSub(event: ApiGatewayJwtEvent): string | null {
  const sub = event.requestContext.authorizer?.jwt?.claims.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

type CancellationReason = { Code?: string; code?: string };

function getCancellationReasons(error: unknown): CancellationReason[] {
  if (!error || typeof error !== 'object') {
    return [];
  }
  const candidate = error as {
    CancellationReasons?: CancellationReason[];
    cancellationReasons?: CancellationReason[];
  };
  return (
    candidate.CancellationReasons ?? candidate.cancellationReasons ?? []
  );
}

function isTransactionCanceledError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { name?: string; __type?: string };
  const name = candidate.name ?? candidate.__type ?? '';
  if (
    name === 'TransactionCanceledException' ||
    name.endsWith('#TransactionCanceledException') ||
    name.includes('TransactionCanceled')
  ) {
    return true;
  }
  return getCancellationReasons(error).length > 0;
}

function cancellationReasonCode(
  reason: CancellationReason | undefined,
): string | undefined {
  return reason?.Code ?? reason?.code;
}

function conflictMessage(code: ErrorCode): string {
  switch (code) {
    case ErrorCodes.GAME_STARTED:
      return 'This game has already started';
    case ErrorCodes.GAME_NOT_FOUND:
      return 'Game not found';
    case ErrorCodes.SURVIVOR_ELIMINATED:
      return 'You have been eliminated from survivor';
    case ErrorCodes.TEAM_ALREADY_USED:
      return 'You have already used this team in survivor';
    case ErrorCodes.SURVIVOR_ALREADY_PICKED:
      return 'You have already submitted a survivor pick this week';
    case ErrorCodes.TEAM_ON_BYE:
      return 'That team is not playing this week';
    case ErrorCodes.CHALLENGE_COMPLETE:
      return 'The survivor challenge is already complete';
    case ErrorCodes.SURVIVOR_NOT_CONFIGURED:
      return 'Survivor challenge is not configured for this season';
    default:
      return 'Survivor pick submission conflict';
  }
}

export function createSubmitSurvivorPickHandler(
  dependencies: SubmitSurvivorDependencies,
): (event: ApiGatewayJwtEvent) => Promise<LambdaResponse> {
  const logger = dependencies.logger ?? console;
  const fallbackSeason = dependencies.fallbackSeason ?? 2026;
  const fallbackWeek = dependencies.fallbackWeek ?? 1;

  return async (event) => {
    const playerSub = getPlayerSub(event);
    if (!playerSub) {
      return errorResponse(
        500,
        ErrorCodes.INTERNAL_ERROR,
        'Authenticated player identity is missing',
      );
    }

    const request = parseRequest(event.body);
    if (!request) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: { message: 'Invalid request body' },
        }),
      };
    }

    try {
      const seasonResult = await dependencies.dynamoClient.send(
        new GetCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: ACTIVE_SEASON_PARTITION_KEY,
            SK: ACTIVE_SEASON_SORT_KEY,
          },
        }),
      );

      const season =
        typeof seasonResult.Item?.season === 'number'
          ? seasonResult.Item.season
          : fallbackSeason;
      const week =
        typeof seasonResult.Item?.week === 'number'
          ? seasonResult.Item.week
          : fallbackWeek;

      const nowIso = dependencies.clock.now().toISOString();
      const seasonWeek = seasonWeekToken(season, week);
      const weekPk = weekPartitionKey(season, week);
      const gameSk = gameSortKey(request.gameId);
      const challengePk = survivorChallengePartitionKey(season);
      const playerStateSk = survivorPlayerSortKey(playerSub);
      const pickSk = survivorPickSortKey(season, week);
      const playerPk = playerPartitionKey(playerSub);

      const [challengeMeta, playerState, gameResult] = await Promise.all([
        dependencies.dynamoClient.send(
          new GetCommand({
            TableName: dependencies.tableName,
            Key: { PK: challengePk, SK: SURVIVOR_META_SORT_KEY },
          }),
        ),
        dependencies.dynamoClient.send(
          new GetCommand({
            TableName: dependencies.tableName,
            Key: { PK: challengePk, SK: playerStateSk },
          }),
        ),
        dependencies.dynamoClient.send(
          new GetCommand({
            TableName: dependencies.tableName,
            Key: { PK: weekPk, SK: gameSk },
          }),
        ),
      ]);

      if (!challengeMeta.Item) {
        return errorResponse(
          409,
          ErrorCodes.SURVIVOR_NOT_CONFIGURED,
          conflictMessage(ErrorCodes.SURVIVOR_NOT_CONFIGURED),
        );
      }

      if (challengeMeta.Item.status === 'complete') {
        return errorResponse(
          409,
          ErrorCodes.CHALLENGE_COMPLETE,
          conflictMessage(ErrorCodes.CHALLENGE_COMPLETE),
        );
      }

      if (!playerState.Item || playerState.Item.status !== 'alive') {
        return errorResponse(
          409,
          ErrorCodes.SURVIVOR_ELIMINATED,
          conflictMessage(ErrorCodes.SURVIVOR_ELIMINATED),
        );
      }

      const usedTeams = Array.isArray(playerState.Item.usedTeams)
        ? (playerState.Item.usedTeams as string[])
        : [];
      if (usedTeams.includes(request.pickedTeam)) {
        return errorResponse(
          409,
          ErrorCodes.TEAM_ALREADY_USED,
          conflictMessage(ErrorCodes.TEAM_ALREADY_USED),
        );
      }

      if (!gameResult.Item) {
        return errorResponse(
          404,
          ErrorCodes.GAME_NOT_FOUND,
          conflictMessage(ErrorCodes.GAME_NOT_FOUND),
        );
      }

      const awayTeam = gameResult.Item.awayTeam;
      const homeTeam = gameResult.Item.homeTeam;
      if (
        request.pickedTeam !== awayTeam &&
        request.pickedTeam !== homeTeam
      ) {
        return errorResponse(
          409,
          ErrorCodes.TEAM_ON_BYE,
          conflictMessage(ErrorCodes.TEAM_ON_BYE),
        );
      }

      const commenceTime = gameResult.Item.commenceTime;
      if (typeof commenceTime === 'string' && commenceTime <= nowIso) {
        return errorResponse(
          409,
          ErrorCodes.GAME_STARTED,
          conflictMessage(ErrorCodes.GAME_STARTED),
        );
      }

      const pick: SurvivorPick = {
        playerId: playerSub,
        gameId: request.gameId,
        seasonWeek,
        pickedTeam: request.pickedTeam,
        submittedAt: nowIso,
        result: 'pending',
      };

      try {
        await dependencies.dynamoClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                ConditionCheck: {
                  TableName: dependencies.tableName,
                  Key: { PK: weekPk, SK: gameSk },
                  ConditionExpression: GAME_CONDITION_EXPRESSION,
                  ExpressionAttributeValues: {
                    ':now': nowIso,
                    ':pickedTeam': request.pickedTeam,
                  },
                },
              },
              {
                ConditionCheck: {
                  TableName: dependencies.tableName,
                  Key: { PK: challengePk, SK: playerStateSk },
                  ConditionExpression:
                    '#status = :alive AND (attribute_not_exists(usedTeams) OR NOT contains(usedTeams, :team))',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: {
                    ':alive': 'alive',
                    ':team': request.pickedTeam,
                  },
                },
              },
              {
                Put: {
                  TableName: dependencies.tableName,
                  Item: {
                    PK: playerPk,
                    SK: pickSk,
                    GSI1PK: pickGsi1PartitionKey(season, week),
                    GSI1SK: survivorPickGsi1SortKey(playerSub),
                    ...pick,
                  },
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
              {
                Update: {
                  TableName: dependencies.tableName,
                  Key: { PK: challengePk, SK: playerStateSk },
                  UpdateExpression:
                    'SET usedTeams = list_append(if_not_exists(usedTeams, :empty), :teamList), updatedAt = :now',
                  ConditionExpression: '#status = :alive',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: {
                    ':empty': [],
                    ':teamList': [request.pickedTeam],
                    ':now': nowIso,
                    ':alive': 'alive',
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isTransactionCanceledError(error)) {
          const reasons = getCancellationReasons(error);
          if (cancellationReasonCode(reasons[0]) === 'ConditionalCheckFailed') {
            const commence =
              typeof gameResult.Item.commenceTime === 'string'
                ? gameResult.Item.commenceTime
                : '';
            if (commence && commence <= nowIso) {
              return errorResponse(
                409,
                ErrorCodes.GAME_STARTED,
                conflictMessage(ErrorCodes.GAME_STARTED),
              );
            }
            return errorResponse(
              409,
              ErrorCodes.GAME_NOT_FOUND,
              conflictMessage(ErrorCodes.GAME_NOT_FOUND),
            );
          }
          if (cancellationReasonCode(reasons[1]) === 'ConditionalCheckFailed') {
            return errorResponse(
              409,
              ErrorCodes.TEAM_ALREADY_USED,
              conflictMessage(ErrorCodes.TEAM_ALREADY_USED),
            );
          }
          if (cancellationReasonCode(reasons[2]) === 'ConditionalCheckFailed') {
            return errorResponse(
              409,
              ErrorCodes.SURVIVOR_ALREADY_PICKED,
              conflictMessage(ErrorCodes.SURVIVOR_ALREADY_PICKED),
            );
          }
          if (cancellationReasonCode(reasons[3]) === 'ConditionalCheckFailed') {
            return errorResponse(
              409,
              ErrorCodes.SURVIVOR_ELIMINATED,
              conflictMessage(ErrorCodes.SURVIVOR_ELIMINATED),
            );
          }
        }
        throw error;
      }

      try {
        await dependencies.notifySurvivorPick?.({
          pickerSub: playerSub,
          gameId: request.gameId,
          pickedTeam: request.pickedTeam,
          season,
          week,
        });
      } catch (notifyError) {
        logger.error('Failed to enqueue survivor pick notification', notifyError);
      }

      return successResponse(pick);
    } catch (error) {
      logger.error('Failed to submit survivor pick', error);
      return errorResponse(
        500,
        ErrorCodes.INTERNAL_ERROR,
        'Unable to submit survivor pick',
      );
    }
  };
}

let runtimeHandler:
  | ((event: ApiGatewayJwtEvent) => Promise<LambdaResponse>)
  | undefined;

async function getRuntimeHandler(): Promise<
  (event: ApiGatewayJwtEvent) => Promise<LambdaResponse>
> {
  if (runtimeHandler) {
    return runtimeHandler;
  }

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME is required');
  }

  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

  const notifyFunctionName = process.env.NOTIFY_SURVIVOR_PICK_FUNCTION_NAME;
  let notifySurvivorPick:
    | ((event: NotifySurvivorPickEvent) => Promise<void>)
    | undefined;
  if (notifyFunctionName) {
    const { InvokeCommand, LambdaClient } = await import(
      '@aws-sdk/client-lambda'
    );
    const lambda = new LambdaClient({});
    notifySurvivorPick = async (
      event: NotifySurvivorPickEvent,
    ): Promise<void> => {
      await lambda.send(
        new InvokeCommand({
          FunctionName: notifyFunctionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify(event)),
        }),
      );
    };
  }

  runtimeHandler = createSubmitSurvivorPickHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    clock: { now: () => new Date() },
    tableName,
    notifySurvivorPick,
  });

  return runtimeHandler;
}

export async function handler(
  event: ApiGatewayJwtEvent,
): Promise<LambdaResponse> {
  const run = await getRuntimeHandler();
  return run(event);
}
