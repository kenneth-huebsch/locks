import { getTeamByAbbr } from '../../shared/teams';
import { JACK_SUB, KENNY_2_SUB, KENNY_SUB } from './players';
import {
  ErrorCodes,
  type CurrentWeekResponse,
  type ErrorCode,
  type Game,
  type Pick,
  type SubmitPickRequest,
  type SubmitPickResponse,
  type WeekSummary,
} from '../../shared/types';

export class MockPickError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'MockPickError';
    this.code = code;
  }
}

const MOCK_SEASON = 2026;

function seasonWeekKey(week: number): string {
  return `${MOCK_SEASON}#W${String(week).padStart(2, '0')}`;
}

interface MatchupSpec {
  id: string;
  away: string;
  home: string;
  commenceTime: string;
  awaySpread: number;
  status: Game['status'];
  oddsUpdatedAt: string;
}

function buildGame(spec: MatchupSpec): Game {
  const away = getTeamByAbbr(spec.away);
  const home = getTeamByAbbr(spec.home);
  if (!away || !home) {
    throw new Error(`Unknown team in mock matchup: ${spec.away} @ ${spec.home}`);
  }

  return {
    id: spec.id,
    awayTeam: away.fullName,
    homeTeam: home.fullName,
    awayAbbr: away.abbreviation,
    homeAbbr: home.abbreviation,
    commenceTime: spec.commenceTime,
    awaySpread: spec.awaySpread,
    homeSpread: -spec.awaySpread,
    status: spec.status,
    bookmaker: 'draftkings',
    oddsUpdatedAt: spec.oddsUpdatedAt,
  };
}

function buildGames(specs: MatchupSpec[]): Game[] {
  return specs.map(buildGame);
}

