export interface FoundationWeek {
  season: number;
  week: number;
}

export interface FoundationGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  commenceTime: string;
  status: 'scheduled';
}

export interface CurrentWeekResponse extends FoundationWeek {
  games: FoundationGame[];
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export const FOUNDATION_WEEK = {
  season: 2026,
  week: 1,
} as const satisfies FoundationWeek;

export const FOUNDATION_WEEK_KEY =
  `WEEK#${FOUNDATION_WEEK.season}#${String(FOUNDATION_WEEK.week).padStart(2, '0')}` as const;

export const FOUNDATION_GAME = {
  id: 'foundation-week-1-game',
  awayTeam: 'Dallas Cowboys',
  homeTeam: 'Philadelphia Eagles',
  commenceTime: '2026-09-10T00:20:00.000Z',
  status: 'scheduled',
} as const satisfies FoundationGame;

export const FOUNDATION_GAME_ITEM = {
  PK: FOUNDATION_WEEK_KEY,
  SK: `GAME#${FOUNDATION_GAME.id}`,
  ...FOUNDATION_GAME,
} as const;
