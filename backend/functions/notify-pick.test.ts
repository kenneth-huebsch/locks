import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_VAPID_SORT_KEY,
  playerPartitionKey,
} from '../../shared/dynamo.js';
import { JACK_SUB, KENNY_SUB } from '../../shared/roster.js';
import {
  createNotifyPickHandler,
  type DynamoNotifyClient,
  type PushSender,
} from './notify-pick.js';

const TABLE_NAME = 'locks';
const GAME_ID = 'game-1';

const gameItem = {
  id: GAME_ID,
  awayTeam: 'Dallas Cowboys',
  homeTeam: 'Philadelphia Eagles',
  awayAbbr: 'DAL',
  homeAbbr: 'PHI',
};

const kennyPick = {
  playerId: KENNY_SUB,
  gameId: GAME_ID,
  pickedTeam: 'Philadelphia Eagles',
  spreadAtPick: 3,
  seasonWeek: '2026#W01',
  submittedAt: '2026-09-09T12:00:00.000Z',
  result: 'pending',
};

const jackPick = {
  playerId: JACK_SUB,
  gameId: GAME_ID,
  pickedTeam: 'Dallas Cowboys',
  spreadAtPick: -3,
};

const jackSubscription = {
  SK: 'PUSH#jack-device',
  endpoint: 'https://push.example/jack',
  p256dh: 'p256',
  auth: 'auth',
};

function createHandler(
  send: ReturnType<typeof vi.fn>,
  pushSender: PushSender,
) {
  return createNotifyPickHandler({
    dynamoClient: { send } as DynamoNotifyClient,
    tableName: TABLE_NAME,
    pushSender,
    logger: { error: vi.fn(), warn: vi.fn() },
  });
}

describe('notify-pick handler', () => {
  it('sends one swing message to everyone except the picker', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: gameItem })
      .mockResolvedValueOnce({ Items: [jackPick, kennyPick] })
      .mockResolvedValueOnce({
        Item: {
          PK: PUSH_CONFIG_PARTITION_KEY,
          SK: PUSH_VAPID_SORT_KEY,
          publicKey: 'pub',
          privateKey: 'priv',
        },
      })
      .mockResolvedValueOnce({ Items: [jackSubscription] })
      .mockResolvedValueOnce({ Items: [] });
    const sendPush = vi.fn().mockResolvedValue('ok');
    const handler = createHandler(send, { send: sendPush });

    await handler({
      pickerSub: KENNY_SUB,
      gameId: GAME_ID,
      pickedTeam: 'Philadelphia Eagles',
      spreadAtPick: 3,
      season: 2026,
      week: 1,
    });

    expect(sendPush).toHaveBeenCalledOnce();
    expect(sendPush.mock.calls[0]?.[1]).toBe('🚨 Kenny swung Philadelphia +3');
    expect(sendPush.mock.calls[0]?.[0]).toMatchObject({
      endpoint: jackSubscription.endpoint,
      playerId: JACK_SUB,
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetCommand);
  });

  it('sends a lock message when nobody else took the other side', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: gameItem })
      .mockResolvedValueOnce({ Items: [kennyPick] })
      .mockResolvedValueOnce({
        Item: { publicKey: 'pub', privateKey: 'priv' },
      })
      .mockResolvedValueOnce({ Items: [jackSubscription] })
      .mockResolvedValueOnce({ Items: [] });
    const sendPush = vi.fn().mockResolvedValue('ok');
    const handler = createHandler(send, { send: sendPush });

    await handler({
      pickerSub: KENNY_SUB,
      gameId: GAME_ID,
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: -3,
      season: 2026,
      week: 1,
    });

    expect(sendPush).toHaveBeenCalledOnce();
    expect(sendPush.mock.calls[0]?.[1]).toBe('🔒 Kenny locked Dallas -3');
  });

  it('marks gone subscriptions invalid', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: gameItem })
      .mockResolvedValueOnce({ Items: [kennyPick] })
      .mockResolvedValueOnce({
        Item: { publicKey: 'pub', privateKey: 'priv' },
      })
      .mockResolvedValueOnce({ Items: [jackSubscription] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const sendPush = vi.fn().mockResolvedValue('gone');
    const handler = createHandler(send, { send: sendPush });

    await handler({
      pickerSub: KENNY_SUB,
      gameId: GAME_ID,
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: -3,
      season: 2026,
      week: 1,
    });

    const update = send.mock.calls.find(
      ([command]) => command instanceof UpdateCommand,
    );
    expect(update?.[0].input.Key).toEqual({
      PK: playerPartitionKey(JACK_SUB),
      SK: jackSubscription.SK,
    });
  });
});
