import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type GetCommandOutput,
  type PutCommandOutput,
  type QueryCommandOutput,
  type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  ODDS_API_EVENTS_PATH,
  ODDS_API_SPREADS_PATH,
  createOddsApiClient,
  oddsApiSpreadsPath,
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
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export interface SyncOddsEvent {
  advanceWeek?: boolean;
  /** Stable across Scheduler retries, e.g. <aws.scheduler.scheduled-time>. */
  advanceToken?: string;
}

export interface SyncOddsDependencies {
  dynamoClient: DynamoDocumentClient;
  oddsClient: OddsApiClient;
  clock: Clock;
  tableName: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface SyncOddsResult {
  status: 'skipped' | 'success';
  reason?: string;
  gamesWritten?: number;
  seasonWeek?: string;
  advanced?: boolean;
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
): Promise<{
  season: number;
  week: number;
  weekStartsAt?: string;
  lastAdvanceToken?: string;
  exists: boolean;
}> {
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
    typeof seasonResult.Item?.week === 'number'
      ? seasonResult.Item.week
      : fallbackWeek;

  return {
    season,
    week,
    weekStartsAt:
      typeof seasonResult.Item?.weekStartsAt === 'string'
        ? seasonResult.Item.weekStartsAt
        : undefined,
    lastAdvanceToken:
      typeof seasonResult.Item?.lastAdvanceToken === 'string'
        ? seasonResult.Item.lastAdvanceToken
        : undefined,
    exists: Boolean(seasonResult.Item),
  };
}

const MAX_SEASON_WEEK = 18;

interface SyncTarget {
  season: number;
  week: number;
  weekStartsAt?: string;
  previousWeek?: number;
  shouldAdvance: boolean;
  advanceToken?: string;
}

function prepareSyncTarget(
  active: Awaited<ReturnType<typeof resolveActiveWeek>>,
  clock: Clock,
  event: SyncOddsEvent,
): SyncTarget {
  if (!event.advanceWeek) {
    return {
      season: active.season,
      week: active.week,
      weekStartsAt: active.weekStartsAt,
      shouldAdvance: false,
    };
  }

  if (!active.exists) {
    throw new Error('Active season metadata is required before week advance');
  }

  const advanceToken = event.advanceToken!;
  if (active.lastAdvanceToken === advanceToken) {
    return {
      season: active.season,
      week: active.week,
      weekStartsAt: active.weekStartsAt,
      shouldAdvance: false,
    };
  }

  if (active.week >= MAX_SEASON_WEEK) {
    return {
      season: active.season,
      week: active.week,
      weekStartsAt: active.weekStartsAt,
      shouldAdvance: false,
    };
  }

  const scheduledTimeMs = Date.parse(advanceToken);
  const weekStartsAt = Number.isFinite(scheduledTimeMs)
    ? new Date(scheduledTimeMs).toISOString()
    : toIsoTimestamp(clock);

  return {
    season: active.season,
    week: active.week + 1,
    weekStartsAt,
    previousWeek: active.week,
    shouldAdvance: true,
    advanceToken,
  };
}

async function commitActiveWeekAdvance(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  clock: Clock,
  target: SyncTarget,
): Promise<void> {
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: ACTIVE_SEASON_PARTITION_KEY,
        SK: ACTIVE_SEASON_SORT_KEY,
      },
      UpdateExpression:
        'SET #week = :nextWeek, weekStartsAt = :weekStartsAt, ' +
        'lastAdvanceToken = :token, updatedAt = :updatedAt',
      ConditionExpression:
        'season = :season AND #week = :currentWeek AND ' +
        '(attribute_not_exists(lastAdvanceToken) OR lastAdvanceToken <> :token)',
      ExpressionAttributeNames: {
        '#week': 'week',
      },
      ExpressionAttributeValues: {
        ':season': target.season,
        ':currentWeek': target.previousWeek,
        ':nextWeek': target.week,
        ':weekStartsAt': target.weekStartsAt,
        ':token': target.advanceToken,
        ':updatedAt': toIsoTimestamp(clock),
      },
    }),
  );
}

