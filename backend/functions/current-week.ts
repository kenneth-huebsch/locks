import {
  GetCommand,
  QueryCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  WEEK_META_SORT_KEY,
  counterSortKey,
  parseSeasonWeekToken,
  playerPartitionKey,
  seasonWeekToken,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import {
  FOUNDATION_WEEK,
  FOUNDATION_WEEK_KEY,
} from '../../shared/foundation.js';
import {
  type ApiErrorResponse,
  type CurrentWeekResponse,
  ErrorCodes,
  type Game,
  type Pick as PickRecord,
  type Week,
  type WeekSummary,
} from '../../shared/types.js';

export interface ApiGatewayJwtEvent {
  routeKey?: string;
  pathParameters?: {
    seasonWeek?: string;
  };
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

export interface Clock {
  now(): Date;
}

export interface DynamoCurrentWeekClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

interface CurrentWeekDependencies {
  dynamoClient: DynamoCurrentWeekClient;
  tableName: string;
  clock?: Clock;
  logger?: Pick<Console, 'error'>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const MAX_WEEKLY_PICKS = 3;
const MAX_SEASON_WEEK = 18;
const GSI1_INDEX_NAME = 'GSI1';

function toNullableScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toGame(item: Record<string, unknown>): Game {
  return {
    id: item.id as string,
    awayTeam: item.awayTeam as string,
    homeTeam: item.homeTeam as string,
    awayAbbr: (item.awayAbbr as string) ?? '',
    homeAbbr: (item.homeAbbr as string) ?? '',
    commenceTime: item.commenceTime as string,
    awaySpread: (item.awaySpread as number) ?? 0,
    homeSpread: (item.homeSpread as number) ?? 0,
    awayScore: toNullableScore(item.awayScore),
    homeScore: toNullableScore(item.homeScore),
    status: item.status as Game['status'],
    bookmaker: (item.bookmaker as string) ?? '',
    oddsUpdatedAt: (item.oddsUpdatedAt as string) ?? '',
  };
}

export function filterPicksForViewer(
  picks: PickRecord[],
  games: Game[],
  viewerSub: string,
  now: Date,
): PickRecord[] {
  const commenceTimeByGameId = new Map(
    games.map((game) => [game.id, game.commenceTime]),
  );
  const nowMs = now.getTime();

  return picks.filter((pick) => {
    if (pick.playerId === viewerSub) {
      return true;
    }

    const commenceTime = commenceTimeByGameId.get(pick.gameId);
    if (!commenceTime) {
      return false;
    }

    return new Date(commenceTime).getTime() <= nowMs;
  });
}

function toPick(item: Record<string, unknown>): PickRecord {
  return {
    playerId: item.playerId as string,
    gameId: item.gameId as string,
    seasonWeek: item.seasonWeek as string,
    pickedTeam: item.pickedTeam as string,
    spreadAtPick: item.spreadAtPick as number,
    submittedAt: item.submittedAt as string,
    result: item.result as PickRecord['result'],
  };
}

function getPlayerSub(event: ApiGatewayJwtEvent): string | null {
  const sub = event.requestContext.authorizer?.jwt?.claims.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

function foundationWeek(): Week {
  return {
    season: FOUNDATION_WEEK.season,
    week: FOUNDATION_WEEK.week,
    status: 'open',
    seasonWeek: seasonWeekToken(
      FOUNDATION_WEEK.season,
      FOUNDATION_WEEK.week,
    ),
  };
}

async function queryGames(
  dynamoClient: DynamoCurrentWeekClient,
  tableName: string,
  partitionKey: string,
): Promise<Game[]> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :game)',
      ExpressionAttributeValues: {
        ':pk': partitionKey,
        ':game': 'GAME#',
      },
    }),
  );

  return (result.Items ?? []).map((item) => toGame(item));
}

async function loadFoundationWeek(
  dynamoClient: DynamoCurrentWeekClient,
  tableName: string,
): Promise<CurrentWeekResponse> {
  const games = await queryGames(dynamoClient, tableName, FOUNDATION_WEEK_KEY);

  return {
    week: foundationWeek(),
    games,
    picks: [],
    remainingPicks: MAX_WEEKLY_PICKS,
    oddsUpdatedAt: null,
  };
}

async function queryWeekPicks(
  dynamoClient: DynamoCurrentWeekClient,
  tableName: string,
  season: number,
  week: number,
): Promise<PickRecord[]> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: GSI1_INDEX_NAME,
      KeyConditionExpression: 'GSI1PK = :weekPk',
      FilterExpression: 'begins_with(SK, :pickPrefix)',
      ExpressionAttributeValues: {
        ':weekPk': weekPartitionKey(season, week),
        ':pickPrefix': 'PICK#',
      },
    }),
  );

  return (result.Items ?? []).map((item) => toPick(item));
}

function remainingPicksFromCounter(
  counterItem: Record<string, unknown> | undefined,
): number {
  const pickCount =
    typeof counterItem?.pickCount === 'number' ? counterItem.pickCount : 0;
  return Math.max(0, MAX_WEEKLY_PICKS - pickCount);
}

