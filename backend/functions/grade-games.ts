import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
  type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  createEspnScoreboardClient,
  type EspnFinalScore,
  type EspnScoreboardClient,
  type HttpClient,
} from '../lib/espn-scoreboard-client.js';
import { gradeAgainstTheSpread, gradeStraightUp } from '../../shared/grading.js';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  gameSortKey,
  parseSeasonWeekToken,
  pickSortKey,
  playerPartitionKey,
  seasonWeekToken,
  survivorChallengePartitionKey,
  survivorPickSortKey,
  survivorPlayerSortKey,
  SURVIVOR_META_SORT_KEY,
  SURVIVOR_PICK_SK_PREFIX,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import { resolveSurvivorWeek } from '../../shared/survivor.js';
import type {
  Pick as PickRecord,
  SurvivorPick,
  SurvivorPlayerState,
} from '../../shared/types.js';
import { LEAGUE_ROSTER } from '../../shared/roster.js';

const GSI1_INDEX_NAME = 'GSI1';
const DEFAULT_SEASON = 2026;
const DEFAULT_WEEK = 1;

export interface DynamoDocumentClient {
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export interface GradeGamesEvent {
  /** Optional manual override, e.g. `2026#W01`. */
  seasonWeek?: string;
}

export interface GradeGamesDependencies {
  dynamoClient: DynamoDocumentClient;
  espnClient: EspnScoreboardClient;
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
  survivorPicksGraded?: number;
  survivorEliminated?: number;
}

interface WeekGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  commenceTime: string;
  awayScore: number | null;
  homeScore: number | null;
  status: string;
}

interface GameFinalScore extends EspnFinalScore {
  gameId: string;
}

function isEnabled(): boolean {
  return process.env.GRADE_GAMES_ENABLED !== 'false';
}

async function resolveActiveWeek(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  event: GradeGamesEvent | undefined,
): Promise<{ season: number; week: number }> {
  if (
    typeof event?.seasonWeek === 'string' &&
    event.seasonWeek.trim().length > 0
  ) {
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

async function queryWeekGames(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
): Promise<WeekGame[]> {
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

  return (result.Items ?? [])
    .filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.awayTeam === 'string' &&
        typeof item.homeTeam === 'string' &&
        typeof item.commenceTime === 'string',
    )
    .map((item) => ({
      id: item.id as string,
      awayTeam: item.awayTeam as string,
      homeTeam: item.homeTeam as string,
      commenceTime: item.commenceTime as string,
      awayScore:
        typeof item.awayScore === 'number' ? item.awayScore : null,
      homeScore:
        typeof item.homeScore === 'number' ? item.homeScore : null,
      status: typeof item.status === 'string' ? item.status : 'scheduled',
    }));
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

async function queryWeekSurvivorPicks(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
): Promise<SurvivorPick[]> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: GSI1_INDEX_NAME,
      KeyConditionExpression:
        'GSI1PK = :weekPk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':weekPk': weekPartitionKey(season, week),
        ':prefix': SURVIVOR_PICK_SK_PREFIX,
      },
    }),
  );

  return (result.Items ?? [])
    .filter(
      (item) =>
        typeof item.playerId === 'string' &&
        typeof item.gameId === 'string' &&
        typeof item.pickedTeam === 'string' &&
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
      submittedAt:
        typeof item.submittedAt === 'string' ? item.submittedAt : '',
      result: item.result as SurvivorPick['result'],
    }));
}

