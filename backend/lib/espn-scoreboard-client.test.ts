import {
  EspnScoreboardResponseError,
  createEspnScoreboardClient,
  type HttpClient,
  type HttpResponse,
} from './espn-scoreboard-client.js';

function mockResponse(
  overrides: Partial<HttpResponse> & { jsonPayload?: unknown },
): HttpResponse {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    json: async () => overrides.jsonPayload,
  };
}

describe('espn-scoreboard-client', () => {
  it('fetches one date and parses completed NFL games by homeAway', async () => {
    const httpClient: HttpClient = {
      get: vi.fn().mockResolvedValue(
        mockResponse({
          jsonPayload: {
            events: [
              {
                status: { type: { completed: true } },
                competitions: [
                  {
                    competitors: [
                      {
                        homeAway: 'home',
                        score: '24',
                        team: { displayName: 'Philadelphia Eagles' },
                      },
                      {
                        homeAway: 'away',
                        score: '17',
                        team: { displayName: 'Dallas Cowboys' },
                      },
                    ],
                  },
                ],
              },
              {
                status: { type: { completed: false } },
                competitions: [
                  {
                    competitors: [
                      {
                        homeAway: 'home',
                        score: '10',
                        team: { displayName: 'Chicago Bears' },
                      },
                      {
                        homeAway: 'away',
                        score: '7',
                        team: { displayName: 'Miami Dolphins' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ),
    };
    const client = createEspnScoreboardClient({ httpClient });

    await expect(client.fetchFinalScores('20260810')).resolves.toEqual([
      {
        awayTeam: 'Dallas Cowboys',
        homeTeam: 'Philadelphia Eagles',
        awayScore: 17,
        homeScore: 24,
      },
    ]);
    expect(httpClient.get).toHaveBeenCalledWith(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260810',
    );
  });

  it('skips completed events without both teams and numeric scores', async () => {
    const httpClient: HttpClient = {
      get: vi.fn().mockResolvedValue(
        mockResponse({
          jsonPayload: {
            events: [
              {
                status: { type: { completed: true } },
                competitions: [
                  {
                    competitors: [
                      {
                        homeAway: 'home',
                        score: 'not-final',
                        team: { displayName: 'Philadelphia Eagles' },
                      },
                      {
                        homeAway: 'away',
                        score: '17',
                        team: { displayName: 'Dallas Cowboys' },
                      },
                    ],
                  },
                ],
              },
              {
                status: { type: { completed: true } },
                competitions: [{ competitors: [] }],
              },
            ],
          },
        }),
      ),
    };
    const client = createEspnScoreboardClient({ httpClient });

    await expect(client.fetchFinalScores('20260810')).resolves.toEqual([]);
  });

  it('throws on a non-OK response so Scheduler can retry', async () => {
    const httpClient: HttpClient = {
      get: vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 503,
          jsonPayload: {},
        }),
      ),
    };
    const client = createEspnScoreboardClient({ httpClient });

    await expect(client.fetchFinalScores('20260810')).rejects.toThrow(
      'ESPN scoreboard request failed with status 503',
    );
  });

  it('rejects malformed scoreboard payloads', async () => {
    const httpClient: HttpClient = {
      get: vi.fn().mockResolvedValue(
        mockResponse({ jsonPayload: { events: 'invalid' } }),
      ),
    };
    const client = createEspnScoreboardClient({ httpClient });

    await expect(client.fetchFinalScores('20260810')).rejects.toBeInstanceOf(
      EspnScoreboardResponseError,
    );
  });
});
