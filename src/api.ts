import type {
  ApiErrorResponse,
  CurrentWeekResponse,
  ErrorCode,
  SubmitPickRequest,
  SubmitPickResponse,
  WeekSummary,
} from '../shared/types';
import {
  listMockWeeks,
  loadMockWeek,
  MockPickError,
  submitMockPick,
} from './lib/mockWeeks';

// Demo path: mock 3-week season until week-history API routes ship.
// Set VITE_USE_MOCK_WEEKS=false to use the live current-week endpoint only.
const USE_MOCK_WEEKS = import.meta.env.VITE_USE_MOCK_WEEKS !== 'false';

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();

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

    throw new Error('Request failed');
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
  _accessToken: string,
  _apiBaseUrl = '/api',
): Promise<WeekSummary[]> {
  if (USE_MOCK_WEEKS) {
    return listMockWeeks();
  }

  const current = await loadCurrentWeek(_accessToken, _apiBaseUrl);
  return [
    {
      season: current.week.season,
      week: current.week.week,
      isCurrent: true,
    },
  ];
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

  const current = await loadCurrentWeek(accessToken, apiBaseUrl);
  if (current.week.season === season && current.week.week === week) {
    return current;
  }

  throw new Error(`Week ${season} W${week} is not available`);
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
