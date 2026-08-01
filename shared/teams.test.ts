import { describe, expect, it } from 'vitest';

import { TEAMS, getTeamByAbbr, getTeamByName } from './teams.js';

describe('NFL team mappings', () => {
  it('includes all 32 teams', () => {
    expect(TEAMS).toHaveLength(32);
  });

  it('has no duplicate abbreviations', () => {
    const abbreviations = TEAMS.map((team) => team.abbreviation);
    expect(new Set(abbreviations).size).toBe(abbreviations.length);
  });

  it('has no duplicate full names', () => {
    const fullNames = TEAMS.map((team) => team.fullName);
    expect(new Set(fullNames).size).toBe(fullNames.length);
  });

  it('returns the correct team by abbreviation', () => {
    expect(getTeamByAbbr('PHI')).toEqual({
      fullName: 'Philadelphia Eagles',
      abbreviation: 'PHI',
      city: 'Philadelphia',
      nickname: 'Eagles',
    });
    expect(getTeamByAbbr('DAL')).toEqual({
      fullName: 'Dallas Cowboys',
      abbreviation: 'DAL',
      city: 'Dallas',
      nickname: 'Cowboys',
    });
  });

  it('returns the correct team by full name', () => {
    expect(getTeamByName('Philadelphia Eagles')).toEqual({
      fullName: 'Philadelphia Eagles',
      abbreviation: 'PHI',
      city: 'Philadelphia',
      nickname: 'Eagles',
    });
    expect(getTeamByName('Kansas City Chiefs')).toEqual({
      fullName: 'Kansas City Chiefs',
      abbreviation: 'KC',
      city: 'Kansas City',
      nickname: 'Chiefs',
    });
  });

  it('returns undefined for unknown lookups', () => {
    expect(getTeamByAbbr('XYZ')).toBeUndefined();
    expect(getTeamByName('Fake Team')).toBeUndefined();
  });
});