function jsonResponse(statusCode: number, body: unknown): LambdaResponse {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function apiError(
  statusCode: number,
  code: ApiErrorResponse['error']['code'],
  message: string,
): LambdaResponse {
  return jsonResponse(statusCode, {
    error: { code, message },
  } satisfies ApiErrorResponse);
}

async function loadWeekResponse(
  dependencies: CurrentWeekDependencies,
  playerSub: string,
  season: number,
  week: number,
  now: Date,
  requireMetadata: boolean,
): Promise<CurrentWeekResponse | null> {
  const weekPk = weekPartitionKey(season, week);
  const [weekMetaResult, games, picks, counterResult] = await Promise.all([
    dependencies.dynamoClient.send(
      new GetCommand({
        TableName: dependencies.tableName,
        Key: {
          PK: weekPk,
          SK: WEEK_META_SORT_KEY,
        },
      }),
    ),
    queryGames(dependencies.dynamoClient, dependencies.tableName, weekPk),
    queryWeekPicks(
      dependencies.dynamoClient,
      dependencies.tableName,
      season,
      week,
    ),
    dependencies.dynamoClient.send(
      new GetCommand({
        TableName: dependencies.tableName,
        Key: {
          PK: playerPartitionKey(playerSub),
          SK: counterSortKey(season, week),
        },
      }),
    ),
  ]);

  const weekMeta = weekMetaResult.Item;
  if (requireMetadata && !weekMeta) {
    return null;
  }

  const weekResponse: Week = {
    season,
    week,
    status:
      weekMeta?.status === 'grading' || weekMeta?.status === 'complete'
        ? weekMeta.status
        : 'open',
    seasonWeek:
      typeof weekMeta?.seasonWeek === 'string'
        ? weekMeta.seasonWeek
        : seasonWeekToken(season, week),
  };

  const oddsUpdatedAt =
    weekMeta?.oddsUpdatedAt === null
      ? null
      : typeof weekMeta?.oddsUpdatedAt === 'string'
        ? weekMeta.oddsUpdatedAt
        : null;

  return {
    week: weekResponse,
    games,
    picks: filterPicksForViewer(picks, games, playerSub, now),
    remainingPicks: remainingPicksFromCounter(counterResult.Item),
    oddsUpdatedAt,
  };
}

function listWeekSummaries(season: number, activeWeek: number): WeekSummary[] {
  return Array.from({ length: activeWeek }, (_, index) => {
    const week = activeWeek - index;
    return {
      season,
      week,
      isCurrent: week === activeWeek,
    };
  });
}

export function createCurrentWeekHandler(
  dependencies: CurrentWeekDependencies,
): (event: ApiGatewayJwtEvent) => Promise<LambdaResponse> {
  const logger = dependencies.logger ?? console;
  const clock = dependencies.clock ?? { now: () => new Date() };

  return async (event) => {
    const playerSub = getPlayerSub(event);
    if (!playerSub) {
      return apiError(
        500,
        ErrorCodes.INTERNAL_ERROR,
        'Authenticated player identity is missing',
      );
    }

    try {
      const activeSeasonResult = await dependencies.dynamoClient.send(
        new GetCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: ACTIVE_SEASON_PARTITION_KEY,
            SK: ACTIVE_SEASON_SORT_KEY,
          },
        }),
      );

      if (typeof activeSeasonResult.Item?.season !== 'number') {
        if (event.routeKey === 'GET /api/weeks') {
          return jsonResponse(200, [
            {
              season: FOUNDATION_WEEK.season,
              week: FOUNDATION_WEEK.week,
              isCurrent: true,
            },
          ] satisfies WeekSummary[]);
        }

        const response = await loadFoundationWeek(
          dependencies.dynamoClient,
          dependencies.tableName,
        );
        return jsonResponse(200, response);
      }

      const season = activeSeasonResult.Item.season;
      const activeWeek =
        typeof activeSeasonResult.Item.week === 'number'
          ? activeSeasonResult.Item.week
          : FOUNDATION_WEEK.week;

      if (event.routeKey === 'GET /api/weeks') {
        return jsonResponse(200, listWeekSummaries(season, activeWeek));
      }

      let requestedWeek = activeWeek;
      let requireMetadata = false;
      if (event.routeKey === 'GET /api/week/{seasonWeek}') {
        const token = event.pathParameters?.seasonWeek;
        if (!token) {
          return apiError(
            400,
            ErrorCodes.INVALID_WEEK,
            'A seasonWeek path parameter is required',
          );
        }

        let parsed: { season: number; week: number };
        try {
          parsed = parseSeasonWeekToken(token);
        } catch {
          return apiError(
            400,
            ErrorCodes.INVALID_WEEK,
            'seasonWeek must use YYYY#Wnn format',
          );
        }

        if (
          parsed.season !== season ||
          parsed.week < 1 ||
          parsed.week > MAX_SEASON_WEEK ||
          parsed.week > activeWeek
        ) {
          return apiError(
            400,
            ErrorCodes.INVALID_WEEK,
            'Requested week is outside the active season range',
          );
        }

        requestedWeek = parsed.week;
        requireMetadata = requestedWeek !== activeWeek;
      }

      const response = await loadWeekResponse(
        dependencies,
        playerSub,
        season,
        requestedWeek,
        clock.now(),
        requireMetadata,
      );
      if (!response) {
        return apiError(
          404,
          ErrorCodes.WEEK_NOT_FOUND,
          'Requested week is not available',
        );
      }

      return jsonResponse(200, response);
    } catch (error) {
      logger.error('Failed to load the current week', error);
      return apiError(
        500,
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load the current week',
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

  runtimeHandler = createCurrentWeekHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName,
  });

  return runtimeHandler;
}

export async function handler(
  event: ApiGatewayJwtEvent,
): Promise<LambdaResponse> {
  const run = await getRuntimeHandler();
  return run(event);
}
