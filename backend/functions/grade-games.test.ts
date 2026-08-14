import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OddsApiClient } from '../lib/odds-api-client.js';
import {
  createGradeGamesHandler,
  type GradeGamesEvent,
} from './grade-games.js';
import { QUOTA_PARTITION_KEY } from '../../shared/dynamo.js';
import { oddsApiScoresPath } from '../lib/odds-api-client.js';

const tableName = 'locks-table';
const nowIso = '2026-08-11T04:00:00.000Z';
const clock = { now: () => new Date(nowIso) };

const completedScore = {
  id: 'event-1',
  sport_key: 'americanfootball_nfl_preseason',
  sport_title: 'NFL Preseason',
  commence_time: '2026-08-10T00:20:00.000Z',
  completed: true,
  home_team: 'Philadelphia Eagles',
  away_team: 'Dallas Cowboys',
  scores: [
    { name: 'Dallas Cowboys', score: '17' },
    { name: 'Philadelphia Eagles', score: '24' },
  ],
  last_update: '2026-08-10T03:30:00.000Z',
};

const incompleteScore = {
  ...completedScore,
  id: 'event-2',
  completed: false,
  scores: [
    { name: 'Dallas Cowboys', score: '10' },
    { name: 'Philadelphia Eagles', score: '14' },
  ],
};

const missingScoresEvent = {
  ...completedScore,
  id: 'event-3',
  completed: true,
  scores: null,
};

