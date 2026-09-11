import { describe, expect, it } from 'vitest';
import {
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_SUBSCRIPTION_SORT_PREFIX,
  PUSH_VAPID_SORT_KEY,
  pushSubscriptionSortKey,
} from './dynamo.js';

describe('push key helpers', () => {
  it('stores VAPID keys under a single config item', () => {
    expect(PUSH_CONFIG_PARTITION_KEY).toBe('CONFIG#PUSH');
    expect(PUSH_VAPID_SORT_KEY).toBe('VAPID');
  });

  it('scopes subscriptions under a hashed endpoint sort key', () => {
    expect(pushSubscriptionSortKey('abc123')).toBe('PUSH#abc123');
    expect(PUSH_SUBSCRIPTION_SORT_PREFIX).toBe('PUSH#');
  });
});
