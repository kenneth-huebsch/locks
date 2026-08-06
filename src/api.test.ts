import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, loadWeek, submitPick } from './api';
import { ErrorCodes } from '../shared/types';
import { KENNY_SUB } from './lib/players';
import { resetMockWeeks } from './lib/mockWeeks';

describe('api mock weeks', () => {
  beforeEach(() => {
    resetMockWeeks();
  });

  afterEach(() => {
    resetMockWeeks();
  });

  it('submits a mock pick for the current week and returns updated week data on refresh', async () => {
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
      after.picks.filter(
        (pick) => pick.playerId === KENNY_SUB && pick.gameId === 'w3-g2',
      ),
    ).toHaveLength(1);
  });

  it('rejects duplicate mock picks for the same game', async () => {
    await expect(
      submitPick(
        'token',
        {
          gameId: 'w3-g1',
          pickedTeam: 'Green Bay Packers',
          spreadAtPick: -2.5,
        },
        '/api',
        KENNY_SUB,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.DUPLICATE_PICK,
    });
  });

  it('rejects mock picks when lines do not match', async () => {
    await expect(
      submitPick(
        'token',
        {
          gameId: 'w3-g2',
          pickedTeam: 'Miami Dolphins',
          spreadAtPick: 2.5,
        },
        '/api',
        KENNY_SUB,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('scopes remainingPicks to the authenticated mock user', async () => {
    const forOther = await loadWeek('token', 2026, 3, '/api', 'other-user-sub');
    expect(forOther.remainingPicks).toBe(3);
    expect(
      forOther.picks.filter((pick) => pick.playerId === 'other-user-sub'),
    ).toHaveLength(0);

    await submitPick(
      'token',
      {
        gameId: 'w3-g2',
        pickedTeam: 'Miami Dolphins',
        spreadAtPick: 3,
      },
      '/api',
      'other-user-sub',
    );

    const after = await loadWeek('token', 2026, 3, '/api', 'other-user-sub');
    expect(after.remainingPicks).toBe(2);

    const forKenny = await loadWeek('token', 2026, 3, '/api', KENNY_SUB);
    expect(forKenny.remainingPicks).toBe(2);
  });

  it('provides sixteen games per mock week', async () => {
    const week1 = await loadWeek('token', 2026, 1);
    const week2 = await loadWeek('token', 2026, 2);
    const week3 = await loadWeek('token', 2026, 3);

    expect(week1.games).toHaveLength(16);
    expect(week2.games).toHaveLength(16);
    expect(week3.games).toHaveLength(16);
  });
});
