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

function renderWeekView(
  currentWeek: CurrentWeekResponse = mockWeek,
  onRefresh = vi.fn().mockResolvedValue(undefined),
) {
  return render(
    <WeekView
      accessToken="token"
      currentWeek={currentWeek}
      onRefresh={onRefresh}
      userSub="user-sub"
    />,
  );
}

describe('WeekView', () => {
  beforeEach(() => {
    vi.mocked(submitPick).mockReset();
  });

  it('shows remaining picks and lines updated without banner or season record', () => {
    renderWeekView();

    expect(screen.getByText(/2 picks remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/lines last updated/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/picks are final once submitted/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/season record/i)).not.toBeInTheDocument();
    expect(screen.queryByText('0-0-0')).not.toBeInTheDocument();
  });

  it('selects a team and shows the singular submit button', async () => {
    const user = userEvent.setup();
    renderWeekView();

    expect(
      screen.queryByRole('button', { name: /submit pick/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );

    expect(
      screen.getByRole('button', { name: /submit pick/i }),
    ).toBeInTheDocument();
  });

  it('unselects when tapping the already-selected team again', async () => {
    const user = userEvent.setup();
    renderWeekView();

    const dallasButton = screen.getByRole('button', {
      name: /Dallas Cowboys \(DAL\)/i,
    });

    await user.click(dallasButton);
    expect(
      screen.getByRole('button', { name: /submit pick/i }),
    ).toBeInTheDocument();

    await user.click(dallasButton);
    expect(
      screen.queryByRole('button', { name: /submit pick/i }),
    ).not.toBeInTheDocument();
  });

  it('moves selection to a different team in the same game', async () => {
    const user = userEvent.setup();
    renderWeekView();

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /Philadelphia Eagles \(PHI\)/i }),
    );

    expect(
      screen.getByRole('button', { name: /submit pick/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    ).not.toHaveClass('border-blue-700');
  });

  it('replaces pending selection when picking a different game', async () => {
    const user = userEvent.setup();
    renderWeekView();

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /New York Giants \(NYG\)/i }),
    );

    expect(
      screen.getByRole('button', { name: /submit pick/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit pick/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(submitPick).toHaveBeenCalledOnce();
    });

    expect(submitPick).toHaveBeenCalledWith(
      'token',
      {
        gameId: 'game-2',
        pickedTeam: 'New York Giants',
        spreadAtPick: 2.5,
      },
      '/api',
      'user-sub',
    );
  });

  it('blocks new selections when remainingPicks is 0', async () => {
    const user = userEvent.setup();
    renderWeekView({ ...mockWeek, remainingPicks: 0 });

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );

    expect(
      screen.queryByRole('button', { name: /submit pick/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps pending selection and shows error when submit fails', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    vi.mocked(submitPick).mockRejectedValueOnce(
      new ApiError(ErrorCodes.STALE_LINES, 'Odds have changed'),
    );

    renderWeekView(mockWeek, onRefresh);

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(screen.getByRole('button', { name: /submit pick/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(
      await screen.findByText(/odds have changed — please refresh/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /submit pick/i }),
    ).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('clears pending selection and refreshes after a successful submit', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    vi.mocked(submitPick).mockResolvedValueOnce({
      pick: {
        playerId: 'user-sub',
        gameId: 'game-1',
        seasonWeek: '2026#W01',
        pickedTeam: 'Dallas Cowboys',
        spreadAtPick: -3.5,
        submittedAt: '2099-09-09T12:00:00.000Z',
        result: 'pending',
      },
    });

    renderWeekView(mockWeek, onRefresh);

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    );
    await user.click(screen.getByRole('button', { name: /submit pick/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });

    expect(
      screen.queryByRole('button', { name: /submit pick/i }),
    ).not.toBeInTheDocument();
  });
});
