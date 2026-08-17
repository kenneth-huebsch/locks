const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface HttpClient {
  get(url: string): Promise<HttpResponse>;
}

export interface EspnFinalScore {
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
}

export interface EspnScoreboardClient {
  fetchFinalScores(date: string): Promise<EspnFinalScore[]>;
}

export interface EspnScoreboardClientConfig {
  httpClient: HttpClient;
}

export class EspnScoreboardResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EspnScoreboardResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCompleted(status: unknown): boolean {
  if (!isRecord(status) || !isRecord(status.type)) {
    return false;
  }
  return status.type.completed === true;
}

function parseScore(value: unknown): number | null {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return null;
  }
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function parseCompetitor(
  value: unknown,
): { homeAway: string; team: string; score: number } | null {
  if (
    !isRecord(value) ||
    typeof value.homeAway !== 'string' ||
    !isRecord(value.team) ||
    typeof value.team.displayName !== 'string'
  ) {
    return null;
  }
  const score = parseScore(value.score);
  if (score === null) {
    return null;
  }
  return {
    homeAway: value.homeAway,
    team: value.team.displayName,
    score,
  };
}

function parseFinalScore(event: unknown): EspnFinalScore | null {
  if (!isRecord(event) || !Array.isArray(event.competitions)) {
    return null;
  }
  const competition = event.competitions.find(isRecord);
  if (
    !competition ||
    (!isCompleted(competition.status) && !isCompleted(event.status)) ||
    !Array.isArray(competition.competitors)
  ) {
    return null;
  }

  const competitors = competition.competitors
    .map(parseCompetitor)
    .filter((value) => value !== null);
  const away = competitors.find((competitor) => competitor.homeAway === 'away');
  const home = competitors.find((competitor) => competitor.homeAway === 'home');
  if (!away || !home) {
    return null;
  }

  return {
    awayTeam: away.team,
    homeTeam: home.team,
    awayScore: away.score,
    homeScore: home.score,
  };
}

export function createEspnScoreboardClient(
  config: EspnScoreboardClientConfig,
): EspnScoreboardClient {
  return {
    async fetchFinalScores(date) {
      const url = new URL(ESPN_SCOREBOARD_URL);
      url.searchParams.set('dates', date);
      const response = await config.httpClient.get(url.toString());
      if (!response.ok) {
        throw new EspnScoreboardResponseError(
          `ESPN scoreboard request failed with status ${response.status}`,
        );
      }

      const payload = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.events)) {
        throw new EspnScoreboardResponseError(
          'ESPN scoreboard response does not contain an events array',
        );
      }

      return payload.events
        .map(parseFinalScore)
        .filter((score) => score !== null);
    },
  };
}
