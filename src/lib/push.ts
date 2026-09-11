import type { PushSubscriptionRequest } from '../../shared/types';

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  const media = window.matchMedia('(display-mode: standalone)').matches;
  const safariStandalone =
    'standalone' in window.navigator &&
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return media || safariStandalone;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function canUseWebPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function vapidKeyToBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
  const base64 = (publicKey + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export function toPushSubscriptionRequest(
  subscription: PushSubscription,
): PushSubscriptionRequest | null {
  const json = subscription.toJSON();
  if (
    typeof json.endpoint !== 'string' ||
    typeof json.keys?.p256dh !== 'string' ||
    typeof json.keys.auth !== 'string'
  ) {
    return null;
  }

  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };
}

export async function registerLocksServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!canUseWebPush()) {
    return undefined;
  }

  return navigator.serviceWorker.register('/sw.js');
}
