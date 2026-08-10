import {
  GetCommand,
  TransactWriteCommand,
  type GetCommandOutput,
  type TransactWriteCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  counterSortKey,
  pickGsi1PartitionKey,
  pickGsi1SortKey,
  pickSortKey,
  playerPartitionKey,
  seasonWeekToken,
  gameSortKey,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import {
  ErrorCodes,
  type ApiErrorResponse,
  type ErrorCode,
  type Pick as PickRecord,
  type SubmitPickRequest,
  type SubmitPickResponse,
} from '../../shared/types.js';

export interface Clock {
  now(): Date;
}

export interface DynamoSubmitPickClient {
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
const MAX_WEEKLY_PICKS = 3;

const GAME_CONDITION_EXPRESSION =
  'attribute_exists(PK) AND commenceTime > :now AND ' +
  '((awayTeam = :pickedTeam AND awaySpread = :spread) OR ' +
  '(homeTeam = :pickedTeam AND homeSpread = :spread))';

interface ActiveWeek {
  season: number;
  week: number;
}

interface SubmitPickDependencies {
  dynamoClient: DynamoSubmitPickClient;
  clock: Clock;
  tableName: string;
  fallbackSeason?: number;
  fallbackWeek?: number;
  logger?: Pick<Console, 'error'>;
}

function parseSubmitPickRequest(body: string | undefined): SubmitPickRequest | null {
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
    typeof (parsed as SubmitPickRequest).gameId !== 'string' ||
    (parsed as SubmitPickRequest).gameId.length === 0 ||
    typeof (parsed as SubmitPickRequest).pickedTeam !== 'string' ||
    (parsed as SubmitPickRequest).pickedTeam.length === 0 ||
    typeof (parsed as SubmitPickRequest).spreadAtPick !== 'number' ||
    !Number.isFinite((parsed as SubmitPickRequest).spreadAtPick)
  ) {
    return null;
  }

  return parsed as SubmitPickRequest;
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

function successResponse(pick: PickRecord): LambdaResponse {
  const response: SubmitPickResponse = { pick };

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

async function resolveActiveWeek(
  dynamoClient: DynamoSubmitPickClient,
  tableName: string,
  fallbackSeason: number,
  fallbackWeek: number,
): Promise<ActiveWeek> {
  const seasonResult = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
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
  // Prefer explicit env, then SEASON#ACTIVE.week, then fallback.
  const weekFromEnv =
    typeof process.env.ACTIVE_WEEK === 'string' &&
    process.env.ACTIVE_WEEK.trim().length > 0
      ? Number(process.env.ACTIVE_WEEK)
      : Number.NaN;
  const weekFromItem =
    typeof seasonResult.Item?.week === 'number'
      ? seasonResult.Item.week
      : Number.NaN;
  const week = Number.isFinite(weekFromEnv)
    ? weekFromEnv
    : Number.isFinite(weekFromItem)
      ? weekFromItem
      : fallbackWeek;

  return { season, week };
}

type CancellationReason = { Code?: string; code?: string };

function getCancellationReasons(
  error: unknown,
): CancellationReason[] {
  if (!error || typeof error !== 'object') {
    return [];
  }
  const candidate = error as {
    CancellationReasons?: CancellationReason[];
    cancellationReasons?: CancellationReason[];
  };
  return (
    candidate.CancellationReasons ??
    candidate.cancellationReasons ??
    []
  );
}

function isTransactionCanceledError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    name?: string;
    __type?: string;
  };
  const name = candidate.name ?? candidate.__type ?? '';
  // AWS SDK v3 uses camelCase cancellationReasons; v2 used CancellationReasons.
  if (
    name === 'TransactionCanceledException' ||
    name.endsWith('#TransactionCanceledException') ||
    name.includes('TransactionCanceled')
  ) {
    return true;
  }

  return getCancellationReasons(error).length > 0;
}

function cancellationReasonCode(reason: CancellationReason | undefined): string | undefined {
  return reason?.Code ?? reason?.code;
}

async function classifyGameCheckFailure(
  dynamoClient: DynamoSubmitPickClient,
  tableName: string,
  weekPk: string,
  gameSk: string,
  nowIso: string,
): Promise<LambdaResponse | ErrorCode> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: weekPk,
        SK: gameSk,
      },
    }),
  );

  if (!result.Item) {
    return errorResponse(
      404,
      ErrorCodes.GAME_NOT_FOUND,
      conflictMessage(ErrorCodes.GAME_NOT_FOUND),
    );
  }

  const commenceTime = result.Item.commenceTime;
  if (typeof commenceTime === 'string' && commenceTime <= nowIso) {
    return ErrorCodes.GAME_STARTED;
  }

  return ErrorCodes.STALE_LINES;
}

