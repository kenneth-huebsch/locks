import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_VAPID_SORT_KEY,
  playerPartitionKey,
} from '../../shared/dynamo.js';
import {
  createPushSubscriptionHandler,
  type ApiGatewayJwtEvent,
  type DynamoPushClient,
} from './push-subscription.js';

const TABLE_NAME = 'locks';
const PLAYER_SUB = 'cognito-sub-123';
const VAPID = { publicKey: 'pub', privateKey: 'priv' };

function createEvent(
  routeKey: string,
  body?: unknown,
): ApiGatewayJwtEvent {
  return {
    routeKey,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      authorizer: {
        jwt: {
          claims: { sub: PLAYER_SUB },
        },
      },
    },
  };
}

function createHandler(send: ReturnType<typeof vi.fn>) {
  return createPushSubscriptionHandler({
    dynamoClient: { send } as DynamoPushClient,
    tableName: TABLE_NAME,
    generateVapidKeys: () => VAPID,
    logger: { error: vi.fn() },
  });
}

describe('push-subscription handler', () => {
  it('returns the stored VAPID public key', async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Item: { publicKey: 'stored-pub', privateKey: 'stored-priv' },
    });
    const handler = createHandler(send);

    const response = await handler(createEvent('GET /api/push/vapid'));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ publicKey: 'stored-pub' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetCommand);
  });

  it('creates VAPID keys when none exist', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});
    const handler = createHandler(send);

    const response = await handler(createEvent('GET /api/push/vapid'));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ publicKey: VAPID.publicKey });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(PutCommand);
    expect(send.mock.calls[1]?.[0].input.Item).toMatchObject({
      PK: PUSH_CONFIG_PARTITION_KEY,
      SK: PUSH_VAPID_SORT_KEY,
      publicKey: VAPID.publicKey,
    });
  });

  it('stores a device subscription under the player', async () => {
    const send = vi.fn().mockResolvedValueOnce({});
    const handler = createHandler(send);
    const subscription = {
      endpoint: 'https://push.example/device-1',
      keys: { p256dh: 'p256', auth: 'auth-key' },
    };

    const response = await handler(
      createEvent('PUT /api/push/subscription', subscription),
    );

    expect(response.statusCode).toBe(204);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutCommand);
    expect(send.mock.calls[0]?.[0].input.Item).toMatchObject({
      PK: playerPartitionKey(PLAYER_SUB),
      SK: expect.stringMatching(/^PUSH#[0-9a-f]{64}$/),
      endpoint: subscription.endpoint,
      p256dh: 'p256',
      auth: 'auth-key',
      invalid: false,
    });
  });

  it('rejects a malformed subscription', async () => {
    const send = vi.fn();
    const handler = createHandler(send);

    const response = await handler(
      createEvent('PUT /api/push/subscription', { endpoint: '' }),
    );

    expect(response.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});
