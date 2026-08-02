import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type GetCommandOutput,
  type PutCommandOutput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  ODDS_API_EVENTS_PATH,
  ODDS_API_SPREADS_PATH,
  createOddsApiClient,
  type Clock,
  type HttpClient,
  type OddsApiClient,
} from '../lib/odds-api-client.js';
import { mapOddsEventsToGames } from '../lib/game-mapper.js';
import type { Game } from '../../shared/types.js';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  QUOTA_PARTITION_KEY,
  WEEK_META_SORT_KEY,
  gameSortKey,
  seasonWeekToken,
  weekPartitionKey,
} from '../../shared/dynamo.js';

const ODDS_API_PARAMETER_NAME = '/locks/odds-api-key';
const QUOTA_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SsmClient {
  send(command: GetParameterCommand): Promise<GetParameterCommandOutput>;
}

export interface DynamoDocumentClient {
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
}

export interface SyncOddsDependencies {
  dynamoClient: DynamoDocumentClient;
  oddsClient: OddsApiClient;
  clock: Clock;
  tableName: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface SyncOddsResult {
  status: 'skipped' | 'success' | 'error';
  reason?: string;
  gamesWritten?: number;
}

function isEnabled(): boolean {
  return process.env.ODDS_API_ENABLED !== 'false';
}

function toIsoTimestamp(clock: Clock): string {
  return clock.now().toISOString();
}

function quotaTtlEpochSeconds(clock: Clock): number {
  return Math.floor(clock.now().getTime() / 1000) + QUOTA_TTL_SECONDS;
}

async function loadApiKey(
  ssmClient: SsmClient,
  logger: Pick<Console, 'warn'>,
): Promise<string | null> {
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: ODDS_API_PARAMETER_NAME,
        WithDecryption: true,
      }),
    );
    const value = response.Parameter?.Value?.trim();
    if (!value) {
      logger.warn('Odds API parameter exists but has no value; skipping sync');
      return null;
    }
    return value;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'ParameterNotFound' ||
        error.message.includes('ParameterNotFound'))
    ) {
      logger.warn('Odds API parameter is not configured; skipping sync');
      return null;
    }
    throw error;
  }
}

async function getLatestCreditsRemaining(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
): Promise<number | null> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': QUOTA_PARTITION_KEY,
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const latest = result.Items?.[0];
  if (!latest || typeof latest.creditsRemaining !== 'number') {
    return null;
  }

  return latest.creditsRemaining;
}

async function resolveActiveWeek(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  fallbackSeason: number,
  fallbackWeek: number,
): Promise<{ season: number; week: number }> {
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
  const week =
    typeof process.env.ACTIVE_WEEK === 'string'
      ? Number(process.env.ACTIVE_WEEK)
      : fallbackWeek;

  return { season, week };
}

async function upsertGame(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  game: Game,
): Promise<boolean> {
  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: weekPartitionKey(season, week),
          SK: gameSortKey(game.id),
          ...game,
        },
        ConditionExpression:
          'attribute_not_exists(#status) OR #status <> :final',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':final': 'final',
        },
      }),
    );
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return false;
    }
    throw error;
  }
}

async function updateWeekMetadata(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  oddsUpdatedAt: string,
): Promise<void> {
  const pk = weekPartitionKey(season, week);
  const seasonWeek = seasonWeekToken(season, week);

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: pk,
        SK: WEEK_META_SORT_KEY,
        season,
        week,
        status: 'open',
        seasonWeek,
        oddsUpdatedAt,
      },
    }),
  );
}

async function writeQuotaRecord(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  clock: Clock,
  endpoint: string,
  creditsUsed: number,
  creditsRemaining: number,
): Promise<void> {
  const timestamp = toIsoTimestamp(clock);

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: QUOTA_PARTITION_KEY,
        SK: timestamp,
        timestamp,
        endpoint,
        creditsUsed,
        creditsRemaining,
        ttl: quotaTtlEpochSeconds(clock),
      },
    }),
  );
}

export function createSyncOddsHandler(
  dependencies: SyncOddsDependencies,
): () => Promise<SyncOddsResult> {
  const logger = dependencies.logger ?? console;

  return async () => {
    if (!isEnabled()) {
      logger.info('Odds sync skipped because ODDS_API_ENABLED=false');
      return { status: 'skipped', reason: 'disabled' };
    }

    try {
      const creditsRemaining = await getLatestCreditsRemaining(
        dependencies.dynamoClient,
        dependencies.tableName,
      );

      const spreads = await dependencies.oddsClient.fetchNflSpreads(
        creditsRemaining,
      );
      const oddsUpdatedAt = toIsoTimestamp(dependencies.clock);
      const games = mapOddsEventsToGames(spreads.data, oddsUpdatedAt);
      const { season, week } = await resolveActiveWeek(
        dependencies.dynamoClient,
        dependencies.tableName,
        2026,
        1,
      );

      let gamesWritten = 0;
      for (const game of games) {
        const written = await upsertGame(
          dependencies.dynamoClient,
          dependencies.tableName,
          season,
          week,
          game,
        );
        if (written) {
          gamesWritten += 1;
        }
      }

      await updateWeekMetadata(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        week,
        oddsUpdatedAt,
      );

      await writeQuotaRecord(
        dependencies.dynamoClient,
        dependencies.tableName,
        dependencies.clock,
        ODDS_API_SPREADS_PATH,
        spreads.quota.creditsUsed,
        spreads.quota.creditsRemaining,
      );

      logger.info(
        `Odds sync complete: wrote ${gamesWritten} games; ` +
          `credits used ${spreads.quota.creditsUsed}, ` +
          `remaining ${spreads.quota.creditsRemaining}`,
      );

      return { status: 'success', gamesWritten };
    } catch (error) {
      logger.error('Odds sync failed', error);
      return {
        status: 'error',
        reason: error instanceof Error ? error.message : 'unknown_error',
      };
    }
  };
}

let cachedApiKey: string | null | undefined;
let runtimeHandler: (() => Promise<SyncOddsResult>) | undefined;

async function getRuntimeHandler(): Promise<() => Promise<SyncOddsResult>> {
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

  const ssmClient = new SSMClient({});
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  if (cachedApiKey === undefined) {
    cachedApiKey = await loadApiKey(ssmClient, console);
  }

  if (!cachedApiKey) {
    runtimeHandler = async () => ({
      status: 'skipped',
      reason: 'missing_parameter',
    });
    return runtimeHandler;
  }

  const httpClient: HttpClient = {
    get: (url) => fetch(url),
  };

  const oddsClient = createOddsApiClient({
    apiKey: cachedApiKey,
    httpClient,
    clock: { now: () => new Date() },
    enabled: isEnabled(),
  });

  runtimeHandler = createSyncOddsHandler({
    dynamoClient,
    oddsClient,
    clock: { now: () => new Date() },
    tableName,
  });

  return runtimeHandler;
}

export async function handler(): Promise<SyncOddsResult> {
  const run = await getRuntimeHandler();
  return run();
}

export {
  createOddsApiClient,
  ODDS_API_EVENTS_PATH,
  ODDS_API_SPREADS_PATH,
};
export type { OddsApiClient } from '../lib/odds-api-client.js';
