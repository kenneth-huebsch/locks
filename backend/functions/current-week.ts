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
  type Game,
  type Pick as PickRecord,
  type Week,
} from '../../shared/types.js';

export interface ApiGatewayJwtEvent {
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

export interface DynamoCurrentWeekClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

interface CurrentWeekDependencies {
  dynamoClient: DynamoCurrentWeekClient;
  tableName: string;
  logger?: Pick<Console, 'error'>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const MAX_WEEKLY_PICKS = 3;
const GSI1_INDEX_NAME = 'GSI1';

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
    status: item.status as Game['status'],
    bookmaker: (item.bookmaker as string) ?? '',
    oddsUpdatedAt: (item.oddsUpdatedAt as string) ?? '',
  };
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

export function createCurrentWeekHandler(
  dependencies: CurrentWeekDependencies,
): (event: ApiGatewayJwtEvent) => Promise<LambdaResponse> {
  const logger = dependencies.logger ?? console;

  return async (event) => {
    const playerSub = getPlayerSub(event);
    if (!playerSub) {
      const response: ApiErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authenticated player identity is missing',
        },
      };

      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify(response),
      };
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
        const response = await loadFoundationWeek(
          dependencies.dynamoClient,
          dependencies.tableName,
        );

        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(response),
        };
      }

      const season = activeSeasonResult.Item.season;
      const week =
        typeof activeSeasonResult.Item.week === 'number'
          ? activeSeasonResult.Item.week
          : FOUNDATION_WEEK.week;
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

      const response: CurrentWeekResponse = {
        week: weekResponse,
        games,
        picks,
        remainingPicks: remainingPicksFromCounter(counterResult.Item),
        oddsUpdatedAt,
      };

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(response),
      };
    } catch (error) {
      logger.error('Failed to load the current week', error);
      const response: ApiErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to load the current week',
        },
      };

      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify(response),
      };
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
