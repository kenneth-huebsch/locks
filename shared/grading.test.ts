import { describe, expect, it } from 'vitest';

import { gradeAgainstTheSpread } from './grading.js';

describe('gradeAgainstTheSpread', () => {
  const matchup = {
    awayTeam: 'Dallas Cowboys',
    homeTeam: 'Philadelphia Eagles',
  };

  it('grades an away underdog win with a half spread', () => {
    // Away +6.5, final 20-24 → adjusted 26.5 > 24
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Dallas Cowboys',
        spreadAtPick: 6.5,
        awayScore: 20,
        homeScore: 24,
      }),
    ).toBe('win');
  });

  it('grades an away underdog loss with a half spread', () => {
    // Away +6.5, final 14-24 → adjusted 20.5 < 24
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Dallas Cowboys',
        spreadAtPick: 6.5,
        awayScore: 14,
        homeScore: 24,
      }),
    ).toBe('loss');
  });

  it('grades an exact spread-tie as push with a whole spread', () => {
    // Away +7, final 17-24 → adjusted 24 == 24
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Dallas Cowboys',
        spreadAtPick: 7,
        awayScore: 17,
        homeScore: 24,
      }),
    ).toBe('push');
  });

  it('grades a home favorite win with a half spread', () => {
    // Home -3.5, final 27-20 → adjusted 23.5 > 20
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Philadelphia Eagles',
        spreadAtPick: -3.5,
        awayScore: 20,
        homeScore: 27,
      }),
    ).toBe('win');
  });

  it('grades a home favorite loss with a half spread', () => {
    // Home -3.5, final 21-20 → adjusted 17.5 < 20
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Philadelphia Eagles',
        spreadAtPick: -3.5,
        awayScore: 20,
        homeScore: 21,
      }),
    ).toBe('loss');
  });

  it('grades a home favorite push with a whole spread', () => {
    // Home -3, final 24-21 → adjusted 21 == 21
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Philadelphia Eagles',
        spreadAtPick: -3,
        awayScore: 21,
        homeScore: 24,
      }),
    ).toBe('push');
  });

  it('grades an away favorite covering', () => {
    // Away -6.5, final 31-20 → adjusted 24.5 > 20
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Dallas Cowboys',
        spreadAtPick: -6.5,
        awayScore: 31,
        homeScore: 20,
      }),
    ).toBe('win');
  });

  it('grades a home underdog covering', () => {
    // Home +3.5, final 17-20 → adjusted 20.5 > 20
    expect(
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Philadelphia Eagles',
        spreadAtPick: 3.5,
        awayScore: 20,
        homeScore: 17,
      }),
    ).toBe('win');
  });

  it('throws when the picked team is not in the matchup', () => {
    expect(() =>
      gradeAgainstTheSpread({
        ...matchup,
        pickedTeam: 'Kansas City Chiefs',
        spreadAtPick: 3,
        awayScore: 10,
        homeScore: 17,
      }),
    ).toThrow(/neither away/);
  });
});
