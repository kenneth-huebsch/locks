export interface BoardPlayer {
  sub: string;
  displayName: string;
}

export const KENNY_SUB = '94780408-b0d1-706f-0e5e-d4dbe28dfde0';
export const JACK_SUB = '74a854f8-20d1-70a4-7d77-d560ef23adb0';
export const KENNY_2_SUB = '0408b498-c0b1-7017-d3f4-1a82689ab2c0';

/** Fixed league roster in display order: Kenny, Jack, Kenny-2. */
export const LEAGUE_ROSTER: readonly BoardPlayer[] = [
  { sub: KENNY_SUB, displayName: 'Kenny' },
  { sub: JACK_SUB, displayName: 'Jack' },
  { sub: KENNY_2_SUB, displayName: 'Kenny-2' },
];
