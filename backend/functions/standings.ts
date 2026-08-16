import {
  GetCommand,
  QueryCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import { FOUNDATION_WEEK } from '../../shared/foundation.js';
import { computeStandingsFromPicks } from '../../shared/records.js';
import { LEAGUE_ROSTER } from '../../shared/roster.js';
import {
  type ApiErrorResponse,
  type Pick as PickRecord,
  type StandingsResponse,
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

export interface DynamoStandingsClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

interface StandingsDependencies {
  dynamoClient: DynamoStandingsClient;
  tableName: string;
  playerIds?: readonly string[];
  logger?: Pick<Console, 'error'>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const GSI1_INDEX_NAME = 'GSI1';

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

function emptyStandingsResponse(season: number, currentWeek: number): StandingsResponse {
  return {
    season,
    currentWeek,
    players: [],
  };
}

async function queryWeekPicks(
  dynamoClient: DynamoStandingsClient,
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

async function loadSeasonPicks(
  dynamoClient: DynamoStandingsClient,
  tableName: string,
  season: number,
  throughWeek: number,
): Promise<PickRecord[]> {
  const weekNumbers = Array.from({ length: throughWeek }, (_, index) => index + 1);
  const picksByWeek = await Promise.all(
    weekNumbers.map((week) => queryWeekPicks(dynamoClient, tableName, season, week)),
  );

  return picksByWeek.flat();
}

export function createStandingsHandler(
  dependencies: StandingsDependencies,
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
        const response = emptyStandingsResponse(
          FOUNDATION_WEEK.season,
          FOUNDATION_WEEK.week,
        );

        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(response),
        };
      }

      const season = activeSeasonResult.Item.season;
      const currentWeek =
        typeof activeSeasonResult.Item.week === 'number'
          ? activeSeasonResult.Item.week
          : FOUNDATION_WEEK.week;
      const picks = await loadSeasonPicks(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        currentWeek,
      );
      const response = computeStandingsFromPicks(
        picks,
        season,
        currentWeek,
        dependencies.playerIds ?? LEAGUE_ROSTER.map((player) => player.sub),
      );

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(response),
      };
    } catch (error) {
      logger.error('Failed to load standings', error);
      const response: ApiErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to load standings',
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

  runtimeHandler = createStandingsHandler({
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
