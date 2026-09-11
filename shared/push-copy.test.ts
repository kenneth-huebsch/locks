import { describe, expect, it } from 'vitest';
import { ERIC_SUB, JACK_SUB, KENNY_SUB } from './roster.js';
import {
  formatPickNotification,
  isSwingAgainstPeers,
} from './push-copy.js';
import type { Pick as PickRecord } from './types.js';

const dallasPhilly = {
  awayTeam: 'Dallas Cowboys',
  homeTeam: 'Philadelphia Eagles',
  awayAbbr: 'DAL',
  homeAbbr: 'PHI',
};

function pick(
  playerId: string,
  pickedTeam: string,
  spreadAtPick: number,
): PickRecord {
  return {
    playerId,
    gameId: 'game-1',
    seasonWeek: '2026#W01',
    pickedTeam,
    spreadAtPick,
    submittedAt: '2026-09-09T12:00:00.000Z',
    result: 'pending',
  };
}

describe('formatPickNotification', () => {
  it('formats a lock using the team city and spread', () => {
    expect(
      formatPickNotification({
        displayName: 'Kenny',
        pickedTeam: 'Dallas Cowboys',
        spreadAtPick: -3,
        isSwing: false,
      }),
    ).toBe('🔒 Kenny locked Dallas -3');
  });

  it('formats a swing with the alert emoji', () => {
    expect(
      formatPickNotification({
        displayName: 'Kenny',
        pickedTeam: 'DAL',
        spreadAtPick: -3.5,
        isSwing: true,
      }),
    ).toBe('🚨 Kenny swung Dallas -3.5');
  });
});

describe('isSwingAgainstPeers', () => {
  it('is false when nobody else has picked the game', () => {
    expect(
      isSwingAgainstPeers(
        KENNY_SUB,
        'Dallas Cowboys',
        'game-1',
        [pick(KENNY_SUB, 'Dallas Cowboys', -3)],
        dallasPhilly,
      ),
    ).toBe(false);
  });

  it('is false when a peer picked the same side', () => {
    expect(
      isSwingAgainstPeers(
        KENNY_SUB,
        'Dallas Cowboys',
        'game-1',
        [
          pick(JACK_SUB, 'DAL', -3),
          pick(KENNY_SUB, 'Dallas Cowboys', -3),
        ],
        dallasPhilly,
      ),
    ).toBe(false);
  });

  it('is true when a peer picked the opposite side', () => {
    expect(
      isSwingAgainstPeers(
        KENNY_SUB,
        'Philadelphia Eagles',
        'game-1',
        [
          pick(JACK_SUB, 'Dallas Cowboys', -3),
          pick(ERIC_SUB, 'PHI', 3),
          pick(KENNY_SUB, 'Philadelphia Eagles', 3),
        ],
        dallasPhilly,
      ),
    ).toBe(true);
  });
});
