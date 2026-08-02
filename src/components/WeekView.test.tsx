// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CurrentWeekResponse } from '../../shared/types';
import { ApiError } from '../api';
import { ErrorCodes } from '../../shared/types';
import { WeekView } from './WeekView';

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  },
  submitPick: vi.fn(),
}));

import { submitPick } from '../api';

const mockWeek: CurrentWeekResponse = {
  week: {
    season: 2026,
    week: 1,
    status: 'open',
    seasonWeek: '2026#W01',
  },
  games: [
    {
      id: 'game-1',
      awayTeam: 'Dallas Cowboys',
      homeTeam: 'Philadelphia Eagles',
      awayAbbr: 'DAL',
      homeAbbr: 'PHI',
      commenceTime: '2099-09-10T17:00:00.000Z',
      awaySpread: -3.5,
      homeSpread: 3.5,
      status: 'scheduled',
      bookmaker: 'draftkings',
      oddsUpdatedAt: '2099-09-09T12:00:00.000Z',
    },
    {
      id: 'game-2',
      awayTeam: 'New York Giants',
      homeTeam: 'Washington Commanders',
      awayAbbr: 'NYG',
      homeAbbr: 'WAS',
      commenceTime: '2099-09-11T17:00:00.000Z',
      awaySpread: 2.5,
      homeSpread: -2.5,
      status: 'scheduled',
      bookmaker: 'draftkings',
      oddsUpdatedAt: '2099-09-09T12:00:00.000Z',
    },
  ],
  picks: [],
  remainingPicks: 2,
  oddsUpdatedAt: '2099-09-09T12:00:00.000Z',
};

describe('WeekView', () => {
  beforeEach(() => {
    vi.mocked(submitPick).mockReset();
  });

  it('does not allow selecting more pending picks than remainingPicks', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <WeekView
        accessToken="token"
        currentWeek={mockWeek}
        onRefresh={onRefresh}
        userSub="user-sub"
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /New York Giants \(NYG\)/i }),
    );

    expect(screen.getByRole('button', { name: /submit 2 picks/i })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );

    expect(screen.queryByRole('button', { name: /submit 3 picks/i })).not.toBeInTheDocument();
  });

  it('continues submitting after a failed pick so later selections are still sent', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    vi.mocked(submitPick)
      .mockRejectedValueOnce(
        new ApiError(ErrorCodes.STALE_LINES, 'Odds have changed'),
      )
      .mockResolvedValueOnce({
        pick: {
          playerId: 'user-sub',
          gameId: 'game-2',
          seasonWeek: '2026#W01',
          pickedTeam: 'New York Giants',
          spreadAtPick: 2.5,
          submittedAt: '2099-09-09T12:00:00.000Z',
          result: 'pending',
        },
      });

    render(
      <WeekView
        accessToken="token"
        currentWeek={mockWeek}
        onRefresh={onRefresh}
        userSub="user-sub"
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /New York Giants \(NYG\)/i }),
    );
    await user.click(screen.getByRole('button', { name: /submit 2 picks/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(submitPick).toHaveBeenCalledTimes(2);
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(
      await screen.findByText(/odds have changed — please refresh/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Dallas Cowboys')).toBeInTheDocument();
    expect(screen.queryByText('New York Giants')).not.toBeInTheDocument();
  });

  it('reconciles partial submit success: refreshes, removes locked picks, surfaces error', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    vi.mocked(submitPick)
      .mockResolvedValueOnce({
        pick: {
          playerId: 'user-sub',
          gameId: 'game-1',
          seasonWeek: '2026#W01',
          pickedTeam: 'Dallas Cowboys',
          spreadAtPick: -3.5,
          submittedAt: '2099-09-09T12:00:00.000Z',
          result: 'pending',
        },
      })
      .mockRejectedValueOnce(
        new ApiError(ErrorCodes.WEEKLY_LIMIT, 'Weekly limit reached'),
      );

    render(
      <WeekView
        accessToken="token"
        currentWeek={mockWeek}
        onRefresh={onRefresh}
        userSub="user-sub"
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /New York Giants \(NYG\)/i }),
    );
    await user.click(screen.getByRole('button', { name: /submit 2 picks/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });

    expect(submitPick).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(/you have reached the three-pick weekly limit/i),
    ).toBeInTheDocument();
    expect(screen.getByText('New York Giants')).toBeInTheDocument();
    expect(screen.queryByText('Dallas Cowboys')).not.toBeInTheDocument();
  });
});
