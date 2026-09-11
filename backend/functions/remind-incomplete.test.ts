import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_VAPID_SORT_KEY,
  counterSortKey,
  playerPartitionKey,
} from '../../shared/dynamo.js';
import { ERIC_SUB, JACK_SUB, KENNY_SUB } from '../../shared/roster.js';
import {
  createRemindIncompleteHandler,
  type DynamoRemindClient,
} from './remind-incomplete.js';
import type { PushSender } from '../lib/web-push-sender.js';

const TABLE_NAME = 'locks';
const SEASON = 2026;
const WEEK = 1;

const ROSTER = [
  {
    sub: KENNY_SUB,
    displayName: 'Kenny',
    portraitUrl: '/players/kenny.jpg',
  },
  {
    sub: JACK_SUB,
    displayName: 'Jack',
    portraitUrl: '/players/jack.jpg',
  },
  {
    sub: ERIC_SUB,
    displayName: 'Eric',
    portraitUrl: '/players/eric.jpg',
  },
] as const;

const kennySubscription = {
  SK: 'PUSH#kenny-device',
  endpoint: 'https://push.example/kenny',
  p256dh: 'p256',
  auth: 'auth',
};

function createHandler(
  send: ReturnType<typeof vi.fn>,
  pushSender: PushSender,
) {
  return createRemindIncompleteHandler({
    dynamoClient: { send } as DynamoRemindClient,
    tableName: TABLE_NAME,
    pushSender,
    roster: ROSTER,
    logger: { error: vi.fn(), warn: vi.fn() },
  });
}

function activeSeasonAndVapid(send: ReturnType<typeof vi.fn>): void {
  send.mockResolvedValueOnce({
    Item: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
      season: SEASON,
      week: WEEK,
    },
  });
  send.mockResolvedValueOnce({
    Item: {
      PK: PUSH_CONFIG_PARTITION_KEY,
      SK: PUSH_VAPID_SORT_KEY,
      publicKey: 'pub',
      privateKey: 'priv',
    },
  });
}

describe('remind-incomplete handler', () => {
  it('sends a reminder to incomplete players with a valid push subscription', async () => {
    const send = vi.fn();
    activeSeasonAndVapid(send);
    send
      .mockResolvedValueOnce({
        Item: {
          PK: playerPartitionKey(KENNY_SUB),
          SK: counterSortKey(SEASON, WEEK),
          pickCount: 1,
        },
      })
      .mockResolvedValueOnce({
        Item: {
          PK: playerPartitionKey(JACK_SUB),
          SK: counterSortKey(SEASON, WEEK),
          pickCount: 3,
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [kennySubscription] })
      .mockResolvedValueOnce({ Items: [] });
    const sendPush = vi.fn().mockResolvedValue('ok');
    const handler = createHandler(send, { send: sendPush });

    await handler();

    expect(sendPush).toHaveBeenCalledOnce();
    expect(sendPush.mock.calls[0]?.[1]).toBe(
      'You still have 2 locks left. Open Locks and get them in.',
    );
    expect(sendPush.mock.calls[0]?.[0]).toMatchObject({
      endpoint: kennySubscription.endpoint,
      playerId: KENNY_SUB,
    });
    expect(
      send.mock.calls.some(([command]) => command instanceof QueryCommand),
    ).toBe(true);
    expect(
      send.mock.calls.some(([command]) => command instanceof GetCommand),
    ).toBe(true);
  });

  it('does not send when nobody is incomplete', async () => {
    const send = vi.fn();
    activeSeasonAndVapid(send);
    send
      .mockResolvedValueOnce({ Item: { pickCount: 3 } })
      .mockResolvedValueOnce({ Item: { pickCount: 3 } })
      .mockResolvedValueOnce({ Item: { pickCount: 3 } });
    const sendPush = vi.fn().mockResolvedValue('ok');
    const handler = createHandler(send, { send: sendPush });

    await handler();

    expect(sendPush).not.toHaveBeenCalled();
    expect(
      send.mock.calls.some(([command]) => command instanceof QueryCommand),
    ).toBe(false);
  });

  it('skips incomplete players who have no valid push subscription', async () => {
    const send = vi.fn();
    activeSeasonAndVapid(send);
    send
      .mockResolvedValueOnce({ Item: { pickCount: 0 } })
      .mockResolvedValueOnce({ Item: { pickCount: 3 } })
      .mockResolvedValueOnce({ Item: { pickCount: 3 } })
      .mockResolvedValueOnce({ Items: [] });
    const sendPush = vi.fn().mockResolvedValue('ok');
    const handler = createHandler(send, { send: sendPush });

    await handler();

    expect(sendPush).not.toHaveBeenCalled();
  });

  it('marks gone subscriptions invalid', async () => {
    const send = vi.fn();
    activeSeasonAndVapid(send);
    send
      .mockResolvedValueOnce({ Item: { pickCount: 2 } })
      .mockResolvedValueOnce({ Item: { pickCount: 3 } })
      .mockResolvedValueOnce({ Item: { pickCount: 3 } })
      .mockResolvedValueOnce({ Items: [kennySubscription] })
      .mockResolvedValueOnce({});
    const sendPush = vi.fn().mockResolvedValue('gone');
    const handler = createHandler(send, { send: sendPush });

    await handler();

    const update = send.mock.calls.find(
      ([command]) => command instanceof UpdateCommand,
    );
    expect(update?.[0].input.Key).toEqual({
      PK: playerPartitionKey(KENNY_SUB),
      SK: kennySubscription.SK,
    });
  });
});
