import { parseStoredPushSubscription } from './web-push-sender.js';

describe('parseStoredPushSubscription', () => {
  it('returns a subscription when the item has endpoint keys', () => {
    expect(
      parseStoredPushSubscription(
        {
          SK: 'PUSH#device',
          endpoint: 'https://push.example/device',
          p256dh: 'p256',
          auth: 'auth',
        },
        'player-1',
      ),
    ).toEqual({
      endpoint: 'https://push.example/device',
      p256dh: 'p256',
      auth: 'auth',
      playerId: 'player-1',
      sortKey: 'PUSH#device',
    });
  });

  it('returns null when keys are missing', () => {
    expect(
      parseStoredPushSubscription({ SK: 'PUSH#device' }, 'player-1'),
    ).toBeNull();
  });
});
