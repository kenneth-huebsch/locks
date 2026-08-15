import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OddsApiClient } from '../lib/odds-api-client.js';
import {
  ODDS_API_SPREADS_PATH,
  createOddsApiClient,
  createSyncOddsHandler,
} from './sync-odds.js';
import { QUOTA_PARTITION_KEY } from '../../shared/dynamo.js';

const tableName = 'locks-table';
const oddsUpdatedAt = '2026-08-01T12:00:00.000Z';
const clock = { now: () => new Date(oddsUpdatedAt) };

const spreadEvent = {
  id: 'event-1',
  sport_key: 'americanfootball_nfl',
  sport_title: 'NFL',
  commence_time: '2026-09-10T00:20:00.000Z',
  home_team: 'Philadelphia Eagles',
  away_team: 'Dallas Cowboys',
  bookmakers: [
    {
      key: 'draftkings',
      title: 'DraftKings',
      markets: [
        {
          key: 'spreads',
          outcomes: [
            { name: 'Dallas Cowboys', price: -110, point: 3.5 },
            { name: 'Philadelphia Eagles', price: -110, point: -3.5 },
          ],
        },
      ],
    },
  ],
};

function createHandler(
  overrides: {
    enabled?: boolean;
    oddsClient?: OddsApiClient;
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
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });

  const handler = createSyncOddsHandler({
    dynamoClient: { send } as never,
    oddsClient:
      overrides.oddsClient ??
      ({
        fetchNflSpreads: vi.fn().mockResolvedValue({
          data: [spreadEvent],
          quota: { creditsUsed: 11, creditsRemaining: 489 },
        }),
        fetchNflEvents: vi.fn(),
        fetchNflScores: vi.fn(),
      } satisfies OddsApiClient),
    clock,
    tableName,
    logger: overrides.logger ?? { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  return {
    handler,
  restore() {
      if (previousEnabled === undefined) {
        delete process.env.ODDS_API_ENABLED;
      } else {
        process.env.ODDS_API_ENABLED = previousEnabled;
      }
    },
    send,
  };
}

describe('sync-odds handler', () => {
  it('skips when disabled', async () => {
    const { handler, restore } = createHandler({ enabled: false });
    const result = await handler();
    restore();

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('checks quota before calling the odds client', async () => {
    const httpGet = vi.fn();
    const { handler, restore, send } = createHandler({
      oddsClient: createOddsApiClient({
        apiKey: 'test-key',
        httpClient: { get: httpGet },
        clock,
        enabled: true,
      }),
      send: vi
        .fn()
        .mockResolvedValueOnce({ Item: { season: 2026, week: 1 } })
        .mockResolvedValueOnce({
          Items: [{ creditsRemaining: 25 }],
        }),
    });

    await expect(handler()).rejects.toThrow('credit reserve');
    restore();

    expect(httpGet).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses the active pointer and upserts games, week metadata, and quota records', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 2 } });
      }
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
    const { handler, restore } = createHandler({ send });
    const result = await handler();
    restore();

    expect(result).toEqual({
      status: 'success',
      gamesWritten: 1,
      seasonWeek: '2026#W02',
      advanced: false,
    });

    const puts = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutCommand);

    expect(puts).toHaveLength(2);
    const gamePut = puts.find((command) =>
      String(command.input.Item?.SK).startsWith('GAME#'),
    );
    expect(gamePut?.input.Item).toMatchObject({
      PK: 'WEEK#2026#W02',
      SK: 'GAME#event-1',
      awayAbbr: 'DAL',
      homeAbbr: 'PHI',
      status: 'scheduled',
    });
    const quotaPut = puts.find(
      (command) => command.input.Item?.PK === QUOTA_PARTITION_KEY,
    );
    expect(quotaPut?.input.Item).toMatchObject({
      PK: QUOTA_PARTITION_KEY,
      endpoint: ODDS_API_SPREADS_PATH,
      creditsUsed: 11,
      creditsRemaining: 489,
      ttl: Math.floor(new Date(oddsUpdatedAt).getTime() / 1000) + 30 * 24 * 60 * 60,
    });

    const metadataUpdate = send.mock.calls
      .map(([command]) => command)
      .find(
        (command) =>
          command instanceof UpdateCommand &&
          command.input.Key?.PK === 'WEEK#2026#W02',
      );
    expect(metadataUpdate?.input).toMatchObject({
      Key: { PK: 'WEEK#2026#W02', SK: 'META' },
      ExpressionAttributeValues: {
        ':seasonWeek': '2026#W02',
        ':oddsUpdatedAt': oddsUpdatedAt,
        ':open': 'open',
      },
    });
  });

  it('queries the latest quota record before syncing', async () => {
    const { handler, restore, send } = createHandler();
    await handler();
    restore();

    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': QUOTA_PARTITION_KEY,
      },
      ScanIndexForward: false,
      Limit: 1,
    });
  });

  it('advances exactly once for a stable Scheduler token and syncs the new week', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 1 } });
      }
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
    const { handler, restore } = createHandler({ send });

    const result = await handler({
      advanceWeek: true,
      advanceToken: '2026-08-18T02:00:00-04:00',
    });
    restore();

    expect(result).toMatchObject({
      status: 'success',
      seasonWeek: '2026#W02',
      advanced: true,
    });
    const pointerUpdate = send.mock.calls
      .map(([command]) => command)
      .find(
        (command) =>
          command instanceof UpdateCommand &&
          command.input.Key?.PK === 'SEASON#ACTIVE',
      );
    expect(pointerUpdate?.input.ExpressionAttributeValues).toMatchObject({
      ':season': 2026,
      ':currentWeek': 1,
      ':nextWeek': 2,
      ':token': '2026-08-18T02:00:00-04:00',
      ':weekStartsAt': '2026-08-18T06:00:00.000Z',
    });
  });

  it('does not advance twice when Scheduler retries the same token', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            season: 2026,
            week: 2,
            lastAdvanceToken: '2026-08-18T02:00:00-04:00',
          },
        });
      }
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
    const { handler, restore } = createHandler({ send });

    const result = await handler({
      advanceWeek: true,
      advanceToken: '2026-08-18T02:00:00-04:00',
    });
    restore();

    expect(result).toMatchObject({
      seasonWeek: '2026#W02',
      advanced: false,
    });
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof UpdateCommand &&
          command.input.Key?.PK === 'SEASON#ACTIVE',
      ),
    ).toBe(false);
  });

  it('caps automatic advancement at week 18', async () => {
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({ Item: { season: 2026, week: 18 } });
      }
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
    const { handler, restore } = createHandler({ send });

    const result = await handler({
      advanceWeek: true,
      advanceToken: '2026-12-29T02:00:00-05:00',
    });
    restore();

    expect(result).toMatchObject({
      seasonWeek: '2026#W18',
      advanced: false,
    });
  });

  it('requires a stable token for an advance invocation', async () => {
    const { handler, restore } = createHandler();
    await expect(handler({ advanceWeek: true })).rejects.toThrow(
      'advanceToken is required',
    );
    restore();
  });

  it('writes only games inside the active competition-week window', async () => {
    const nextWeekEvent = {
      ...spreadEvent,
      id: 'event-next-week',
      commence_time: '2026-08-26T00:20:00.000Z',
    };
    const send = vi.fn().mockImplementation((command) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            season: 2026,
            week: 2,
            weekStartsAt: '2026-08-18T06:00:00.000Z',
          },
        });
      }
      if (command instanceof QueryCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
    const { handler, restore } = createHandler({
      send,
      oddsClient: {
        fetchNflSpreads: vi.fn().mockResolvedValue({
          data: [
            {
              ...spreadEvent,
              commence_time: '2026-08-20T00:20:00.000Z',
            },
            nextWeekEvent,
          ],
          quota: { creditsUsed: 11, creditsRemaining: 489 },
        }),
        fetchNflEvents: vi.fn(),
        fetchNflScores: vi.fn(),
      } satisfies OddsApiClient,
    });

    const result = await handler();
    restore();

    expect(result.gamesWritten).toBe(1);
    const gameIds = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutCommand)
      .map((command) => command.input.Item?.id)
      .filter(Boolean);
    expect(gameIds).toEqual(['event-1']);
  });

  it('throws when the odds client fails so Scheduler can retry', async () => {
    const { handler, restore, send } = createHandler({
      oddsClient: {
        fetchNflSpreads: vi
          .fn()
          .mockRejectedValue(new Error('vendor unavailable')),
        fetchNflEvents: vi.fn(),
        fetchNflScores: vi.fn(),
      } satisfies OddsApiClient,
    });

    await expect(
      handler({
        advanceWeek: true,
        advanceToken: '2026-08-18T02:00:00-04:00',
      }),
    ).rejects.toThrow('vendor unavailable');
    restore();
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof UpdateCommand &&
          command.input.Key?.PK === 'SEASON#ACTIVE',
      ),
    ).toBe(false);
  });
});
