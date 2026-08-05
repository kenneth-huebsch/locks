import { describe, expect, it } from 'vitest';
import type { Pick } from '../../shared/types';
import {
  computePlayerRecord,
  computePlayerRecordsById,
  formatPlayerRecord,
} from './records';

function pick(
  playerId: string,
  result: Pick['result'],
  gameId = 'g1',
): Pick {
  return {
    playerId,
    gameId,
    seasonWeek: '2026#W01',
    pickedTeam: 'Team',
    spreadAtPick: -3,
    submittedAt: '2026-09-09T18:00:00.000Z',
    result,
  };
}

describe('computePlayerRecord', () => {
  it('counts wins, losses, and pushes', () => {
    expect(
      computePlayerRecord([
        pick('kenny', 'win'),
        pick('kenny', 'loss', 'g2'),
        pick('kenny', 'push', 'g3'),
      ]),
    ).toEqual({ wins: 1, losses: 1, pushes: 1 });
  });

  it('ignores pending picks', () => {
    expect(
      computePlayerRecord([
        pick('kenny', 'win'),
        pick('kenny', 'pending', 'g2'),
      ]),
    ).toEqual({ wins: 1, losses: 0, pushes: 0 });
  });

  it('returns zeroes for an empty pick list', () => {
    expect(computePlayerRecord([])).toEqual({ wins: 0, losses: 0, pushes: 0 });
  });
});

describe('formatPlayerRecord', () => {
  it('formats as W-L-T', () => {
    expect(formatPlayerRecord({ wins: 2, losses: 1, pushes: 0 })).toBe('2-1-0');
  });
});

describe('computePlayerRecordsById', () => {
  it('builds cumulative records per player across weeks', () => {
    const picks: Pick[] = [
      pick('kenny', 'win', 'w1-g1'),
      pick('kenny', 'push', 'w1-g2'),
      pick('jack', 'loss', 'w1-g1'),
      pick('kenny', 'win', 'w2-g1'),
      pick('kenny', 'loss', 'w2-g2'),
      pick('jack', 'win', 'w2-g2'),
    ];

    expect(computePlayerRecordsById(picks)).toEqual({
      kenny: '2-1-1',
      jack: '1-1-0',
    });
  });

  it('excludes pending picks from each player record', () => {
    expect(
      computePlayerRecordsById([
        pick('kenny', 'win'),
        pick('kenny', 'pending', 'g2'),
        pick('jack', 'pending', 'g3'),
      ]),
    ).toEqual({
      kenny: '1-0-0',
      jack: '0-0-0',
    });
  });
});
