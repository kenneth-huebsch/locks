import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
    vi
      .fn()
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: { season: 2026 } })
      .mockResolvedValue({});

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
      send: vi.fn().mockResolvedValueOnce({
        Items: [{ creditsRemaining: 25 }],
      }),
    });

    const result = await handler();
    restore();

    expect(result.status).toBe('error');
    expect(result.reason).toContain('credit reserve');
    expect(httpGet).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('upserts games, week metadata, and quota records', async () => {
    const { handler, restore, send } = createHandler();
    const result = await handler();
    restore();

    expect(result).toEqual({ status: 'success', gamesWritten: 1 });

    const puts = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutCommand);

    expect(puts).toHaveLength(3);
    expect(puts[0]?.input.Item).toMatchObject({
      PK: 'WEEK#2026#W01',
      SK: 'GAME#event-1',
      awayAbbr: 'DAL',
      homeAbbr: 'PHI',
      status: 'scheduled',
    });
    expect(puts[1]?.input.Item).toMatchObject({
      PK: 'WEEK#2026#W01',
      SK: 'META',
      oddsUpdatedAt,
    });
    expect(puts[2]?.input.Item).toMatchObject({
      PK: QUOTA_PARTITION_KEY,
      endpoint: ODDS_API_SPREADS_PATH,
      creditsUsed: 11,
      creditsRemaining: 489,
      ttl: Math.floor(new Date(oddsUpdatedAt).getTime() / 1000) + 30 * 24 * 60 * 60,
    });
  });

  it('queries the latest quota record before syncing', async () => {
    const { handler, restore, send } = createHandler();
    await handler();
    restore();

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': QUOTA_PARTITION_KEY,
      },
      ScanIndexForward: false,
      Limit: 1,
    });
  });

  it('returns an error result when the odds client fails', async () => {
    const { handler, restore } = createHandler({
      oddsClient: {
        fetchNflSpreads: vi
          .fn()
          .mockRejectedValue(new Error('vendor unavailable')),
        fetchNflEvents: vi.fn(),
        fetchNflScores: vi.fn(),
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
