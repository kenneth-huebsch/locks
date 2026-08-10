import type {
  OddsApiEventsResponse,
  OddsApiEventsResult,
  OddsApiQuotaHeaders,
  OddsApiSpreadsResponse,
  OddsApiSpreadsResult,
} from './odds-api-types.js';

export const ODDS_API_CREDIT_RESERVE = 50;
/** Default NFL sport key; override with ODDS_API_SPORT (e.g. preseason). */
export const DEFAULT_ODDS_API_SPORT = 'americanfootball_nfl';
export function oddsApiSportKey(): string {
  const fromEnv = process.env.ODDS_API_SPORT?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ODDS_API_SPORT;
}
export function oddsApiSpreadsPath(sport = oddsApiSportKey()): string {
  return `/v4/sports/${sport}/odds`;
}
export function oddsApiEventsPath(sport = oddsApiSportKey()): string {
  return `/v4/sports/${sport}/events`;
}
/** @deprecated use oddsApiSpreadsPath() — kept for tests that import the constant shape */
export const ODDS_API_SPREADS_PATH = oddsApiSpreadsPath(DEFAULT_ODDS_API_SPORT);
export const ODDS_API_EVENTS_PATH = oddsApiEventsPath(DEFAULT_ODDS_API_SPORT);
const ODDS_API_BASE_URL = 'https://api.the-odds-api.com';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
}

export interface HttpClient {
  get(url: string): Promise<HttpResponse>;
}

export interface Clock {
  now(): Date;
}

export interface OddsApiClient {
  fetchNflSpreads(creditsRemaining: number | null): Promise<OddsApiSpreadsResult>;
  fetchNflEvents(): Promise<OddsApiEventsResult>;
}

export interface OddsApiClientConfig {
  apiKey: string;
  httpClient: HttpClient;
  clock: Clock;
  enabled: boolean;
}

export class OddsApiDisabledError extends Error {
  constructor() {
    super('Odds API synchronization is disabled (ODDS_API_ENABLED=false)');
    this.name = 'OddsApiDisabledError';
  }
}

export class OddsApiQuotaReserveError extends Error {
  constructor(remaining: number) {
    super(
      `Odds API credit reserve not met: ${remaining} remaining, ` +
        `${ODDS_API_CREDIT_RESERVE} required before calling`,
    );
    this.name = 'OddsApiQuotaReserveError';
  }
}

export class OddsApiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OddsApiResponseError';
  }
}

function assertEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new OddsApiDisabledError();
  }
}

function assertQuotaReserve(creditsRemaining: number | null): void {
  if (creditsRemaining !== null && creditsRemaining < ODDS_API_CREDIT_RESERVE) {
    throw new OddsApiQuotaReserveError(creditsRemaining);
  }
}

function parseQuotaHeaders(response: HttpResponse): OddsApiQuotaHeaders {
  const usedRaw = response.headers.get('x-requests-used');
  const remainingRaw = response.headers.get('x-requests-remaining');

  if (usedRaw === null || remainingRaw === null) {
    throw new OddsApiResponseError(
      'Odds API response missing quota headers',
    );
  }

  const creditsUsed = Number(usedRaw);
  const creditsRemaining = Number(remainingRaw);

  if (!Number.isFinite(creditsUsed) || !Number.isFinite(creditsRemaining)) {
    throw new OddsApiResponseError(
      'Odds API quota headers are not numeric',
    );
  }

  return { creditsUsed, creditsRemaining };
}

function parseSpreadsPayload(payload: unknown): OddsApiSpreadsResponse {
  if (!Array.isArray(payload)) {
    throw new OddsApiResponseError('Odds API spreads response is not an array');
  }

  return payload as OddsApiSpreadsResponse;
}

function parseEventsPayload(payload: unknown): OddsApiEventsResponse {
  if (!Array.isArray(payload)) {
    throw new OddsApiResponseError('Odds API events response is not an array');
  }

  return payload as OddsApiEventsResponse;
}

function buildUrl(path: string, apiKey: string, query?: URLSearchParams): string {
  const url = new URL(path, ODDS_API_BASE_URL);
  url.searchParams.set('apiKey', apiKey);
  if (query) {
    for (const [key, value] of query.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function createOddsApiClient(
  config: OddsApiClientConfig,
): OddsApiClient {
  const { apiKey, httpClient, enabled } = config;

  return {
    async fetchNflSpreads(creditsRemaining) {
      assertEnabled(enabled);
      assertQuotaReserve(creditsRemaining);

      const query = new URLSearchParams({
        regions: 'us',
        markets: 'spreads',
        oddsFormat: 'american',
      });
      const response = await httpClient.get(
        buildUrl(oddsApiSpreadsPath(), apiKey, query),
      );

      if (!response.ok) {
        throw new OddsApiResponseError(
          `Odds API spreads request failed with status ${response.status}`,
        );
      }

      const payload = await response.json();
      const quota = parseQuotaHeaders(response);

      return {
        data: parseSpreadsPayload(payload),
        quota,
      };
    },

    async fetchNflEvents() {
      assertEnabled(enabled);

      const response = await httpClient.get(
        buildUrl(oddsApiEventsPath(), apiKey),
      );

      if (!response.ok) {
        throw new OddsApiResponseError(
          `Odds API events request failed with status ${response.status}`,
        );
      }

      const payload = await response.json();
      const quota = parseQuotaHeaders(response);

      return {
        data: parseEventsPayload(payload),
        quota,
      };
    },
  };
}
