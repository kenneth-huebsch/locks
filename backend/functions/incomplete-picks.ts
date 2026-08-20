import { GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  GetCommand,
  type GetCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { timingSafeEqual } from 'node:crypto';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  counterSortKey,
  playerPartitionKey,
  seasonWeekToken,
} from '../../shared/dynamo.js';
import { LEAGUE_ROSTER } from '../../shared/roster.js';
import {
  type ApiErrorResponse,
  type IncompletePicksResponse,
} from '../../shared/types.js';

export interface ApiGatewayApiKeyEvent {
  headers?: Record<string, string | undefined>;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface DynamoIncompletePicksClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
}

export interface SsmClient {
  send(command: GetParameterCommand): Promise<{
    Parameter?: { Value?: string };
  }>;
}

interface IncompletePicksDependencies {
  dynamoClient: DynamoIncompletePicksClient;
  ssmClient: SsmClient;
  tableName: string;
  apiKeyParameterName?: string;
  roster?: typeof LEAGUE_ROSTER;
  logger?: Pick<Console, 'error' | 'warn'>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const MAX_WEEKLY_PICKS = 3;
export const INCOMPLETE_PICKS_API_KEY_PARAMETER =
  '/locks/incomplete-picks-api-key';

function apiError(statusCode: number, message: string): LambdaResponse {
  const body: ApiErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  };
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function readHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === 'string') {
    return direct;
  }
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return match?.[1];
}

function apiKeysMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

async function loadExpectedApiKey(
  ssmClient: SsmClient,
  parameterName: string,
  logger: Pick<Console, 'warn'>,
): Promise<string | null> {
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      }),
    );
    const value = response.Parameter?.Value?.trim();
    if (!value) {
      logger.warn('Incomplete-picks API key parameter has no value');
      return null;
    }
    return value;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'ParameterNotFound' ||
        error.message.includes('ParameterNotFound'))
    ) {
      logger.warn('Incomplete-picks API key parameter is not configured');
      return null;
    }
    throw error;
  }
}

function toPickCount(item: Record<string, unknown> | undefined): number {
  const value = item?.pickCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function createIncompletePicksHandler(
  dependencies: IncompletePicksDependencies,
): (event: ApiGatewayApiKeyEvent) => Promise<LambdaResponse> {
  const logger = dependencies.logger ?? console;
  const roster = dependencies.roster ?? LEAGUE_ROSTER;
  const parameterName =
    dependencies.apiKeyParameterName ?? INCOMPLETE_PICKS_API_KEY_PARAMETER;

  return async (event) => {
    try {
      const providedKey = readHeader(event.headers, 'x-api-key')?.trim();
      if (!providedKey) {
        return apiError(401, 'Missing API key');
      }

      const expectedKey = await loadExpectedApiKey(
        dependencies.ssmClient,
        parameterName,
        logger,
      );
      if (!expectedKey || !apiKeysMatch(providedKey, expectedKey)) {
        return apiError(401, 'Invalid API key');
      }

      const activeSeason = await dependencies.dynamoClient.send(
        new GetCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: ACTIVE_SEASON_PARTITION_KEY,
            SK: ACTIVE_SEASON_SORT_KEY,
          },
        }),
      );

      const season = activeSeason.Item?.season;
      const week = activeSeason.Item?.week;
      if (typeof season !== 'number' || typeof week !== 'number') {
        return apiError(500, 'Active season is not configured');
      }

      const seasonWeek = seasonWeekToken(season, week);
      const counters = await Promise.all(
        roster.map((player) =>
          dependencies.dynamoClient.send(
            new GetCommand({
              TableName: dependencies.tableName,
              Key: {
                PK: playerPartitionKey(player.sub),
                SK: counterSortKey(season, week),
              },
            }),
          ),
        ),
      );

      const incomplete = roster.flatMap((player, index) => {
        const pickCount = toPickCount(
          counters[index]?.Item as Record<string, unknown> | undefined,
        );
        if (pickCount >= MAX_WEEKLY_PICKS) {
          return [];
        }
        return [
          {
            displayName: player.displayName,
            sub: player.sub,
            pickCount,
            remainingPicks: MAX_WEEKLY_PICKS - pickCount,
          },
        ];
      });

      const body: IncompletePicksResponse = {
        seasonWeek,
        maxPicks: MAX_WEEKLY_PICKS,
        incomplete,
      };

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      };
    } catch (error) {
      logger.error('Incomplete picks handler failed', error);
      return apiError(500, 'Failed to load incomplete picks');
    }
  };
}

let runtimeHandler:
  | ((event: ApiGatewayApiKeyEvent) => Promise<LambdaResponse>)
  | undefined;

async function getRuntimeHandler(): Promise<
  (event: ApiGatewayApiKeyEvent) => Promise<LambdaResponse>
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
  const { SSMClient } = await import('@aws-sdk/client-ssm');

  runtimeHandler = createIncompletePicksHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    ssmClient: new SSMClient({}),
    tableName,
  });

  return runtimeHandler;
}

export async function handler(
  event: ApiGatewayApiKeyEvent,
): Promise<LambdaResponse> {
  const run = await getRuntimeHandler();
  return run(event);
}
