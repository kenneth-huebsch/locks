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
});
