// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, type AppAuth } from './App';
import type { CurrentWeekResponse, WeekSummary } from '../shared/types';

const weekSummaries: WeekSummary[] = [
  { season: 2026, week: 3, isCurrent: true },
  { season: 2026, week: 2, isCurrent: false },
  { season: 2026, week: 1, isCurrent: false },
];

const currentWeek: CurrentWeekResponse = {
  week: {
    season: 2026,
    week: 3,
    status: 'open',
    seasonWeek: '2026#W03',
  },
  games: [
    {
      id: 'w3-g1',
      awayTeam: 'Green Bay Packers',
      homeTeam: 'Chicago Bears',
      awayAbbr: 'GB',
      homeAbbr: 'CHI',
      commenceTime: '2099-09-24T17:00:00.000Z',
      awaySpread: -2.5,
      homeSpread: 2.5,
      status: 'scheduled',
      bookmaker: 'draftkings',
      oddsUpdatedAt: '2099-09-23T12:00:00.000Z',
    },
  ],
  picks: [],
  remainingPicks: 2,
  oddsUpdatedAt: '2099-09-23T12:00:00.000Z',
};

const pastWeek: CurrentWeekResponse = {
  week: {
    season: 2026,
    week: 1,
    status: 'complete',
    seasonWeek: '2026#W01',
  },
  games: [
    {
      id: 'w1-g1',
      awayTeam: 'Dallas Cowboys',
      homeTeam: 'Philadelphia Eagles',
      awayAbbr: 'DAL',
      homeAbbr: 'PHI',
      commenceTime: '2026-09-10T17:00:00.000Z',
      awaySpread: -3.5,
      homeSpread: 3.5,
      status: 'final',
      bookmaker: 'draftkings',
      oddsUpdatedAt: '2026-09-09T12:00:00.000Z',
    },
  ],
  picks: [
    {
      playerId: 'kenny-sub',
      gameId: 'w1-g1',
      seasonWeek: '2026#W01',
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: -3.5,
      submittedAt: '2026-09-09T18:00:00.000Z',
      result: 'win',
    },
    {
      playerId: 'jack-sub',
      gameId: 'w1-g1',
      seasonWeek: '2026#W01',
      pickedTeam: 'Philadelphia Eagles',
      spreadAtPick: 3.5,
      submittedAt: '2026-09-09T19:00:00.000Z',
      result: 'loss',
    },
  ],
  remainingPicks: 0,
  oddsUpdatedAt: '2026-09-09T12:00:00.000Z',
};

const unauthenticatedAuth: AppAuth = {
  isAuthenticated: false,
  isLoading: false,
  signinRedirect: vi.fn(),
  logout: vi.fn(),
};

function renderApp(
  loadWeek = vi.fn().mockResolvedValue(currentWeek),
  listWeeksFn = vi.fn().mockResolvedValue(weekSummaries),
) {
  return render(
    <App
      auth={{
        ...unauthenticatedAuth,
        isAuthenticated: true,
        accessToken: 'access-token',
        userSub: 'kenny-sub',
      }}
      listWeeks={listWeeksFn}
      loadWeek={loadWeek}
    />,
  );
}

describe('App', () => {
  it('redirects to Cognito login when unauthenticated', () => {
    render(
      <App
        auth={unauthenticatedAuth}
        listWeeks={vi.fn()}
        loadWeek={vi.fn()}
      />,
    );

    expect(unauthenticatedAuth.signinRedirect).toHaveBeenCalledOnce();
    expect(screen.getByText(/redirecting to sign in/i)).toBeInTheDocument();
  });

  it('shows the Weeks dropdown and current-week pick entry by default', async () => {
    renderApp();

    expect(await screen.findByLabelText(/^weeks$/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /week 3 \(current\)/i })).toBeInTheDocument();
    expect(await screen.findByText('Green Bay Packers (GB)')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /^week 3$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/picks are final once submitted/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /picks board/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the picks board when a past week is selected', async () => {
    const user = userEvent.setup();
    const loadWeek = vi.fn().mockImplementation(
      (_token: string, _season: number, week: number) =>
        Promise.resolve(week === 1 ? pastWeek : currentWeek),
    );

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^weeks$/i), '2026-1');

    expect(await screen.findByRole('heading', { name: /picks board/i })).toBeInTheDocument();
    expect(screen.getByText('DAL @ PHI')).toBeInTheDocument();
    expect(
      screen.queryByText(/picks are final once submitted/i),
    ).not.toBeInTheDocument();
  });

  it('shows loading instead of stale week data while a new week loads', async () => {
    const user = userEvent.setup();
    let resolvePastWeek: (value: CurrentWeekResponse) => void = () => {};
    const pastWeekPromise = new Promise<CurrentWeekResponse>((resolve) => {
      resolvePastWeek = resolve;
    });
    const loadWeek = vi.fn().mockImplementation(
      (_token: string, _season: number, week: number) =>
        week === 1 ? pastWeekPromise : Promise.resolve(currentWeek),
    );

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^weeks$/i), '2026-1');

    expect(screen.getByText(/loading this week/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /picks board/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Green Bay Packers (GB)')).not.toBeInTheDocument();

    resolvePastWeek(pastWeek);

    expect(await screen.findByRole('heading', { name: /picks board/i })).toBeInTheDocument();
    expect(screen.getByText('DAL @ PHI')).toBeInTheDocument();
  });

  it('clears stale week data when loading the selected week fails', async () => {
    const user = userEvent.setup();
    const loadWeek = vi
      .fn()
      .mockResolvedValueOnce(currentWeek)
      .mockRejectedValueOnce(new Error('Week unavailable'));

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^weeks$/i), '2026-1');

    expect(await screen.findByText(/week unavailable/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /picks board/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Green Bay Packers (GB)')).not.toBeInTheDocument();
  });

  it('clears the local session and starts Cognito logout', async () => {
    const user = userEvent.setup();
    const logout = vi.fn();

    render(
      <App
        auth={{
          ...unauthenticatedAuth,
          isAuthenticated: true,
          accessToken: 'access-token',
          userSub: 'kenny-sub',
          logout,
        }}
        listWeeks={vi.fn().mockResolvedValue(weekSummaries)}
        loadWeek={vi.fn().mockResolvedValue({
          ...currentWeek,
          games: [],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(logout).toHaveBeenCalledOnce();
  });
});
