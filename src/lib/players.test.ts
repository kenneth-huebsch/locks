import { describe, expect, it } from 'vitest';
import {
  JACK_SUB,
  KENNY_2_SUB,
  KENNY_SUB,
  LEAGUE_ROSTER,
} from './players';

describe('LEAGUE_ROSTER', () => {
  it('lists Kenny, Jack, and Eric with portraits in league order', () => {
    expect(LEAGUE_ROSTER).toHaveLength(3);
    expect(LEAGUE_ROSTER.map((player) => player.displayName)).toEqual([
      'Kenny',
      'Jack',
      'Eric',
    ]);
    expect(LEAGUE_ROSTER.map((player) => player.sub)).toEqual([
      KENNY_SUB,
      JACK_SUB,
      KENNY_2_SUB,
    ]);
    expect(LEAGUE_ROSTER.map((player) => player.portraitUrl)).toEqual([
      '/players/kenny.jpg',
      '/players/jack.jpg',
      '/players/eric.jpg',
    ]);
  });
});