async function loadSurvivorPlayers(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
): Promise<{
  challengeStatus: 'active' | 'complete';
  winners: string[];
  players: SurvivorPlayerState[];
} | null> {
  const challengePk = survivorChallengePartitionKey(season);
  const metaResult = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: challengePk, SK: SURVIVOR_META_SORT_KEY },
    }),
  );
  if (!metaResult.Item) {
    return null;
  }

  const playerResults = await Promise.all(
    LEAGUE_ROSTER.map((player) =>
      dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            PK: challengePk,
            SK: survivorPlayerSortKey(player.sub),
          },
        }),
      ),
    ),
  );

  const players: SurvivorPlayerState[] = LEAGUE_ROSTER.flatMap(
    (player, index) => {
      const item = playerResults[index]?.Item;
      if (!item || typeof item.status !== 'string') {
        return [];
      }
      return [
        {
          playerId: player.sub,
          status: item.status as SurvivorPlayerState['status'],
          usedTeams: Array.isArray(item.usedTeams)
            ? (item.usedTeams as string[])
            : [],
          eliminatedWeek:
            typeof item.eliminatedWeek === 'string'
              ? item.eliminatedWeek
              : undefined,
        },
      ];
    },
  );

  return {
    challengeStatus:
      metaResult.Item.status === 'complete' ? 'complete' : 'active',
    winners: Array.isArray(metaResult.Item.winners)
      ? (metaResult.Item.winners as string[])
      : [],
    players,
  };
}

/** ESPN scoreboard `dates` uses the US Eastern calendar day of kickoff. */
function kickoffDate(commenceTime: string): string | null {
  const kickoff = new Date(commenceTime);
  if (!Number.isFinite(kickoff.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(kickoff);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    return null;
  }

  return `${year}${month}${day}`;
}

async function fetchFinalScores(
  espnClient: EspnScoreboardClient,
  games: WeekGame[],
): Promise<EspnFinalScore[]> {
  const dates = [
    ...new Set(
      games
        .map((game) => kickoffDate(game.commenceTime))
        .filter((date) => date !== null),
    ),
  ];
  const scoreboards = await Promise.all(
    dates.map((date) => espnClient.fetchFinalScores(date)),
  );
  return scoreboards.flat();
}

function matchFinalScore(
  game: WeekGame,
  scores: EspnFinalScore[],
): GameFinalScore | null {
  const score = scores.find(
    (candidate) =>
      candidate.awayTeam === game.awayTeam &&
      candidate.homeTeam === game.homeTeam,
  );
  return score ? { ...score, gameId: game.id } : null;
}

async function finalizeGameScores(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  score: GameFinalScore,
): Promise<void> {
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: weekPartitionKey(season, week),
        SK: gameSortKey(score.gameId),
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
  score: GameFinalScore,
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

async function gradePendingSurvivorPick(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  pick: SurvivorPick,
  score: GameFinalScore,
): Promise<'graded' | 'skipped'> {
  if (pick.result !== 'pending') {
    return 'skipped';
  }

  const gradedResult = gradeStraightUp({
    pickedTeam: pick.pickedTeam,
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
          SK: survivorPickSortKey(season, week),
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

async function persistSurvivorLifecycle(
  dynamoClient: DynamoDocumentClient,
  tableName: string,
  season: number,
  week: number,
  nowIso: string,
  challengeStatus: 'active' | 'complete',
  winners: string[],
  players: SurvivorPlayerState[],
): Promise<void> {
  const challengePk = survivorChallengePartitionKey(season);
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: challengePk, SK: SURVIVOR_META_SORT_KEY },
      UpdateExpression:
        'SET #status = :status, winners = :winners, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': challengeStatus,
        ':winners': winners,
        ':now': nowIso,
      },
    }),
  );

  await Promise.all(
    players.map((player) =>
      dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            PK: challengePk,
            SK: survivorPlayerSortKey(player.playerId),
          },
          UpdateExpression: player.eliminatedWeek
            ? 'SET #status = :status, eliminatedWeek = :eliminatedWeek, updatedAt = :now'
            : 'SET #status = :status, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: player.eliminatedWeek
            ? {
                ':status': player.status,
                ':eliminatedWeek': player.eliminatedWeek,
                ':now': nowIso,
              }
            : {
                ':status': player.status,
                ':now': nowIso,
              },
        }),
      ),
    ),
  );
}

