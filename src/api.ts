import type {
  ApiErrorResponse,
  CurrentWeekResponse,
  ErrorCode,
  SubmitPickRequest,
  SubmitPickResponse,
} from '../shared/types';

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

export async function submitPick(
  accessToken: string,
  request: SubmitPickRequest,
  apiBaseUrl = '/api',
): Promise<SubmitPickResponse> {
  const response = await fetch(`${apiBaseUrl}/picks`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(request),
  });

  return parseResponse<SubmitPickResponse>(response);
}
