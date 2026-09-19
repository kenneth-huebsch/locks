export interface Game {
  id: string;
  awayTeam: string;
  homeTeam: string;
  awayAbbr: string;
  homeAbbr: string;
  commenceTime: string;
  awaySpread: number;
  homeSpread: number;
  awayScore: number | null;
  homeScore: number | null;
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

export interface WeekSummary {
  season: number;
  week: number;
  isCurrent: boolean;
}

export interface WinLossTie {
  wins: number;
  losses: number;
  pushes: number;
}

export type SurvivorPlayerStatus = 'alive' | 'eliminated' | 'winner';
export type SurvivorChallengeStatus = 'active' | 'complete';
export type SurvivorPickResult = 'pending' | 'win' | 'loss';

export interface PlayerWeekStandings {
  season: number;
  week: number;
  seasonWeek: string;
  isCurrent: boolean;
  record: WinLossTie;
}

export interface PlayerStandings {
  playerId: string;
  season: WinLossTie;
  weeks: PlayerWeekStandings[];
  /** Survivor challenge status for this season; null if not configured. */
  survivorStatus: SurvivorPlayerStatus | null;
}

export interface StandingsResponse {
  season: number;
  currentWeek: number;
  players: PlayerStandings[];
}

export interface IncompletePicksPlayer {
  displayName: string;
  sub: string;
  pickCount: number;
  remainingPicks: number;
}

export interface IncompletePicksResponse {
  seasonWeek: string;
  maxPicks: number;
  incomplete: IncompletePicksPlayer[];
}

export interface SurvivorPick {
  playerId: string;
  gameId: string;
  seasonWeek: string;
  pickedTeam: string;
  submittedAt: string;
  result: SurvivorPickResult;
}

export interface SurvivorPlayerState {
  playerId: string;
  status: SurvivorPlayerStatus;
  usedTeams: string[];
  eliminatedWeek?: string;
}

export interface SurvivorWeekState {
  challengeStatus: SurvivorChallengeStatus;
  winners: string[];
  myStatus: SurvivorPlayerStatus | null;
  usedTeams: string[];
  canPick: boolean;
  picks: SurvivorPick[];
}

export interface CurrentWeekResponse {
  week: Week;
  games: Game[];
  picks: Pick[];
  remainingPicks: number;
  oddsUpdatedAt: string | null;
  survivor: SurvivorWeekState;
}

export interface SubmitPickRequest {
  gameId: string;
  pickedTeam: string;
  spreadAtPick: number;
}

export interface SubmitPickResponse {
  pick: Pick;
}

export interface SubmitSurvivorPickRequest {
  gameId: string;
  pickedTeam: string;
}

export interface SubmitSurvivorPickResponse {
  pick: SurvivorPick;
}

export interface PushVapidResponse {
  publicKey: string;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRequest {
  endpoint: string;
  expirationTime?: number | null;
  keys: PushSubscriptionKeys;
}

export interface NotifyPickEvent {
  pickerSub: string;
  gameId: string;
  pickedTeam: string;
  spreadAtPick: number;
  season: number;
  week: number;
}

export interface NotifySurvivorPickEvent {
  pickerSub: string;
  gameId: string;
  pickedTeam: string;
  season: number;
  week: number;
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
  INVALID_WEEK: 'INVALID_WEEK',
  WEEK_NOT_FOUND: 'WEEK_NOT_FOUND',
  SURVIVOR_ELIMINATED: 'SURVIVOR_ELIMINATED',
  TEAM_ALREADY_USED: 'TEAM_ALREADY_USED',
  SURVIVOR_ALREADY_PICKED: 'SURVIVOR_ALREADY_PICKED',
  TEAM_ON_BYE: 'TEAM_ON_BYE',
  CHALLENGE_COMPLETE: 'CHALLENGE_COMPLETE',
  SURVIVOR_NOT_CONFIGURED: 'SURVIVOR_NOT_CONFIGURED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