async function mapTransactionFailure(
  dynamoClient: DynamoSubmitPickClient,
  tableName: string,
  weekPk: string,
  gameSk: string,
  nowIso: string,
  error: unknown,
): Promise<LambdaResponse> {
  if (!isTransactionCanceledError(error)) {
    throw error;
  }

  const reasons = getCancellationReasons(error);

  if (cancellationReasonCode(reasons[0]) === 'ConditionalCheckFailed') {
    const classified = await classifyGameCheckFailure(
      dynamoClient,
      tableName,
      weekPk,
      gameSk,
      nowIso,
    );
    if (typeof classified !== 'string') {
      return classified;
    }
    return errorResponse(409, classified, conflictMessage(classified));
  }

  if (cancellationReasonCode(reasons[1]) === 'ConditionalCheckFailed') {
    return errorResponse(
      409,
      ErrorCodes.DUPLICATE_PICK,
      conflictMessage(ErrorCodes.DUPLICATE_PICK),
    );
  }

  if (cancellationReasonCode(reasons[2]) === 'ConditionalCheckFailed') {
    return errorResponse(
      409,
      ErrorCodes.WEEKLY_LIMIT,
      conflictMessage(ErrorCodes.WEEKLY_LIMIT),
    );
  }

  throw error;
}

function conflictMessage(code: ErrorCode): string {
  switch (code) {
    case ErrorCodes.GAME_STARTED:
      return 'This game has already started';
    case ErrorCodes.STALE_LINES:
      return 'The submitted team or spread no longer matches the cached game';
    case ErrorCodes.DUPLICATE_PICK:
      return 'You have already submitted a pick for this game';
    case ErrorCodes.WEEKLY_LIMIT:
      return 'You have already submitted three picks this week';
    case ErrorCodes.GAME_NOT_FOUND:
      return 'Game not found';
    default:
      return 'Pick submission conflict';
  }
}

export function createSubmitPickHandler(
  dependencies: SubmitPickDependencies,
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

    const request = parseSubmitPickRequest(event.body);
    if (!request) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: {
            message: 'Invalid request body',
          },
        }),
      };
    }

    let weekPk: string | undefined;
    let gameSk: string | undefined;
    let nowIso: string | undefined;

    try {
      const { season, week } = await resolveActiveWeek(
        dependencies.dynamoClient,
        dependencies.tableName,
        fallbackSeason,
        fallbackWeek,
      );
      nowIso = dependencies.clock.now().toISOString();
      const seasonWeek = seasonWeekToken(season, week);
      weekPk = weekPartitionKey(season, week);
      gameSk = gameSortKey(request.gameId);
      const playerPk = playerPartitionKey(playerSub);
      const pickSk = pickSortKey(season, week, request.gameId);
      const counterSk = counterSortKey(season, week);

      const pick: PickRecord = {
        playerId: playerSub,
        gameId: request.gameId,
        seasonWeek,
        pickedTeam: request.pickedTeam,
        spreadAtPick: request.spreadAtPick,
        submittedAt: nowIso,
        result: 'pending',
      };

      await dependencies.dynamoClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: dependencies.tableName,
                Key: {
                  PK: weekPk,
                  SK: gameSk,
                },
                ConditionExpression: GAME_CONDITION_EXPRESSION,
                ExpressionAttributeValues: {
                  ':now': nowIso,
                  ':pickedTeam': request.pickedTeam,
                  ':spread': request.spreadAtPick,
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
                  GSI1SK: pickGsi1SortKey(playerSub, request.gameId),
                  ...pick,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Update: {
                TableName: dependencies.tableName,
                Key: {
                  PK: playerPk,
                  SK: counterSk,
                },
                UpdateExpression:
                  'ADD pickCount :one SET seasonWeek = :seasonWeek, updatedAt = :now',
                ConditionExpression:
                  'attribute_not_exists(PK) OR pickCount < :max',
                ExpressionAttributeValues: {
                  ':one': 1,
                  ':max': MAX_WEEKLY_PICKS,
                  ':seasonWeek': seasonWeek,
                  ':now': nowIso,
                },
              },
            },
          ],
        }),
      );

      return successResponse(pick);
    } catch (error) {
      if (
        isTransactionCanceledError(error) &&
        weekPk &&
        gameSk &&
        nowIso
      ) {
        try {
          return await mapTransactionFailure(
            dependencies.dynamoClient,
            dependencies.tableName,
            weekPk,
            gameSk,
            nowIso,
            error,
          );
        } catch (mappingError) {
          logger.error('Failed to map pick submission transaction error', {
            mappingError,
            cancellationReasons:
              error && typeof error === 'object'
                ? (error as { CancellationReasons?: unknown }).CancellationReasons
                : undefined,
          });
        }
      } else {
        logger.error('Failed to submit pick', error);
      }

      return errorResponse(
        500,
        ErrorCodes.INTERNAL_ERROR,
        'Unable to submit pick',
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

  runtimeHandler = createSubmitPickHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    clock: { now: () => new Date() },
    tableName,
  });

  return runtimeHandler;
}

export async function handler(event: ApiGatewayJwtEvent): Promise<LambdaResponse> {
  const run = await getRuntimeHandler();
  return run(event);
}
