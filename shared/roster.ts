export interface LeaguePlayer {
  sub: string;
  displayName: string;
  portraitUrl: string;
}

export const KENNY_SUB = '94780408-b0d1-706f-0e5e-d4dbe28dfde0';
export const JACK_SUB = '74a854f8-20d1-70a4-7d77-d560ef23adb0';
export const ERIC_SUB = '0408b498-c0b1-7017-d3f4-1a82689ab2c0';

export const LEAGUE_ROSTER: readonly LeaguePlayer[] = [
  {
    sub: KENNY_SUB,
    displayName: 'Kenny',
    portraitUrl: '/players/kenny.jpg',
  },
  {
    sub: JACK_SUB,
    displayName: 'Jack',
    portraitUrl: '/players/jack.jpg',
  },
  {
    sub: ERIC_SUB,
    displayName: 'Eric',
    portraitUrl: '/players/eric.jpg',
  },
];
