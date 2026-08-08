import { describe, expect, it } from 'vitest';
import {
  JACK_SUB,
  KENNY_2_SUB,
  KENNY_SUB,
  LEAGUE_ROSTER,
} from './players';

describe('LEAGUE_ROSTER', () => {
  it('lists Kenny, Jack, and Kenny-2 in order with league subs', () => {
    expect(LEAGUE_ROSTER).toHaveLength(3);
    expect(LEAGUE_ROSTER.map((player) => player.displayName)).toEqual([
      'Kenny',
      'Jack',
      'Kenny-2',
    ]);
    expect(LEAGUE_ROSTER.map((player) => player.sub)).toEqual([
      KENNY_SUB,
      JACK_SUB,
      KENNY_2_SUB,
    ]);
  });
});
