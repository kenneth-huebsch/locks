import type {
  ApiErrorResponse,
  CurrentWeekResponse,
  ErrorCode,
  StandingsResponse,
  SubmitPickRequest,
  SubmitPickResponse,
  WeekSummary,
} from '../shared/types';
import {
  listMockPicksThroughWeek,
  listMockWeeks,
  loadMockWeek,
  MockPickError,
  submitMockPick,
} from './lib/mockWeeks';
import { seasonWeekToken } from '../shared/dynamo';
import { computeStandingsFromPicks } from '../shared/records';
import { LEAGUE_ROSTER } from '../shared/roster';

// Live current-week API by default for preseason/production testing.
// Set VITE_USE_MOCK_WEEKS=true to force the local mock 3-week demo path.
const USE_MOCK_WEEKS = import.meta.env.VITE_USE_MOCK_WEEKS === 'true';

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as ApiErrorResponse).error?.code === 'string'
    ) {
      const apiError = body as ApiErrorResponse;
      throw new ApiError(apiError.error.code, apiError.error.message);
    }

    throw new Error(
      `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`,
    );
  }

  return body as T;
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

export async function loadCurrentWeek(
  accessToken: string,
  apiBaseUrl = '/api',
): Promise<CurrentWeekResponse> {
  const response = await fetch(`${apiBaseUrl}/week/current`, {
    headers: authHeaders(accessToken),
  });

  return parseResponse<CurrentWeekResponse>(response);
}

export async function listWeeks(
  accessToken: string,
  apiBaseUrl = '/api',
): Promise<WeekSummary[]> {
  if (USE_MOCK_WEEKS) {
    return listMockWeeks();
  }

  const response = await fetch(`${apiBaseUrl}/weeks`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<WeekSummary[]>(response);
}

export async function loadStandings(
  accessToken: string,
  apiBaseUrl = '/api',
): Promise<StandingsResponse> {
  if (USE_MOCK_WEEKS) {
    const weeks = listMockWeeks();
    const current = weeks.find((week) => week.isCurrent) ?? weeks[0];
    if (!current) {
      return { season: 0, currentWeek: 0, players: [] };
    }

    return computeStandingsFromPicks(
      listMockPicksThroughWeek(current.season, current.week),
      current.season,
      current.week,
      LEAGUE_ROSTER.map((player) => player.sub),
    );
  }

  const response = await fetch(`${apiBaseUrl}/standings`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<StandingsResponse>(response);
}

export async function loadWeek(
  accessToken: string,
  season: number,
  week: number,
  apiBaseUrl = '/api',
  userSub?: string,
): Promise<CurrentWeekResponse> {
  if (USE_MOCK_WEEKS) {
    return loadMockWeek(season, week, userSub);
  }

  const token = encodeURIComponent(seasonWeekToken(season, week));
  const response = await fetch(`${apiBaseUrl}/week/${token}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<CurrentWeekResponse>(response);
}

export async function submitPick(
  accessToken: string,
  request: SubmitPickRequest,
  apiBaseUrl = '/api',
  userSub?: string,
): Promise<SubmitPickResponse> {
  if (USE_MOCK_WEEKS) {
    try {
      return submitMockPick(userSub ?? '', request);
    } catch (error) {
      if (error instanceof MockPickError) {
        throw new ApiError(error.code, error.message);
      }

      throw error;
    }
  }

  const response = await fetch(`${apiBaseUrl}/picks`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(request),
  });

  return parseResponse<SubmitPickResponse>(response);
}