function createHandler(
  overrides: {
    enabled?: boolean;
    oddsClient?: OddsApiClient | null;
    send?: ReturnType<typeof vi.fn>;
    logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  } = {},
) {
  const previousEnabled = process.env.ODDS_API_ENABLED;
  process.env.ODDS_API_ENABLED =
    overrides.enabled === false ? 'false' : 'true';

  const send =
    overrides.send ??
    vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 1 } });
      }
      if (command instanceof QueryCommand) {
        const values = command.input.ExpressionAttributeValues ?? {};
        if (values[':pk'] === QUOTA_PARTITION_KEY) {
          return Promise.resolve({ Items: [{ creditsRemaining: 400 }] });
        }
        if (command.input.IndexName === 'GSI1') {
          return Promise.resolve({
            Items: [
              {
                playerId: 'player-1',
                gameId: 'event-1',
                seasonWeek: '2026#W01',
                pickedTeam: 'Dallas Cowboys',
                spreadAtPick: 6.5,
                submittedAt: '2026-08-09T12:00:00.000Z',
                result: 'pending',
              },
              {
                playerId: 'player-2',
                gameId: 'event-1',
                seasonWeek: '2026#W01',
                pickedTeam: 'Philadelphia Eagles',
                spreadAtPick: -3.5,
                submittedAt: '2026-08-09T12:05:00.000Z',
                result: 'win',
              },
            ],
          });
        }
        return Promise.resolve({
          Items: [
            {
              id: 'event-1',
              awayTeam: 'Dallas Cowboys',
              homeTeam: 'Philadelphia Eagles',
              status: 'scheduled',
            },
            {
              id: 'event-2',
              awayTeam: 'Dallas Cowboys',
              homeTeam: 'Philadelphia Eagles',
              status: 'in_progress',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

  const oddsClient =
    overrides.oddsClient === undefined
      ? ({
          fetchNflSpreads: vi.fn(),
          fetchNflEvents: vi.fn(),
          fetchNflScores: vi.fn().mockResolvedValue({
            data: [completedScore, incompleteScore, missingScoresEvent],
            quota: { creditsUsed: 14, creditsRemaining: 486 },
          }),
        } satisfies OddsApiClient)
      : overrides.oddsClient;

  const handler = createGradeGamesHandler({
    dynamoClient: { send } as never,
    oddsClient,
    clock,
    tableName,
    logger: overrides.logger ?? {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  return {
    handler,
    send,
    restore() {
      if (previousEnabled === undefined) {
        delete process.env.ODDS_API_ENABLED;
      } else {
        process.env.ODDS_API_ENABLED = previousEnabled;
      }
    },
  };
}

describe('grade-games handler', () => {
  it('skips when disabled', async () => {
    const { handler, restore, send } = createHandler({ enabled: false });
    const result = await handler();
    restore();

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips cleanly when the Odds API key is missing', async () => {
    const { handler, restore, send } = createHandler({ oddsClient: null });
    const result = await handler();
    restore();

    expect(result).toEqual({ status: 'skipped', reason: 'missing_parameter' });
    expect(send).not.toHaveBeenCalled();
  });

  it('uses seasonWeek from the invoke event when provided', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof QueryCommand) {
        const values = command.input.ExpressionAttributeValues ?? {};
        if (values[':pk'] === QUOTA_PARTITION_KEY) {
          return Promise.resolve({ Items: [{ creditsRemaining: 400 }] });
        }
        if (command.input.IndexName === 'GSI1') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });

    const oddsClient = {
      fetchNflSpreads: vi.fn(),
      fetchNflEvents: vi.fn(),
      fetchNflScores: vi.fn().mockResolvedValue({
        data: [],
        quota: { creditsUsed: 14, creditsRemaining: 486 },
      }),
    } satisfies OddsApiClient;

    const { handler, restore } = createHandler({ send, oddsClient });
    const event: GradeGamesEvent = { seasonWeek: '2026#W03' };
    const result = await handler(event);
    restore();

    expect(result.status).toBe('success');
    expect(result.seasonWeek).toBe('2026#W03');
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof GetCommand &&
          command.input.Key?.PK === 'SEASON#ACTIVE',
      ),
    ).toBe(false);

    const weekQueries = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof QueryCommand)
      .filter((command) => {
        const values = command.input.ExpressionAttributeValues ?? {};
        return values[':pk'] === 'WEEK#2026#W03' || values[':weekPk'] === 'WEEK#2026#W03';
      });
    expect(weekQueries.length).toBeGreaterThan(0);
  });

  it('finalizes completed games and grades only pending picks', async () => {
    const { handler, restore, send } = createHandler();
    const result = await handler();
    restore();

    expect(result).toEqual({
      status: 'success',
      seasonWeek: '2026#W01',
      gamesFinalized: 1,
      picksGraded: 1,
      picksSkipped: 1,
    });

    const updates = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateCommand);

    expect(updates).toHaveLength(2);

    expect(updates[0]?.input).toMatchObject({
      Key: { PK: 'WEEK#2026#W01', SK: 'GAME#event-1' },
      ExpressionAttributeValues: {
        ':awayScore': 17,
        ':homeScore': 24,
        ':final': 'final',
      },
    });

    // Away +6.5 with 17-24 → adjusted 23.5 < 24 → loss
    expect(updates[1]?.input).toMatchObject({
      Key: {
        PK: 'PLAYER#player-1',
        SK: 'PICK#2026#W01#GAME#event-1',
      },
      ConditionExpression: '#result = :pending',
      ExpressionAttributeValues: {
        ':result': 'loss',
        ':pending': 'pending',
      },
    });

    const puts = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.input.Item).toMatchObject({
      PK: QUOTA_PARTITION_KEY,
      endpoint: oddsApiScoresPath(),
      creditsUsed: 14,
      creditsRemaining: 486,
      ttl: Math.floor(new Date(nowIso).getTime() / 1000) + 30 * 24 * 60 * 60,
    });
  });

  it('skips incomplete and missing-score events without writing game or pick updates', async () => {
    const oddsClient = {
      fetchNflSpreads: vi.fn(),
      fetchNflEvents: vi.fn(),
      fetchNflScores: vi.fn().mockResolvedValue({
        data: [incompleteScore, missingScoresEvent],
        quota: { creditsUsed: 14, creditsRemaining: 486 },
      }),
    } satisfies OddsApiClient;

    const { handler, restore, send } = createHandler({ oddsClient });
    const result = await handler();
    restore();

    expect(result).toMatchObject({
      status: 'success',
      gamesFinalized: 0,
      picksGraded: 0,
    });

    const updates = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateCommand);
    expect(updates).toHaveLength(0);
  });

  it('leaves terminal pick results alone when the conditional update fails', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 1 } });
      }
      if (command instanceof QueryCommand) {
        const values = command.input.ExpressionAttributeValues ?? {};
        if (values[':pk'] === QUOTA_PARTITION_KEY) {
          return Promise.resolve({ Items: [{ creditsRemaining: 400 }] });
        }
        if (command.input.IndexName === 'GSI1') {
          return Promise.resolve({
            Items: [
              {
                playerId: 'player-2',
                gameId: 'event-1',
                seasonWeek: '2026#W01',
                pickedTeam: 'Philadelphia Eagles',
                spreadAtPick: -3.5,
                submittedAt: '2026-08-09T12:05:00.000Z',
                result: 'pending',
              },
            ],
          });
        }
        return Promise.resolve({
          Items: [
            {
              id: 'event-1',
              awayTeam: 'Dallas Cowboys',
              homeTeam: 'Philadelphia Eagles',
              status: 'scheduled',
            },
          ],
        });
      }
      if (command instanceof UpdateCommand) {
        if (command.input.Key?.SK?.startsWith('PICK#')) {
          const error = new Error('already graded');
          error.name = 'ConditionalCheckFailedException';
          return Promise.reject(error);
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const { handler, restore } = createHandler({ send });
    const result = await handler();
    restore();

    expect(result).toMatchObject({
      status: 'success',
      gamesFinalized: 1,
      picksGraded: 0,
      picksSkipped: 1,
    });
  });

  it('returns an error result when the scores client fails', async () => {
    const { handler, restore } = createHandler({
      oddsClient: {
        fetchNflSpreads: vi.fn(),
        fetchNflEvents: vi.fn(),
        fetchNflScores: vi
          .fn()
          .mockRejectedValue(new Error('vendor unavailable')),
      } satisfies OddsApiClient,
    });

    const result = await handler();
    restore();

    expect(result).toEqual({
      status: 'error',
      reason: 'vendor unavailable',
    });
  });
});
