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
  ODDS_API_SCORES_PATH,
  createOddsApiClient,
  oddsApiScoresPath,
  type Clock,
  type HttpClient,
  type OddsApiClient,
} from '../lib/odds-api-client.js';
import type { OddsApiScoreEvent } from '../lib/odds-api-types.js';
import { gradeAgainstTheSpread } from '../../shared/grading.js';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  QUOTA_PARTITION_KEY,
  gameSortKey,
  parseSeasonWeekToken,
  pickSortKey,
  playerPartitionKey,
  seasonWeekToken,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import type { Pick as PickRecord } from '../../shared/types.js';

const ODDS_API_PARAMETER_NAME = '/locks/odds-api-key';
const QUOTA_TTL_SECONDS = 30 * 24 * 60 * 60;
const GSI1_INDEX_NAME = 'GSI1';
const DEFAULT_SEASON = 2026;
const DEFAULT_WEEK = 1;

export interface SsmClient {
  send(command: GetParameterCommand): Promise<GetParameterCommandOutput>;
}

export interface DynamoDocumentClient {
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export interface GradeGamesEvent {
  /** Optional manual override, e.g. `2026#W01`. */
  seasonWeek?: string;
}

export interface GradeGamesDependencies {
  dynamoClient: DynamoDocumentClient;
  oddsClient: OddsApiClient | null;
  clock: Clock;
  tableName: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface GradeGamesResult {
  status: 'skipped' | 'success' | 'error';
  reason?: string;
  seasonWeek?: string;
  gamesFinalized?: number;
  picksGraded?: number;
  picksSkipped?: number;
}

interface ParsedFinalScore {
  eventId: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
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

function scoresQuotaEndpoint(): string {
  return oddsApiScoresPath();
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
      logger.warn('Odds API parameter exists but has no value; skipping grade');
      return null;
    }
    return value;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'ParameterNotFound' ||
        error.message.includes('ParameterNotFound'))
    ) {
      logger.warn('Odds API parameter is not configured; skipping grade');
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
  event: GradeGamesEvent | undefined,
): Promise<{ season: number; week: number }> {
  if (typeof event?.seasonWeek === 'string' && event.seasonWeek.trim().length > 0) {
    return parseSeasonWeekToken(event.seasonWeek.trim());
  }

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
      : DEFAULT_SEASON;
  const week =
    typeof seasonResult.Item?.week === 'number'
      ? seasonResult.Item.week
      : DEFAULT_WEEK;

  return { season, week };
}

function parseFinalScore(event: OddsApiScoreEvent): ParsedFinalScore | null {
  if (!event.completed || !Array.isArray(event.scores) || event.scores.length < 2) {
    return null;
  }

  const awayEntry = event.scores.find((entry) => entry.name === event.away_team);
  const homeEntry = event.scores.find((entry) => entry.name === event.home_team);
  if (!awayEntry || !homeEntry) {
    return null;
  }

  const awayScore = Number(awayEntry.score);
  const homeScore = Number(homeEntry.score);
  if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) {
    return null;
  }

  return {
    eventId: event.id,
    awayTeam: event.away_team,
    homeTeam: event.home_team,
    awayScore,
    homeScore,
  };
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

async function queryWeekGames(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
): Promise<Map<string, { awayTeam: string; homeTeam: string }>> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :game)',
      ExpressionAttributeValues: {
        ':pk': weekPartitionKey(season, week),
        ':game': 'GAME#',
      },
    }),
  );

  const games = new Map<string, { awayTeam: string; homeTeam: string }>();
  for (const item of result.Items ?? []) {
    if (
      typeof item.id === 'string' &&
      typeof item.awayTeam === 'string' &&
      typeof item.homeTeam === 'string'
    ) {
      games.set(item.id, {
        awayTeam: item.awayTeam,
        homeTeam: item.homeTeam,
      });
    }
  }
  return games;
}

async function queryWeekPicks(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
): Promise<PickRecord[]> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: GSI1_INDEX_NAME,
      KeyConditionExpression: 'GSI1PK = :weekPk',
      ExpressionAttributeValues: {
        ':weekPk': weekPartitionKey(season, week),
      },
    }),
  );

  return (result.Items ?? [])
    .filter(
      (item) =>
        typeof item.playerId === 'string' &&
        typeof item.gameId === 'string' &&
        typeof item.pickedTeam === 'string' &&
        typeof item.spreadAtPick === 'number' &&
        typeof item.result === 'string',
    )
    .map((item) => ({
      playerId: item.playerId as string,
      gameId: item.gameId as string,
      seasonWeek:
        typeof item.seasonWeek === 'string'
          ? item.seasonWeek
          : seasonWeekToken(season, week),
      pickedTeam: item.pickedTeam as string,
      spreadAtPick: item.spreadAtPick as number,
      submittedAt:
        typeof item.submittedAt === 'string' ? item.submittedAt : '',
      result: item.result as PickRecord['result'],
    }));
}

