export interface BoardPlayer {
  sub: string;
  displayName: string;
}

export const KENNY_SUB = '24a8f498-30c1-70ad-4a0e-7e19c41aa52d';
export const JACK_SUB = 'd4786428-20f1-706e-4859-0106786a1438';
export const ERIC_SUB = 'eric-sub';

/** Fixed league roster in display order: Kenny, Jack, Eric. */
export const LEAGUE_ROSTER: readonly BoardPlayer[] = [
  { sub: KENNY_SUB, displayName: 'Kenny' },
  { sub: JACK_SUB, displayName: 'Jack' },
  { sub: ERIC_SUB, displayName: 'Eric' },
];
