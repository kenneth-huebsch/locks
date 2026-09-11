import { describe, expect, it } from 'vitest';
import { vapidKeyToBytes } from './push';

describe('vapidKeyToBytes', () => {
  it('decodes a URL-safe base64 VAPID key', () => {
    const bytes = vapidKeyToBytes('AQID');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
