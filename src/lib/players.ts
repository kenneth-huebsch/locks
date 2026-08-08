export interface BoardPlayer {
  sub: string;
  displayName: string;
}

export const KENNY_SUB = '24a8f498-30c1-70ad-4a0e-7e19c41aa52d';
export const JACK_SUB = 'd4786428-20f1-706e-4859-0106786a1438';
export const KENNY_2_SUB = '74886468-f081-7075-48c8-17f35e06d95e';

/** Fixed league roster in display order: Kenny, Jack, Kenny-2. */
export const LEAGUE_ROSTER: readonly BoardPlayer[] = [
  { sub: KENNY_SUB, displayName: 'Kenny' },
  { sub: JACK_SUB, displayName: 'Jack' },
  { sub: KENNY_2_SUB, displayName: 'Kenny-2' },
];
