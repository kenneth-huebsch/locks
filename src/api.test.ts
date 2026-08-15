import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../shared/types';
import { KENNY_SUB } from './lib/players';
import { resetMockWeeks } from './lib/mockWeeks';

describe('api mock weeks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_USE_MOCK_WEEKS', 'true');
    resetMockWeeks();
  });

  afterEach(() => {
    resetMockWeeks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadApi() {
    return import('./api');
  }

  it('submits a mock pick for the current week and returns updated week data on refresh', async () => {
    const { loadWeek, submitPick } = await loadApi();
    const before = await loadWeek('token', 2026, 3);
    expect(before.remainingPicks).toBe(2);

    const response = await submitPick(
      'token',
      {
        gameId: 'w3-g2',
        pickedTeam: 'Miami Dolphins',
        spreadAtPick: 3,
      },
      '/api',
      KENNY_SUB,
    );

    expect(response.pick).toMatchObject({
      playerId: KENNY_SUB,
      gameId: 'w3-g2',
      pickedTeam: 'Miami Dolphins',
      spreadAtPick: 3,
      result: 'pending',
    });

    const after = await loadWeek('token', 2026, 3);
    expect(after.remainingPicks).toBe(1);
    expect(
      after.picks.some(
        (pick) => pick.playerId === KENNY_SUB && pick.gameId === 'w3-g2',
      ),
    ).toBe(true);
  });

  it('rejects mock picks when the weekly limit is reached', async () => {
    const { submitPick } = await loadApi();
    // Week 3 Kenny starts with 1 pick in mock data; fill to 3 then assert limit.
    await submitPick(
      'token',
      {
        gameId: 'w3-g2',
        pickedTeam: 'Miami Dolphins',
        spreadAtPick: 3,
      },
      '/api',
      KENNY_SUB,
    );
    await submitPick(
      'token',
      {
        gameId: 'w3-g3',
        pickedTeam: 'Detroit Lions',
        spreadAtPick: -1,
      },
      '/api',
      KENNY_SUB,
    );
    await expect(
      submitPick(
        'token',
        {
          gameId: 'w3-g4',
          pickedTeam: 'Dallas Cowboys',
          spreadAtPick: 1.5,
        },
        '/api',
        KENNY_SUB,
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: ErrorCodes.WEEKLY_LIMIT,
    });
  });

  it('rejects mock picks when lines do not match', async () => {
    const { submitPick, ApiError } = await loadApi();
    await expect(
      submitPick(
        'token',
        {
          gameId: 'w3-g2',
          pickedTeam: 'Miami Dolphins',
          spreadAtPick: 99,
        },
        '/api',
        KENNY_SUB,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('derives standings from all mock weeks through the current week', async () => {
    const { loadStandings } = await loadApi();

    const standings = await loadStandings('token');

    expect(standings).toMatchObject({
      season: 2026,
      currentWeek: 3,
    });
    expect(standings.players.length).toBeGreaterThan(0);
  });
});

describe('api live weeks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_USE_MOCK_WEEKS', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads available weeks from the authenticated weeks endpoint', async () => {
    const summaries = [
      { season: 2026, week: 2, isCurrent: true },
      { season: 2026, week: 1, isCurrent: false },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(summaries), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { listWeeks } = await import('./api');

    await expect(listWeeks('token', '/api')).resolves.toEqual(summaries);
    expect(fetchMock).toHaveBeenCalledWith('/api/weeks', {
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
    });
  });

  it('loads a selected week with an encoded season-week token', async () => {
    const payload = {
      week: {
        season: 2026,
        week: 1,
        status: 'complete',
        seasonWeek: '2026#W01',
      },
      games: [],
      picks: [],
      remainingPicks: 0,
      oddsUpdatedAt: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { loadWeek } = await import('./api');

    await expect(loadWeek('token', 2026, 1, '/api')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/week/2026%23W01', {
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
    });
  });

  it('loads standings from the authenticated standings endpoint', async () => {
    const payload = {
      season: 2026,
      currentWeek: 2,
      players: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { loadStandings } = await import('./api');

    await expect(loadStandings('token', '/api')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/standings', {
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
    });
  });
});