const week1OddsUpdatedAt = '2026-09-09T12:00:00.000Z';
const week1Games = buildGames([
  { id: 'w1-g1', away: 'DAL', home: 'PHI', commenceTime: '2026-09-10T17:00:00.000Z', awaySpread: -3.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g2', away: 'NYG', home: 'WAS', commenceTime: '2026-09-11T17:00:00.000Z', awaySpread: 2.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g3', away: 'KC', home: 'LAC', commenceTime: '2026-09-11T20:00:00.000Z', awaySpread: -2, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g4', away: 'TB', home: 'ATL', commenceTime: '2026-09-12T17:00:00.000Z', awaySpread: -1.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g5', away: 'CIN', home: 'CLE', commenceTime: '2026-09-12T20:00:00.000Z', awaySpread: -3, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g6', away: 'MIA', home: 'IND', commenceTime: '2026-09-13T17:00:00.000Z', awaySpread: 1, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g7', away: 'CAR', home: 'JAX', commenceTime: '2026-09-13T17:00:00.000Z', awaySpread: 4.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g8', away: 'LV', home: 'NE', commenceTime: '2026-09-13T17:00:00.000Z', awaySpread: 2, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g9', away: 'ARI', home: 'NO', commenceTime: '2026-09-13T20:00:00.000Z', awaySpread: 3, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g10', away: 'PIT', home: 'NYJ', commenceTime: '2026-09-13T20:00:00.000Z', awaySpread: -2.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g11', away: 'SF', home: 'SEA', commenceTime: '2026-09-14T00:00:00.000Z', awaySpread: -4, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g12', away: 'TEN', home: 'DEN', commenceTime: '2026-09-14T20:00:00.000Z', awaySpread: 3.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g13', away: 'DET', home: 'GB', commenceTime: '2026-09-15T00:00:00.000Z', awaySpread: -1, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g14', away: 'HOU', home: 'LAR', commenceTime: '2026-09-15T00:00:00.000Z', awaySpread: 5.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g15', away: 'BAL', home: 'BUF', commenceTime: '2026-09-15T20:00:00.000Z', awaySpread: 2.5, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
  { id: 'w1-g16', away: 'MIN', home: 'CHI', commenceTime: '2026-09-16T00:00:00.000Z', awaySpread: -2, status: 'final', oddsUpdatedAt: week1OddsUpdatedAt },
]);

const week2OddsUpdatedAt = '2026-09-16T12:00:00.000Z';
const week2Games = buildGames([
  { id: 'w2-g1', away: 'KC', home: 'BUF', commenceTime: '2026-09-17T17:00:00.000Z', awaySpread: -1.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g2', away: 'SF', home: 'SEA', commenceTime: '2026-09-18T17:00:00.000Z', awaySpread: -4, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g3', away: 'PHI', home: 'DAL', commenceTime: '2026-09-18T20:00:00.000Z', awaySpread: -2.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g4', away: 'ATL', home: 'TB', commenceTime: '2026-09-19T17:00:00.000Z', awaySpread: 3, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g5', away: 'CLE', home: 'CIN', commenceTime: '2026-09-19T20:00:00.000Z', awaySpread: 1.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g6', away: 'IND', home: 'MIA', commenceTime: '2026-09-20T17:00:00.000Z', awaySpread: -1, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g7', away: 'JAX', home: 'CAR', commenceTime: '2026-09-20T17:00:00.000Z', awaySpread: -3.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g8', away: 'NE', home: 'LV', commenceTime: '2026-09-20T17:00:00.000Z', awaySpread: -2, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g9', away: 'NO', home: 'ARI', commenceTime: '2026-09-20T20:00:00.000Z', awaySpread: -1.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g10', away: 'NYJ', home: 'PIT', commenceTime: '2026-09-20T20:00:00.000Z', awaySpread: 4, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g11', away: 'WAS', home: 'NYG', commenceTime: '2026-09-21T00:00:00.000Z', awaySpread: -3, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g12', away: 'DEN', home: 'TEN', commenceTime: '2026-09-21T20:00:00.000Z', awaySpread: -2.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g13', away: 'GB', home: 'DET', commenceTime: '2026-09-22T00:00:00.000Z', awaySpread: 1, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g14', away: 'LAR', home: 'HOU', commenceTime: '2026-09-22T00:00:00.000Z', awaySpread: -3, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g15', away: 'CHI', home: 'MIN', commenceTime: '2026-09-22T20:00:00.000Z', awaySpread: 2.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
  { id: 'w2-g16', away: 'LAC', home: 'BAL', commenceTime: '2026-09-23T00:00:00.000Z', awaySpread: 3.5, status: 'final', oddsUpdatedAt: week2OddsUpdatedAt },
]);

const week3OddsUpdatedAt = '2099-09-23T12:00:00.000Z';
const week3Games = buildGames([
  { id: 'w3-g1', away: 'GB', home: 'CHI', commenceTime: '2099-09-24T17:00:00.000Z', awaySpread: -2.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g2', away: 'MIA', home: 'NE', commenceTime: '2099-09-25T17:00:00.000Z', awaySpread: 3, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g3', away: 'DET', home: 'MIN', commenceTime: '2099-09-26T17:00:00.000Z', awaySpread: -1, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g4', away: 'DAL', home: 'PHI', commenceTime: '2099-09-27T17:00:00.000Z', awaySpread: 1.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g5', away: 'KC', home: 'BUF', commenceTime: '2099-09-27T20:00:00.000Z', awaySpread: -2, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g6', away: 'SF', home: 'SEA', commenceTime: '2099-09-28T17:00:00.000Z', awaySpread: -3.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g7', away: 'BAL', home: 'CIN', commenceTime: '2099-09-28T20:00:00.000Z', awaySpread: -1, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g8', away: 'HOU', home: 'IND', commenceTime: '2099-09-29T17:00:00.000Z', awaySpread: 2, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g9', away: 'TB', home: 'NO', commenceTime: '2099-09-29T20:00:00.000Z', awaySpread: -4.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g10', away: 'LAR', home: 'ARI', commenceTime: '2099-09-30T00:00:00.000Z', awaySpread: -2.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g11', away: 'DEN', home: 'LV', commenceTime: '2099-09-30T20:00:00.000Z', awaySpread: -3, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g12', away: 'NYJ', home: 'NYG', commenceTime: '2099-10-01T17:00:00.000Z', awaySpread: 1, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g13', away: 'PIT', home: 'CLE', commenceTime: '2099-10-01T20:00:00.000Z', awaySpread: -1.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g14', away: 'JAX', home: 'TEN', commenceTime: '2099-10-02T17:00:00.000Z', awaySpread: -2, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g15', away: 'LAC', home: 'CAR', commenceTime: '2099-10-02T20:00:00.000Z', awaySpread: -1, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
  { id: 'w3-g16', away: 'WAS', home: 'ATL', commenceTime: '2099-10-03T17:00:00.000Z', awaySpread: 2.5, status: 'scheduled', oddsUpdatedAt: week3OddsUpdatedAt },
]);

const week1: CurrentWeekResponse = {
  week: {
    season: MOCK_SEASON,
    week: 1,
    status: 'complete',
    seasonWeek: seasonWeekKey(1),
  },
  games: week1Games,
  picks: [
    {
      playerId: KENNY_SUB,
      gameId: 'w1-g1',
      seasonWeek: seasonWeekKey(1),
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: -3.5,
      submittedAt: '2026-09-09T18:00:00.000Z',
      result: 'win',
    },
    {
      playerId: JACK_SUB,
      gameId: 'w1-g1',
      seasonWeek: seasonWeekKey(1),
      pickedTeam: 'Philadelphia Eagles',
      spreadAtPick: 3.5,
      submittedAt: '2026-09-09T19:00:00.000Z',
      result: 'loss',
    },
    {
      playerId: KENNY_2_SUB,
      gameId: 'w1-g1',
      seasonWeek: seasonWeekKey(1),
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: -3.5,
      submittedAt: '2026-09-09T20:00:00.000Z',
      result: 'win',
    },
    {
      playerId: KENNY_SUB,
      gameId: 'w1-g2',
      seasonWeek: seasonWeekKey(1),
      pickedTeam: 'Washington Commanders',
      spreadAtPick: -2.5,
      submittedAt: '2026-09-09T18:30:00.000Z',
      result: 'push',
    },
    {
      playerId: JACK_SUB,
      gameId: 'w1-g2',
      seasonWeek: seasonWeekKey(1),
      pickedTeam: 'New York Giants',
      spreadAtPick: 2.5,
      submittedAt: '2026-09-09T19:30:00.000Z',
      result: 'loss',
    },
    {
      playerId: KENNY_2_SUB,
      gameId: 'w1-g2',
      seasonWeek: seasonWeekKey(1),
      pickedTeam: 'Washington Commanders',
      spreadAtPick: -2.5,
      submittedAt: '2026-09-09T20:30:00.000Z',
      result: 'push',
    },
  ],
  remainingPicks: 0,
  oddsUpdatedAt: week1OddsUpdatedAt,
};

const week2: CurrentWeekResponse = {
  week: {
    season: MOCK_SEASON,
    week: 2,
    status: 'complete',
    seasonWeek: seasonWeekKey(2),
  },
  games: week2Games,
  picks: [
    {
      playerId: KENNY_SUB,
      gameId: 'w2-g1',
      seasonWeek: seasonWeekKey(2),
      pickedTeam: 'Buffalo Bills',
      spreadAtPick: 1.5,
      submittedAt: '2026-09-16T18:00:00.000Z',
      result: 'win',
    },
    {
      playerId: JACK_SUB,
      gameId: 'w2-g1',
      seasonWeek: seasonWeekKey(2),
      pickedTeam: 'Kansas City Chiefs',
      spreadAtPick: -1.5,
      submittedAt: '2026-09-16T19:00:00.000Z',
      result: 'loss',
    },
    {
      playerId: KENNY_2_SUB,
      gameId: 'w2-g1',
      seasonWeek: seasonWeekKey(2),
      pickedTeam: 'Buffalo Bills',
      spreadAtPick: 1.5,
      submittedAt: '2026-09-16T20:00:00.000Z',
      result: 'win',
    },
    {
      playerId: KENNY_SUB,
      gameId: 'w2-g2',
      seasonWeek: seasonWeekKey(2),
      pickedTeam: 'San Francisco 49ers',
      spreadAtPick: -4,
      submittedAt: '2026-09-16T18:30:00.000Z',
      result: 'loss',
    },
    {
      playerId: JACK_SUB,
      gameId: 'w2-g2',
      seasonWeek: seasonWeekKey(2),
      pickedTeam: 'Seattle Seahawks',
      spreadAtPick: 4,
      submittedAt: '2026-09-16T19:30:00.000Z',
      result: 'win',
    },
    {
      playerId: KENNY_2_SUB,
      gameId: 'w2-g2',
      seasonWeek: seasonWeekKey(2),
      pickedTeam: 'San Francisco 49ers',
      spreadAtPick: -4,
      submittedAt: '2026-09-16T20:30:00.000Z',
      result: 'loss',
    },
  ],
  remainingPicks: 0,
  oddsUpdatedAt: week2OddsUpdatedAt,
};

const week3: CurrentWeekResponse = {
  week: {
    season: MOCK_SEASON,
    week: 3,
    status: 'open',
    seasonWeek: seasonWeekKey(3),
  },
  games: week3Games,
  picks: [
    {
      playerId: KENNY_SUB,
      gameId: 'w3-g1',
      seasonWeek: seasonWeekKey(3),
      pickedTeam: 'Green Bay Packers',
      spreadAtPick: -2.5,
      submittedAt: '2099-09-23T14:00:00.000Z',
      result: 'pending',
    },
  ],
  remainingPicks: 2,
  oddsUpdatedAt: week3OddsUpdatedAt,
};

const staticMockWeeksByNumber: Record<number, CurrentWeekResponse> = {
  1: week1,
  2: week2,
};

let currentWeekState: CurrentWeekResponse = structuredClone(week3);

export function resetMockWeeks(): void {
  currentWeekState = structuredClone(week3);
}

export function listMockWeeks(): WeekSummary[] {
  return [3, 2, 1].map((week) => ({
    season: MOCK_SEASON,
    week,
    isCurrent: week === 3,
  }));
}

const MAX_WEEKLY_PICKS = 3;

function withUserScopedRemainingPicks(
  payload: CurrentWeekResponse,
  userSub?: string,
): CurrentWeekResponse {
  const clone = structuredClone(payload);
  if (!userSub) {
    const seededCount = clone.picks.filter((pick) => pick.playerId === KENNY_SUB).length;
    clone.remainingPicks = Math.max(0, MAX_WEEKLY_PICKS - seededCount);
    return clone;
  }

  const playerPickCount = clone.picks.filter((pick) => pick.playerId === userSub).length;
  clone.remainingPicks = Math.max(0, MAX_WEEKLY_PICKS - playerPickCount);
  return clone;
}

export function listMockPicksThroughWeek(
  season: number,
  throughWeek: number,
): Pick[] {
  if (season !== MOCK_SEASON || throughWeek < 1) {
    return [];
  }

  const picks: Pick[] = [];

  for (let week = 1; week <= throughWeek; week += 1) {
    if (week === 3) {
      picks.push(...currentWeekState.picks);
      continue;
    }

    const payload = staticMockWeeksByNumber[week];
    if (payload) {
      picks.push(...payload.picks);
    }
  }

  return picks;
}

export function loadMockWeek(
  season: number,
  week: number,
  userSub?: string,
): CurrentWeekResponse {
  if (season !== MOCK_SEASON) {
    throw new Error(`No mock data for season ${season}`);
  }

  if (week === 3) {
    return withUserScopedRemainingPicks(currentWeekState, userSub);
  }

  const payload = staticMockWeeksByNumber[week];
  if (!payload) {
    throw new Error(`No mock data for week ${week}`);
  }

  return withUserScopedRemainingPicks(payload, userSub);
}

function conflictMessage(code: ErrorCode): string {
  switch (code) {
    case ErrorCodes.GAME_STARTED:
      return 'This game has already started';
    case ErrorCodes.STALE_LINES:
      return 'The submitted team or spread no longer matches the cached game';
    case ErrorCodes.DUPLICATE_PICK:
      return 'You have already submitted a pick for this game';
    case ErrorCodes.WEEKLY_LIMIT:
      return 'You have already submitted three picks this week';
    case ErrorCodes.GAME_NOT_FOUND:
      return 'Game not found';
    default:
      return 'Pick submission conflict';
  }
}

export function submitMockPick(
  userSub: string,
  request: SubmitPickRequest,
): SubmitPickResponse {
  if (!userSub) {
    throw new MockPickError(
      ErrorCodes.INTERNAL_ERROR,
      'Player session is required for mock pick submission',
    );
  }

  const game = currentWeekState.games.find((item) => item.id === request.gameId);
  if (!game) {
    throw new MockPickError(
      ErrorCodes.GAME_NOT_FOUND,
      conflictMessage(ErrorCodes.GAME_NOT_FOUND),
    );
  }

  if (game.status !== 'scheduled' || game.commenceTime <= new Date().toISOString()) {
    throw new MockPickError(
      ErrorCodes.GAME_STARTED,
      conflictMessage(ErrorCodes.GAME_STARTED),
    );
  }

  const spreadMatches =
    (game.awayTeam === request.pickedTeam &&
      game.awaySpread === request.spreadAtPick) ||
    (game.homeTeam === request.pickedTeam &&
      game.homeSpread === request.spreadAtPick);

  if (!spreadMatches) {
    throw new MockPickError(
      ErrorCodes.STALE_LINES,
      conflictMessage(ErrorCodes.STALE_LINES),
    );
  }

  const existingPick = currentWeekState.picks.find(
    (pick) => pick.playerId === userSub && pick.gameId === request.gameId,
  );
  if (existingPick) {
    throw new MockPickError(
      ErrorCodes.DUPLICATE_PICK,
      conflictMessage(ErrorCodes.DUPLICATE_PICK),
    );
  }

  const playerPickCount = currentWeekState.picks.filter(
    (pick) => pick.playerId === userSub,
  ).length;
  if (playerPickCount >= 3) {
    throw new MockPickError(
      ErrorCodes.WEEKLY_LIMIT,
      conflictMessage(ErrorCodes.WEEKLY_LIMIT),
    );
  }

  const pick: Pick = {
    playerId: userSub,
    gameId: request.gameId,
    seasonWeek: currentWeekState.week.seasonWeek,
    pickedTeam: request.pickedTeam,
    spreadAtPick: request.spreadAtPick,
    submittedAt: new Date().toISOString(),
    result: 'pending',
  };

  const nextPicks = [...currentWeekState.picks, pick];
  const kennyCount = nextPicks.filter((item) => item.playerId === KENNY_SUB).length;
  currentWeekState = {
    ...currentWeekState,
    picks: nextPicks,
    remainingPicks: Math.max(0, MAX_WEEKLY_PICKS - kennyCount),
  };

  return { pick };
}
