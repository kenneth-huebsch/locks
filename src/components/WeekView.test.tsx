// @vitest-environment jsdom

import { emptySurvivorWeekState } from '../lib/survivorState';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CurrentWeekResponse } from '../../shared/types';
import { ApiError } from '../api';
import { ErrorCodes } from '../../shared/types';
import { JACK_SUB } from '../lib/players';
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
  submitSurvivorPick: vi.fn(),
}));

import { submitPick, submitSurvivorPick } from '../api';

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
      awayScore: null,
      homeScore: null,
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
      awayScore: null,
      homeScore: null,
      status: 'scheduled',
      bookmaker: 'draftkings',
      oddsUpdatedAt: '2099-09-09T12:00:00.000Z',
    },
  ],
  picks: [],
  remainingPicks: 2,
  survivor: emptySurvivorWeekState(),
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
    vi.mocked(submitSurvivorPick).mockReset();
  });

  it('shows remaining locks and lines updated without banner or season record', () => {
    renderWeekView();

    expect(screen.getByText(/2 locks remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/lines last updated/i)).toBeInTheDocument();
    expect(
      screen.getByText(/lines update tue 2:00 am, thu 5:00 pm/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/picks are final once submitted/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/season record/i)).not.toBeInTheDocument();
    expect(screen.queryByText('0-0-0')).not.toBeInTheDocument();
  });

  it('selects a team and shows Lock and Survive actions', async () => {
    const user = userEvent.setup();
    renderWeekView();

    expect(screen.queryByRole('button', { name: /🔒 Lock/i })).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\) -3\.5/i }),
    );

    expect(screen.getByRole('button', { name: /🔒 Lock/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🔥 Survive/i })).toBeInTheDocument();
  });

  it('unselects when tapping the already-selected team again', async () => {
    const user = userEvent.setup();
    renderWeekView();

    const dallasButton = screen.getByRole('button', {
      name: /Dallas Cowboys \(DAL\) -3\.5/i,
    });

    await user.click(dallasButton);
    expect(screen.getByRole('button', { name: /🔒 Lock/i })).toBeInTheDocument();

    await user.click(dallasButton);
    expect(screen.queryByRole('button', { name: /🔒 Lock/i })).not.toBeInTheDocument();
  });

  it('submits a lock through Lock then Confirm', async () => {
    const user = userEvent.setup();
    renderWeekView();

    await user.click(
      screen.getByRole('button', { name: /New York Giants \(NYG\) \+2\.5/i }),
    );
    await user.click(screen.getByRole('button', { name: /🔒 Lock/i }));
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

  it('hides Lock when remainingPicks is 0 but still offers Survive', async () => {
    const user = userEvent.setup();
    renderWeekView({ ...mockWeek, remainingPicks: 0 });

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\) -3\.5/i }),
    );

    expect(screen.queryByRole('button', { name: /🔒 Lock/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🔥 Survive/i })).toBeInTheDocument();
  });

  it('hides Survive when the player cannot pick survivor', async () => {
    const user = userEvent.setup();
    renderWeekView({
      ...mockWeek,
      survivor: emptySurvivorWeekState({ canPick: false, myStatus: 'eliminated' }),
    });

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\) -3\.5/i }),
    );

    expect(screen.getByRole('button', { name: /🔒 Lock/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /🔥 Survive/i })).not.toBeInTheDocument();
  });

  it('keeps pending selection and shows error when lock submit fails', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    vi.mocked(submitPick).mockRejectedValueOnce(
      new ApiError(ErrorCodes.STALE_LINES, 'Odds have changed'),
    );

    renderWeekView(mockWeek, onRefresh);

    await user.click(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\) -3\.5/i }),
    );
    await user.click(screen.getByRole('button', { name: /🔒 Lock/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(
      await screen.findByText(/odds have changed — please refresh/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🔒 Lock/i })).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('clears pending selection and refreshes after a successful lock', async () => {
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
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\) -3\.5/i }),
    );
    await user.click(screen.getByRole('button', { name: /🔒 Lock/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });

    expect(screen.queryByRole('button', { name: /🔒 Lock/i })).not.toBeInTheDocument();
  });

  it('shows peer picks returned by the API for an unstarted game', () => {
    const openWeek: CurrentWeekResponse = {
      ...mockWeek,
      picks: [
        {
          playerId: 'user-sub',
          gameId: 'game-1',
          seasonWeek: '2026#W01',
          pickedTeam: 'Dallas Cowboys',
          spreadAtPick: -3.5,
          submittedAt: '2099-09-09T12:00:00.000Z',
          result: 'pending',
        },
        {
          playerId: JACK_SUB,
          gameId: 'game-1',
          seasonWeek: '2026#W01',
          pickedTeam: 'Philadelphia Eagles',
          spreadAtPick: 3.5,
          submittedAt: '2099-09-09T12:30:00.000Z',
          result: 'pending',
        },
      ],
      remainingPicks: 2,
      survivor: emptySurvivorWeekState(),
    };

    renderWeekView(openWeek);

    const revealed = screen.getByLabelText(/revealed picks/i);
    expect(within(revealed).getByText('Jack')).toBeInTheDocument();
    expect(within(revealed).getByText('PHI +3.5')).toBeInTheDocument();
  });
});
