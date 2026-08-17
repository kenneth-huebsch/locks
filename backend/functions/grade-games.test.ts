import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { EspnScoreboardClient } from '../lib/espn-scoreboard-client.js';
import {
  createGradeGamesHandler,
  type GradeGamesEvent,
} from './grade-games.js';

const tableName = 'locks-table';

const finalScore = {
  awayTeam: 'Dallas Cowboys',
  homeTeam: 'Philadelphia Eagles',
  awayScore: 17,
  homeScore: 24,
};

function createHandler(
  overrides: {
    enabled?: boolean;
    espnClient?: EspnScoreboardClient;
    send?: ReturnType<typeof vi.fn>;
    logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  } = {},
) {
  const previousGradeEnabled = process.env.GRADE_GAMES_ENABLED;
  const previousOddsEnabled = process.env.ODDS_API_ENABLED;
  process.env.GRADE_GAMES_ENABLED =
    overrides.enabled === false ? 'false' : 'true';
  process.env.ODDS_API_ENABLED = 'false';

  const send =
    overrides.send ??
    vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 2 } });
      }
      if (command instanceof QueryCommand) {
        if (command.input.IndexName === 'GSI1') {
          return Promise.resolve({
            Items: [
              {
                playerId: 'player-1',
                gameId: 'seed-2026-w02-game-1',
                seasonWeek: '2026#W02',
                pickedTeam: 'Dallas Cowboys',
                spreadAtPick: 6.5,
                submittedAt: '2026-08-09T12:00:00.000Z',
                result: 'pending',
              },
              {
                playerId: 'player-2',
                gameId: 'seed-2026-w02-game-1',
                seasonWeek: '2026#W02',
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
              id: 'seed-2026-w02-game-1',
              awayTeam: 'Dallas Cowboys',
              homeTeam: 'Philadelphia Eagles',
              commenceTime: '2026-08-10T00:20:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

  const espnClient =
    overrides.espnClient ??
    ({
      fetchFinalScores: vi.fn().mockResolvedValue([finalScore]),
    } satisfies EspnScoreboardClient);

  const handler = createGradeGamesHandler({
    dynamoClient: { send } as never,
    espnClient,
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
    espnClient,
    restore() {
      if (previousGradeEnabled === undefined) {
        delete process.env.GRADE_GAMES_ENABLED;
      } else {
        process.env.GRADE_GAMES_ENABLED = previousGradeEnabled;
      }
      if (previousOddsEnabled === undefined) {
        delete process.env.ODDS_API_ENABLED;
      } else {
        process.env.ODDS_API_ENABLED = previousOddsEnabled;
      }
    },
  };
}

describe('grade-games handler', () => {
  it('skips when grading is disabled', async () => {
    const { handler, restore, send, espnClient } = createHandler({
      enabled: false,
    });
    const result = await handler();
    restore();

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(send).not.toHaveBeenCalled();
    expect(espnClient.fetchFinalScores).not.toHaveBeenCalled();
  });

  it('uses seasonWeek from the invoke event when provided', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
    const { handler, restore } = createHandler({ send });
    const event: GradeGamesEvent = { seasonWeek: '2026#W03' };

    const result = await handler(event);
    restore();

    expect(result).toMatchObject({
      status: 'success',
      seasonWeek: '2026#W03',
      gamesFinalized: 0,
    });
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof GetCommand &&
          command.input.Key?.PK === 'SEASON#ACTIVE',
      ),
    ).toBe(false);
    expect(
      send.mock.calls.some(([command]) => {
        if (!(command instanceof QueryCommand)) {
          return false;
        }
        const values = command.input.ExpressionAttributeValues ?? {};
        return (
          values[':pk'] === 'WEEK#2026#W03' ||
          values[':weekPk'] === 'WEEK#2026#W03'
        );
      }),
    ).toBe(true);
  });

  it('matches by team names and updates using the seeded Dynamo game id', async () => {
    const { handler, restore, send, espnClient } = createHandler();

    const result = await handler();
    restore();

    expect(result).toEqual({
      status: 'success',
      seasonWeek: '2026#W02',
      gamesFinalized: 1,
      picksGraded: 1,
      picksSkipped: 1,
    });
    expect(espnClient.fetchFinalScores).toHaveBeenCalledWith('20260810');

    const updates = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateCommand);
    expect(updates).toHaveLength(2);
    expect(updates[0]?.input).toMatchObject({
      Key: {
        PK: 'WEEK#2026#W02',
        SK: 'GAME#seed-2026-w02-game-1',
      },
      ExpressionAttributeValues: {
        ':awayScore': 17,
        ':homeScore': 24,
        ':final': 'final',
      },
    });
    expect(updates[1]?.input).toMatchObject({
      Key: {
        PK: 'PLAYER#player-1',
        SK: 'PICK#2026#W02#GAME#seed-2026-w02-game-1',
      },
      ConditionExpression: '#result = :pending',
      ExpressionAttributeValues: {
        ':result': 'loss',
        ':pending': 'pending',
      },
    });
  });

  it('fetches each distinct kickoff date once', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 2 } });
      }
      if (command instanceof QueryCommand) {
        if (command.input.IndexName === 'GSI1') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({
          Items: [
            {
              id: 'game-1',
              awayTeam: 'Dallas Cowboys',
              homeTeam: 'Philadelphia Eagles',
              commenceTime: '2026-08-10T00:20:00.000Z',
            },
            {
              id: 'game-2',
              awayTeam: 'Miami Dolphins',
              homeTeam: 'Chicago Bears',
              commenceTime: '2026-08-10T17:00:00.000Z',
            },
            {
              id: 'game-3',
              awayTeam: 'Denver Broncos',
              homeTeam: 'Seattle Seahawks',
              commenceTime: '2026-08-11T00:20:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve({});
    });
    const espnClient = {
      fetchFinalScores: vi.fn().mockResolvedValue([]),
    } satisfies EspnScoreboardClient;
    const { handler, restore } = createHandler({ send, espnClient });

    await handler();
    restore();

    expect(espnClient.fetchFinalScores).toHaveBeenCalledTimes(2);
    expect(espnClient.fetchFinalScores).toHaveBeenCalledWith('20260810');
    expect(espnClient.fetchFinalScores).toHaveBeenCalledWith('20260811');
  });

  it('does not finalize an ESPN game whose team names do not match', async () => {
    const espnClient = {
      fetchFinalScores: vi.fn().mockResolvedValue([
        {
          ...finalScore,
          awayTeam: 'New York Giants',
        },
      ]),
    } satisfies EspnScoreboardClient;
    const { handler, restore, send } = createHandler({ espnClient });

    const result = await handler();
    restore();

    expect(result).toMatchObject({
      status: 'success',
      gamesFinalized: 0,
      picksGraded: 0,
      picksSkipped: 0,
    });
    expect(
      send.mock.calls.some(([command]) => command instanceof UpdateCommand),
    ).toBe(false);
  });

  it('leaves terminal pick results alone when the conditional update fails', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 2 } });
      }
      if (command instanceof QueryCommand) {
        if (command.input.IndexName === 'GSI1') {
          return Promise.resolve({
            Items: [
              {
                playerId: 'player-1',
                gameId: 'seed-2026-w02-game-1',
                seasonWeek: '2026#W02',
                pickedTeam: 'Dallas Cowboys',
                spreadAtPick: 6.5,
                submittedAt: '2026-08-09T12:00:00.000Z',
                result: 'pending',
              },
              {
                playerId: 'player-2',
                gameId: 'seed-2026-w02-game-1',
                seasonWeek: '2026#W02',
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
              id: 'seed-2026-w02-game-1',
              awayTeam: 'Dallas Cowboys',
              homeTeam: 'Philadelphia Eagles',
              commenceTime: '2026-08-10T00:20:00.000Z',
            },
          ],
        });
      }
      if (
        command instanceof UpdateCommand &&
        typeof command.input.Key?.SK === 'string' &&
        command.input.Key.SK.startsWith('PICK#')
      ) {
        const error = new Error('already graded');
        error.name = 'ConditionalCheckFailedException';
        return Promise.reject(error);
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
      picksSkipped: 2,
    });
  });

  it('throws when ESPN fails so Scheduler can retry', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { handler, restore } = createHandler({
      espnClient: {
        fetchFinalScores: vi
          .fn()
          .mockRejectedValue(new Error('ESPN unavailable')),
      },
      logger,
    });

    await expect(handler()).rejects.toThrow('ESPN unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      'Grading failed',
      expect.any(Error),
    );
    restore();
  });
});
