export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  playerId: string;
}

export interface PushSender {
  send(
    subscription: StoredPushSubscription,
    payload: string,
    vapid: { publicKey: string; privateKey: string },
  ): Promise<'ok' | 'gone'>;
}

export const VAPID_SUBJECT = 'mailto:kenneth.huebsch@gmail.com';

export function parseStoredPushSubscription(
  item: Record<string, unknown>,
  playerId: string,
): (StoredPushSubscription & { sortKey: string }) | null {
  if (
    typeof item.endpoint !== 'string' ||
    typeof item.p256dh !== 'string' ||
    typeof item.auth !== 'string' ||
    typeof item.SK !== 'string'
  ) {
    return null;
  }

  return {
    endpoint: item.endpoint,
    p256dh: item.p256dh,
    auth: item.auth,
    playerId,
    sortKey: item.SK,
  };
}

export function createWebPushSender(): PushSender {
  return {
    async send(subscription, payload, vapid) {
      const webPush = await import('web-push');
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          {
            vapidDetails: {
              subject: VAPID_SUBJECT,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
          },
        );
        return 'ok';
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          return 'gone';
        }
        throw error;
      }
    },
  };
}