async function finalizeGameScores(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  score: ParsedFinalScore,
): Promise<void> {
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: weekPartitionKey(season, week),
        SK: gameSortKey(score.eventId),
      },
      UpdateExpression:
        'SET awayScore = :awayScore, homeScore = :homeScore, #status = :final',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':awayScore': score.awayScore,
        ':homeScore': score.homeScore,
        ':final': 'final',
      },
    }),
  );
}

async function gradePendingPick(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  pick: PickRecord,
  score: ParsedFinalScore,
): Promise<'graded' | 'skipped'> {
  if (pick.result !== 'pending') {
    return 'skipped';
  }

  const gradedResult = gradeAgainstTheSpread({
    pickedTeam: pick.pickedTeam,
    spreadAtPick: pick.spreadAtPick,
    awayTeam: score.awayTeam,
    homeTeam: score.homeTeam,
    awayScore: score.awayScore,
    homeScore: score.homeScore,
  });

  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: playerPartitionKey(pick.playerId),
          SK: pickSortKey(season, week, pick.gameId),
        },
        UpdateExpression: 'SET #result = :result',
        ConditionExpression: '#result = :pending',
        ExpressionAttributeNames: {
          '#result': 'result',
        },
        ExpressionAttributeValues: {
          ':result': gradedResult,
          ':pending': 'pending',
        },
      }),
    );
    return 'graded';
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return 'skipped';
    }
    throw error;
  }
}

export function createGradeGamesHandler(
  dependencies: GradeGamesDependencies,
): (event?: GradeGamesEvent) => Promise<GradeGamesResult> {
  const logger = dependencies.logger ?? console;

  return async (event) => {
    if (!isEnabled()) {
      logger.info('Grading skipped because ODDS_API_ENABLED=false');
      return { status: 'skipped', reason: 'disabled' };
    }

    if (!dependencies.oddsClient) {
      logger.info('Grading skipped because Odds API key is not configured');
      return { status: 'skipped', reason: 'missing_parameter' };
    }

    try {
      const { season, week } = await resolveActiveWeek(
        dependencies.dynamoClient,
        dependencies.tableName,
        event,
      );
      const seasonWeek = seasonWeekToken(season, week);

      const creditsRemaining = await getLatestCreditsRemaining(
        dependencies.dynamoClient,
        dependencies.tableName,
      );

      const scores = await dependencies.oddsClient.fetchNflScores(
        creditsRemaining,
      );

      await writeQuotaRecord(
        dependencies.dynamoClient,
        dependencies.tableName,
        dependencies.clock,
        scoresQuotaEndpoint(),
        scores.quota.creditsUsed,
        scores.quota.creditsRemaining,
      );

      const weekGames = await queryWeekGames(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        week,
      );
      const weekPicks = await queryWeekPicks(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        week,
      );

      let gamesFinalized = 0;
      let picksGraded = 0;
      let picksSkipped = 0;

      for (const scoreEvent of scores.data) {
        const finalScore = parseFinalScore(scoreEvent);
        if (!finalScore) {
          continue;
        }

        if (!weekGames.has(finalScore.eventId)) {
          continue;
        }

        await finalizeGameScores(
          dependencies.dynamoClient,
          dependencies.tableName,
          season,
          week,
          finalScore,
        );
        gamesFinalized += 1;

        const gamePicks = weekPicks.filter(
          (pick) => pick.gameId === finalScore.eventId,
        );
        for (const pick of gamePicks) {
          const outcome = await gradePendingPick(
            dependencies.dynamoClient,
            dependencies.tableName,
            season,
            week,
            pick,
            finalScore,
          );
          if (outcome === 'graded') {
            picksGraded += 1;
          } else {
            picksSkipped += 1;
          }
        }
      }

      logger.info(
        `Grading complete for ${seasonWeek}: finalized ${gamesFinalized} games, ` +
          `graded ${picksGraded} picks, skipped ${picksSkipped}; ` +
          `credits used ${scores.quota.creditsUsed}, ` +
          `remaining ${scores.quota.creditsRemaining}`,
      );

      return {
        status: 'success',
        seasonWeek,
        gamesFinalized,
        picksGraded,
        picksSkipped,
      };
    } catch (error) {
      logger.error('Grading failed', error);
      throw error;
    }
  };
}

let cachedApiKey: string | null | undefined;
let runtimeHandler: ((event?: GradeGamesEvent) => Promise<GradeGamesResult>) | undefined;

async function getRuntimeHandler(): Promise<
  (event?: GradeGamesEvent) => Promise<GradeGamesResult>
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
    runtimeHandler = createGradeGamesHandler({
      dynamoClient,
      oddsClient: null,
      clock: { now: () => new Date() },
      tableName,
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

  runtimeHandler = createGradeGamesHandler({
    dynamoClient,
    oddsClient,
    clock: { now: () => new Date() },
    tableName,
  });

  return runtimeHandler;
}

export async function handler(
  event?: GradeGamesEvent,
): Promise<GradeGamesResult> {
  const run = await getRuntimeHandler();
  return run(event);
}

export {
  createOddsApiClient,
  ODDS_API_SCORES_PATH,
};
export type { OddsApiClient } from '../lib/odds-api-client.js';
