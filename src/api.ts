import type {
  ApiErrorResponse,
  CurrentWeekResponse,
} from '../shared/foundation';

export async function loadCurrentWeek(
  accessToken: string,
  apiBaseUrl = '/api',
): Promise<CurrentWeekResponse> {
  const response = await fetch(`${apiBaseUrl}/week/current`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const body = (await response.json()) as CurrentWeekResponse | ApiErrorResponse;
  if (!response.ok) {
    const message =
      'error' in body ? body.error.message : 'Unable to load the current week';
    throw new Error(message);
  }

  return body as CurrentWeekResponse;
}
