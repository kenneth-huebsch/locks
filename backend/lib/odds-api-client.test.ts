import {
  OddsApiDisabledError,
  OddsApiQuotaReserveError,
  OddsApiResponseError,
  createOddsApiClient,
  type HttpClient,
  type HttpResponse,
} from './odds-api-client.js';

function mockResponse(
  overrides: Partial<HttpResponse> & {
    jsonPayload?: unknown;
    headerValues?: Record<string, string>;
  },
): HttpResponse {
  const headerMap = new Map(
    Object.entries(overrides.headerValues ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );

  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    json: async () => overrides.jsonPayload,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
  };
}

describe('odds-api-client', () => {
  const apiKey = 'test-api-key';
  const clock = { now: () => new Date('2026-08-01T12:00:00.000Z') };

  it('throws without HTTP when disabled', async () => {
    const httpClient: HttpClient = {
      get: vi.fn(),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: false,
    });

    await expect(client.fetchNflSpreads(null)).rejects.toBeInstanceOf(
      OddsApiDisabledError,
    );
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('enforces the credit reserve before making a request', async () => {
    const httpClient: HttpClient = {
      get: vi.fn(),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: true,
    });

    await expect(client.fetchNflSpreads(49)).rejects.toBeInstanceOf(
      OddsApiQuotaReserveError,
    );
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('captures quota headers from spreads responses', async () => {
    const httpClient: HttpClient = {
      get: vi.fn().mockResolvedValue(
        mockResponse({
          jsonPayload: [
            {
              id: 'event-1',
              sport_key: 'americanfootball_nfl',
              sport_title: 'NFL',
              commence_time: '2026-09-10T00:20:00.000Z',
              home_team: 'Philadelphia Eagles',
              away_team: 'Dallas Cowboys',
              bookmakers: [],
            },
          ],
          headerValues: {
            'x-requests-used': '10',
            'x-requests-remaining': '490',
          },
        }),
      ),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: true,
    });

    const result = await client.fetchNflSpreads(100);

    expect(result.quota).toEqual({
      creditsUsed: 10,
      creditsRemaining: 490,
    });
    expect(httpClient.get).toHaveBeenCalledOnce();
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('regions=us'),
    );
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('markets=spreads'),
    );
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.not.stringMatching(/events\/[^/]+/),
    );
  });

  it('rejects malformed spreads payloads and missing quota headers', async () => {
    const httpClient: HttpClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(
          mockResponse({
            jsonPayload: { invalid: true },
            headerValues: {
              'x-requests-used': '1',
              'x-requests-remaining': '499',
            },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            jsonPayload: [],
            headerValues: {},
          }),
        ),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: true,
    });

    await expect(client.fetchNflSpreads(null)).rejects.toBeInstanceOf(
      OddsApiResponseError,
    );
    await expect(client.fetchNflSpreads(null)).rejects.toBeInstanceOf(
      OddsApiResponseError,
    );
  });

  it('throws without HTTP when scores fetch is disabled', async () => {
    const httpClient: HttpClient = {
      get: vi.fn(),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: false,
    });

    await expect(client.fetchNflScores(null)).rejects.toBeInstanceOf(
      OddsApiDisabledError,
    );
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('enforces the credit reserve before fetching scores', async () => {
    const httpClient: HttpClient = {
      get: vi.fn(),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: true,
    });

    await expect(client.fetchNflScores(49)).rejects.toBeInstanceOf(
      OddsApiQuotaReserveError,
    );
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('captures quota headers from scores responses and requests daysFrom', async () => {
    const httpClient: HttpClient = {
      get: vi.fn().mockResolvedValue(
        mockResponse({
          jsonPayload: [
            {
              id: 'event-1',
              sport_key: 'americanfootball_nfl',
              sport_title: 'NFL',
              commence_time: '2026-09-10T00:20:00.000Z',
              completed: true,
              home_team: 'Philadelphia Eagles',
              away_team: 'Dallas Cowboys',
              scores: [
                { name: 'Dallas Cowboys', score: '17' },
                { name: 'Philadelphia Eagles', score: '24' },
              ],
              last_update: '2026-09-10T03:30:00.000Z',
            },
          ],
          headerValues: {
            'x-requests-used': '12',
            'x-requests-remaining': '488',
          },
        }),
      ),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: true,
    });

    const result = await client.fetchNflScores(100);

    expect(result.quota).toEqual({
      creditsUsed: 12,
      creditsRemaining: 488,
    });
    expect(result.data).toHaveLength(1);
    expect(httpClient.get).toHaveBeenCalledOnce();
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('/scores'),
    );
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('daysFrom=3'),
    );
  });

  it('rejects malformed scores payloads and missing quota headers', async () => {
    const httpClient: HttpClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(
          mockResponse({
            jsonPayload: { invalid: true },
            headerValues: {
              'x-requests-used': '2',
              'x-requests-remaining': '498',
            },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            jsonPayload: [],
            headerValues: {},
          }),
        ),
    };
    const client = createOddsApiClient({
      apiKey,
      httpClient,
      clock,
      enabled: true,
    });

    await expect(client.fetchNflScores(null)).rejects.toBeInstanceOf(
      OddsApiResponseError,
    );
    await expect(client.fetchNflScores(null)).rejects.toBeInstanceOf(
      OddsApiResponseError,
    );
  });
});
