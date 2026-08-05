export interface BoardPlayer {
  sub: string;
  displayName: string;
}

export const KENNY_SUB = 'kenny-sub';
export const JACK_SUB = 'jack-sub';
export const ERIC_SUB = 'eric-sub';

/** Fixed league roster in display order: Kenny, Jack, Eric. */
export const LEAGUE_ROSTER: readonly BoardPlayer[] = [
  { sub: KENNY_SUB, displayName: 'Kenny' },
  { sub: JACK_SUB, displayName: 'Jack' },
  { sub: ERIC_SUB, displayName: 'Eric' },
];
