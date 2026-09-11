import { useState } from 'react';
import {
  canUseWebPush,
  isIosDevice,
  isStandaloneDisplay,
  registerLocksServiceWorker,
  toPushSubscriptionRequest,
  vapidKeyToBytes,
} from '../lib/push';

interface NotificationPromptProps {
  accessToken: string;
  apiBaseUrl?: string;
  isIos?: boolean;
  isStandalone?: boolean;
  loadVapidKey: (accessToken: string, apiBaseUrl?: string) => Promise<string>;
  saveSubscription: (
    accessToken: string,
    subscription: {
      endpoint: string;
      expirationTime?: number | null;
      keys: { p256dh: string; auth: string };
    },
    apiBaseUrl?: string,
  ) => Promise<void>;
  onEnable?: () => Promise<void>;
}

export function NotificationPrompt({
  accessToken,
  apiBaseUrl,
  isIos = isIosDevice(),
  isStandalone = isStandaloneDisplay(),
  loadVapidKey,
  saveSubscription,
  onEnable,
}: NotificationPromptProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>(
    'idle',
  );

  if (isIos && !isStandalone) {
    return (
      <div className="border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold">Get pick alerts on this iPhone</p>
        <p className="mt-1 text-blue-900">
          Add Locks to your Home Screen, open it from that icon, then enable
          notifications.
        </p>
      </div>
    );
  }

  if (!canUseWebPush() && !onEnable) {
    return null;
  }

  if (status === 'done') {
    return (
      <p className="text-sm text-slate-600">Pick alerts are on for this device.</p>
    );
  }

  async function enableAlerts(): Promise<void> {
    setStatus('saving');
    try {
      if (onEnable) {
        await onEnable();
      } else {
        const registration = await registerLocksServiceWorker();
        if (!registration) {
          throw new Error('Push is not available');
        }
        const publicKey = await loadVapidKey(accessToken, apiBaseUrl);
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToBytes(publicKey),
        });
        const payload = toPushSubscriptionRequest(subscription);
        if (!payload) {
          throw new Error('Subscription was missing keys');
        }
        await saveSubscription(accessToken, payload, apiBaseUrl);
      }
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-700">
        Get a banner when somebody locks a pick.
      </p>
      <button
        className="bg-blue-950 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60"
        disabled={status === 'saving'}
        onClick={() => void enableAlerts()}
        type="button"
      >
        Enable pick alerts
      </button>
      {status === 'error' ? (
        <p className="text-sm text-red-800">Could not enable alerts.</p>
      ) : null}
    </div>
  );
}