export function createGradeGamesHandler(
  dependencies: GradeGamesDependencies,
): (event?: GradeGamesEvent) => Promise<GradeGamesResult> {
  const logger = dependencies.logger ?? console;

  return async (event) => {
    if (!isEnabled()) {
      logger.info('Grading skipped because GRADE_GAMES_ENABLED=false');
      return { status: 'skipped', reason: 'disabled' };
    }

    try {
      const { season, week } = await resolveActiveWeek(
        dependencies.dynamoClient,
        dependencies.tableName,
        event,
      );
      const seasonWeek = seasonWeekToken(season, week);
      const weekGames = await queryWeekGames(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        week,
      );
      const scores = await fetchFinalScores(
        dependencies.espnClient,
        weekGames,
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
      let survivorPicksGraded = 0;
      const finalScoresByGameId = new Map<string, GameFinalScore>();

      for (const game of weekGames) {
        if (
          game.status === 'final' &&
          game.awayScore !== null &&
          game.homeScore !== null
        ) {
          finalScoresByGameId.set(game.id, {
            gameId: game.id,
            awayTeam: game.awayTeam,
            homeTeam: game.homeTeam,
            awayScore: game.awayScore,
            homeScore: game.homeScore,
          });
        }

        const finalScore = matchFinalScore(game, scores);
        if (!finalScore) {
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
        finalScoresByGameId.set(game.id, finalScore);

        for (const pick of weekPicks.filter(
          (candidate) => candidate.gameId === game.id,
        )) {
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

      const survivorPicks = await queryWeekSurvivorPicks(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        week,
      );
      for (const pick of survivorPicks) {
        const score = finalScoresByGameId.get(pick.gameId);
        if (!score) {
          continue;
        }
        const outcome = await gradePendingSurvivorPick(
          dependencies.dynamoClient,
          dependencies.tableName,
          season,
          week,
          pick,
          score,
        );
        if (outcome === 'graded') {
          survivorPicksGraded += 1;
        }
      }

      const refreshedSurvivorPicks = await queryWeekSurvivorPicks(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
        week,
      );
      const survivorChallenge = await loadSurvivorPlayers(
        dependencies.dynamoClient,
        dependencies.tableName,
        season,
      );

      let survivorEliminated = 0;
      if (survivorChallenge && survivorChallenge.challengeStatus === 'active') {
        const allGamesFinal =
          weekGames.length > 0 &&
          weekGames.every((game) => finalScoresByGameId.has(game.id));
        const lifecycle = resolveSurvivorWeek({
          season,
          week,
          challengeStatus: survivorChallenge.challengeStatus,
          players: survivorChallenge.players,
          picks: refreshedSurvivorPicks,
          allGamesFinal,
        });
        survivorEliminated = lifecycle.eliminatedThisWeek.length;
        if (
          lifecycle.eliminatedThisWeek.length > 0 ||
          lifecycle.challengeStatus !== survivorChallenge.challengeStatus ||
          lifecycle.winners.length > 0
        ) {
          await persistSurvivorLifecycle(
            dependencies.dynamoClient,
            dependencies.tableName,
            season,
            week,
            new Date().toISOString(),
            lifecycle.challengeStatus,
            lifecycle.winners,
            lifecycle.players,
          );
        }
      }

      logger.info(
        `Grading complete for ${seasonWeek}: finalized ${gamesFinalized} games, ` +
          `graded ${picksGraded} picks, skipped ${picksSkipped}, ` +
          `survivor graded ${survivorPicksGraded}, eliminated ${survivorEliminated}`,
      );

      return {
        status: 'success',
        seasonWeek,
        gamesFinalized,
        picksGraded,
        picksSkipped,
        survivorPicksGraded,
        survivorEliminated,
      };
    } catch (error) {
      logger.error('Grading failed', error);
      throw error;
    }
  };
}

let runtimeHandler:
  | ((event?: GradeGamesEvent) => Promise<GradeGamesResult>)
  | undefined;

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
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const httpClient: HttpClient = {
    get: (url) => fetch(url),
  };

  runtimeHandler = createGradeGamesHandler({
    dynamoClient,
    espnClient: createEspnScoreboardClient({ httpClient }),
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
