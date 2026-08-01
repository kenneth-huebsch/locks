export interface Game {
  id: string;
  awayTeam: string;
  homeTeam: string;
  awayAbbr: string;
  homeAbbr: string;
  commenceTime: string;
  awaySpread: number;
  homeSpread: number;
  status: 'scheduled' | 'in_progress' | 'final';
  bookmaker: string;
  oddsUpdatedAt: string;
}

export interface Pick {
  playerId: string;
  gameId: string;
  seasonWeek: string;
  pickedTeam: string;
  spreadAtPick: number;
  submittedAt: string;
  result: 'pending' | 'win' | 'loss' | 'push';
}

export interface Player {
  sub: string;
  email: string;
  displayName: string;
}

export interface Week {
  season: number;
  week: number;
  status: 'open' | 'grading' | 'complete';
  seasonWeek: string;
}

export interface QuotaRecord {
  timestamp: string;
  endpoint: string;
  creditsUsed: number;
  creditsRemaining: number;
  ttl: number;
}

export interface CurrentWeekResponse {
  week: Week;
  games: Game[];
  picks: Pick[];
  remainingPicks: number;
  oddsUpdatedAt: string | null;
}

export interface SubmitPickRequest {
  gameId: string;
  pickedTeam: string;
  spreadAtPick: number;
}

export interface SubmitPickResponse {
  pick: Pick;
}

export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export const ErrorCodes = {
  GAME_STARTED: 'GAME_STARTED',
  STALE_LINES: 'STALE_LINES',
  DUPLICATE_PICK: 'DUPLICATE_PICK',
  WEEKLY_LIMIT: 'WEEKLY_LIMIT',
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