function gamesForCompetitionWeek(games: Game[], weekStartsAt?: string): Game[] {
  if (!weekStartsAt) {
    return games;
  }

  const startMs = Date.parse(weekStartsAt);
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid active weekStartsAt: ${weekStartsAt}`);
  }
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
  return games.filter((game) => {
    const commenceMs = Date.parse(game.commenceTime);
    return commenceMs >= startMs && commenceMs < endMs;
  });
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
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: pk,
        SK: WEEK_META_SORT_KEY,
      },
      UpdateExpression:
        'SET season = :season, #week = :week, seasonWeek = :seasonWeek, ' +
        'oddsUpdatedAt = :oddsUpdatedAt, #status = if_not_exists(#status, :open)',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#week': 'week',
      },
      ExpressionAttributeValues: {
        ':season': season,
        ':week': week,
        ':seasonWeek': seasonWeek,
        ':oddsUpdatedAt': oddsUpdatedAt,
        ':open': 'open',
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
): (event?: SyncOddsEvent) => Promise<SyncOddsResult> {
  const logger = dependencies.logger ?? console;

  return async (event = {}) => {
    if (!isEnabled()) {
      logger.info('Odds sync skipped because ODDS_API_ENABLED=false');
      return { status: 'skipped', reason: 'disabled' };
    }

    try {
      if (event.advanceWeek && !event.advanceToken) {
        throw new Error('advanceToken is required when advanceWeek is true');
      }

      const activeWeek = await resolveActiveWeek(
        dependencies.dynamoClient,
        dependencies.tableName,
        2026,
        1,
      );
      const target = prepareSyncTarget(
        activeWeek,
        dependencies.clock,
        event,
      );

      const creditsRemaining = await getLatestCreditsRemaining(
        dependencies.dynamoClient,
        dependencies.tableName,
      );

      const spreads = await dependencies.oddsClient.fetchNflSpreads(
        creditsRemaining,
      );
      await writeQuotaRecord(
        dependencies.dynamoClient,
        dependencies.tableName,
        dependencies.clock,
        oddsApiSpreadsPath(),
        spreads.quota.creditsUsed,
        spreads.quota.creditsRemaining,
      );

      const oddsUpdatedAt = toIsoTimestamp(dependencies.clock);
      const games = gamesForCompetitionWeek(
        mapOddsEventsToGames(spreads.data, oddsUpdatedAt),
        target.weekStartsAt,
      );
      const { season, week } = target;

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

      if (target.shouldAdvance) {
        await commitActiveWeekAdvance(
          dependencies.dynamoClient,
          dependencies.tableName,
          dependencies.clock,
          target,
        );
      }

      logger.info(
        `Odds sync complete: wrote ${gamesWritten} games; ` +
          `credits used ${spreads.quota.creditsUsed}, ` +
          `remaining ${spreads.quota.creditsRemaining}`,
      );

      return {
        status: 'success',
        gamesWritten,
        seasonWeek: seasonWeekToken(season, week),
        advanced: target.shouldAdvance,
      };
    } catch (error) {
      logger.error('Odds sync failed', error);
      throw error;
    }
  };
}

let cachedApiKey: string | null | undefined;
let runtimeHandler:
  | ((event?: SyncOddsEvent) => Promise<SyncOddsResult>)
  | undefined;

async function getRuntimeHandler(): Promise<
  (event?: SyncOddsEvent) => Promise<SyncOddsResult>
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

export async function handler(event?: SyncOddsEvent): Promise<SyncOddsResult> {
  const run = await getRuntimeHandler();
  return run(event);
}

export {
  createOddsApiClient,
  ODDS_API_EVENTS_PATH,
  ODDS_API_SPREADS_PATH,
};
export type { OddsApiClient } from '../lib/odds-api-client.js';
