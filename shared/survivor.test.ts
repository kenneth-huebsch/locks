import { describe, expect, it } from 'vitest';

import { resolveSurvivorWeek, survivorCanPick } from './survivor.js';
import type { SurvivorPick, SurvivorPlayerState } from './types.js';

function player(
  id: string,
  status: SurvivorPlayerState['status'] = 'alive',
): SurvivorPlayerState {
  return { playerId: id, status, usedTeams: [] };
}

function pick(
  playerId: string,
  result: SurvivorPick['result'],
): SurvivorPick {
  return {
    playerId,
    gameId: 'g1',
    seasonWeek: '2026#W03',
    pickedTeam: 'Dallas Cowboys',
    submittedAt: '2026-09-20T00:00:00.000Z',
    result,
  };
}

describe('resolveSurvivorWeek', () => {
  it('eliminates a player on a loss and declares the sole survivor the winner', () => {
    const result = resolveSurvivorWeek({
      season: 2026,
      week: 3,
      challengeStatus: 'active',
      players: [player('a'), player('b'), player('c')],
      picks: [pick('a', 'loss'), pick('b', 'win'), pick('c', 'loss')],
      allGamesFinal: false,
    });

    expect(result.challengeStatus).toBe('complete');
    expect(result.winners).toEqual(['b']);
    expect(result.players.find((p) => p.playerId === 'b')?.status).toBe(
      'winner',
    );
    expect(result.eliminatedThisWeek).toEqual(['a', 'c']);
  });

  it('treats mass elimination as co-winners of those alive entering the week', () => {
    const result = resolveSurvivorWeek({
      season: 2026,
      week: 5,
      challengeStatus: 'active',
      players: [
        player('a'),
        player('b'),
        { playerId: 'c', status: 'eliminated', usedTeams: [], eliminatedWeek: '2026#W02' },
      ],
      picks: [pick('a', 'loss'), pick('b', 'loss')],
      allGamesFinal: true,
    });

    expect(result.challengeStatus).toBe('complete');
    expect(result.winners).toEqual(['a', 'b']);
  });

  it('eliminates missed picks only when all games are final', () => {
    const midWeek = resolveSurvivorWeek({
      season: 2026,
      week: 4,
      challengeStatus: 'active',
      players: [player('a'), player('b')],
      picks: [pick('a', 'win')],
      allGamesFinal: false,
    });
    expect(midWeek.players.find((p) => p.playerId === 'b')?.status).toBe(
      'alive',
    );
    expect(midWeek.challengeStatus).toBe('active');

    const endWeek = resolveSurvivorWeek({
      season: 2026,
      week: 4,
      challengeStatus: 'active',
      players: [player('a'), player('b')],
      picks: [pick('a', 'win')],
      allGamesFinal: true,
    });
    expect(endWeek.challengeStatus).toBe('complete');
    expect(endWeek.winners).toEqual(['a']);
    expect(endWeek.eliminatedThisWeek).toEqual(['b']);
  });

  it('declares Week 18 co-winners when multiple remain', () => {
    const result = resolveSurvivorWeek({
      season: 2026,
      week: 18,
      challengeStatus: 'active',
      players: [player('a'), player('b')],
      picks: [pick('a', 'win'), pick('b', 'win')],
      allGamesFinal: true,
    });

    expect(result.challengeStatus).toBe('complete');
    expect(result.winners).toEqual(['a', 'b']);
  });
});

describe('survivorCanPick', () => {
  it('allows an alive player without a pick while the challenge is active', () => {
    expect(
      survivorCanPick({
        challengeStatus: 'active',
        myStatus: 'alive',
        hasPickThisWeek: false,
      }),
    ).toBe(true);
  });

  it('blocks eliminated players and completed challenges', () => {
    expect(
      survivorCanPick({
        challengeStatus: 'active',
        myStatus: 'eliminated',
        hasPickThisWeek: false,
      }),
    ).toBe(false);
    expect(
      survivorCanPick({
        challengeStatus: 'complete',
        myStatus: 'alive',
        hasPickThisWeek: false,
      }),
    ).toBe(false);
  });
});
