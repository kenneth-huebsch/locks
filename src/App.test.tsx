// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, type AppAuth } from './App';
import type {
  CurrentWeekResponse,
  StandingsResponse,
  WeekSummary,
} from '../shared/types';
import { ERIC_SUB, JACK_SUB, KENNY_SUB } from './lib/players';

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
      awayScore: null,
      homeScore: null,
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
      awayScore: 20,
      homeScore: 24,
      status: 'final',
      bookmaker: 'draftkings',
      oddsUpdatedAt: '2026-09-09T12:00:00.000Z',
    },
  ],
  picks: [
    {
      playerId: KENNY_SUB,
      gameId: 'w1-g1',
      seasonWeek: '2026#W01',
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: -3.5,
      submittedAt: '2026-09-09T18:00:00.000Z',
      result: 'win',
    },
    {
      playerId: JACK_SUB,
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

const standings: StandingsResponse = {
  season: 2026,
  currentWeek: 3,
  players: [
    {
      playerId: KENNY_SUB,
      season: { wins: 1, losses: 3, pushes: 0 },
      weeks: [
        {
          season: 2026,
          week: 1,
          seasonWeek: '2026#W01',
          isCurrent: false,
          record: { wins: 1, losses: 0, pushes: 0 },
        },
        {
          season: 2026,
          week: 2,
          seasonWeek: '2026#W02',
          isCurrent: false,
          record: { wins: 0, losses: 3, pushes: 0 },
        },
        {
          season: 2026,
          week: 3,
          seasonWeek: '2026#W03',
          isCurrent: true,
          record: { wins: 0, losses: 0, pushes: 0 },
        },
      ],
    },
    {
      playerId: JACK_SUB,
      season: { wins: 0, losses: 4, pushes: 0 },
      weeks: [
        {
          season: 2026,
          week: 1,
          seasonWeek: '2026#W01',
          isCurrent: false,
          record: { wins: 0, losses: 1, pushes: 0 },
        },
        {
          season: 2026,
          week: 2,
          seasonWeek: '2026#W02',
          isCurrent: false,
          record: { wins: 0, losses: 3, pushes: 0 },
        },
        {
          season: 2026,
          week: 3,
          seasonWeek: '2026#W03',
          isCurrent: true,
          record: { wins: 0, losses: 0, pushes: 0 },
        },
      ],
    },
    {
      playerId: ERIC_SUB,
      season: { wins: 0, losses: 6, pushes: 0 },
      weeks: [
        {
          season: 2026,
          week: 1,
          seasonWeek: '2026#W01',
          isCurrent: false,
          record: { wins: 0, losses: 3, pushes: 0 },
        },
        {
          season: 2026,
          week: 2,
          seasonWeek: '2026#W02',
          isCurrent: false,
          record: { wins: 0, losses: 3, pushes: 0 },
        },
        {
          season: 2026,
          week: 3,
          seasonWeek: '2026#W03',
          isCurrent: true,
          record: { wins: 0, losses: 0, pushes: 0 },
        },
      ],
    },
  ],
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
  loadStandings = vi.fn().mockResolvedValue(standings),
) {
  return render(
    <App
      auth={{
        ...unauthenticatedAuth,
        isAuthenticated: true,
        accessToken: 'access-token',
        userSub: KENNY_SUB,
      }}
      listWeeks={listWeeksFn}
      loadStandings={loadStandings}
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
        loadStandings={vi.fn()}
        loadWeek={vi.fn()}
      />,
    );

    expect(unauthenticatedAuth.signinRedirect).toHaveBeenCalledOnce();
    expect(screen.getByText(/redirecting to sign in/i)).toBeInTheDocument();
  });

  it('shows Weeks/Standings nav and current-week pick entry by default', async () => {
    renderApp();

    expect(await screen.findByRole('button', { name: /^weeks$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^standings$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^select week$/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /week 3 \(current\)/i })).toBeInTheDocument();
    expect(await screen.findByText('Green Bay Packers (GB)')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /^week 3$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 picks remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/lines last updated/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /picks board/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the past-week board title when a past week is selected', async () => {
    const user = userEvent.setup();
    const loadWeek = vi.fn().mockImplementation(
      (_token: string, _season: number, week: number) =>
        Promise.resolve(week === 1 ? pastWeek : currentWeek),
    );

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^select week$/i), '2026-1');

    expect(await screen.findByRole('heading', { level: 2, name: /^week 1$/i })).toBeInTheDocument();
    expect(screen.getByText('DAL 20 @ PHI 24')).toBeInTheDocument();
    expect(screen.getAllByText('Kenny').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Jack').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('No pick')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /picks board/i }),
    ).not.toBeInTheDocument();
  });

  it('shows weekly player records on a past week board', async () => {
    const user = userEvent.setup();
    const loadWeek = vi.fn().mockImplementation(
      (_token: string, _season: number, week: number) =>
        Promise.resolve(week === 1 ? pastWeek : currentWeek),
    );

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^select week$/i), '2026-1');

    expect(await screen.findByLabelText(/weekly records/i)).toBeInTheDocument();
    expect(screen.getByText('1-0-0')).toBeInTheDocument();
    expect(screen.getByText('0-1-0')).toBeInTheDocument();
    expect(screen.getByText('0-3-0')).toBeInTheDocument();
    expect(screen.queryByText('No pick')).not.toBeInTheDocument();
  });

  it('navigates to the current week when Locks is clicked from a past week', async () => {
    const user = userEvent.setup();
    const loadWeek = vi.fn().mockImplementation(
      (_token: string, _season: number, week: number) =>
        Promise.resolve(week === 1 ? pastWeek : currentWeek),
    );

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^select week$/i), '2026-1');
    await screen.findByRole('heading', { level: 2, name: /^week 1$/i });

    await user.click(screen.getByRole('button', { name: /^locks$/i }));

    expect(await screen.findByRole('heading', { level: 2, name: /^week 3$/i })).toBeInTheDocument();
    expect(screen.getByText(/2 picks remaining/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^select week$/i })).toHaveValue('2026-3');
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
    await user.selectOptions(screen.getByLabelText(/^select week$/i), '2026-1');

    expect(screen.getByText(/loading this week/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: /^week 1$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Green Bay Packers (GB)')).not.toBeInTheDocument();

    resolvePastWeek(pastWeek);

    expect(await screen.findByRole('heading', { level: 2, name: /^week 1$/i })).toBeInTheDocument();
    expect(screen.getByText('DAL 20 @ PHI 24')).toBeInTheDocument();
  });

  it('opens standings from the header and returns via Weeks', async () => {
    const user = userEvent.setup();

    renderApp();
    await screen.findByText('Green Bay Packers (GB)');
    await user.click(screen.getByRole('button', { name: /^standings$/i }));

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /^standings$/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^select week$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/kenny overall record/i)).toHaveTextContent(
      '1-3-0',
    );
    expect(screen.getByLabelText(/eric overall record/i)).toHaveTextContent(
      '0-6-0',
    );

    await user.click(screen.getByRole('button', { name: /^weeks$/i }));

    expect(await screen.findByLabelText(/^select week$/i)).toBeInTheDocument();
    expect(await screen.findByText('Green Bay Packers (GB)')).toBeInTheDocument();
  });

  it('clears stale week data when loading the selected week fails', async () => {
    const user = userEvent.setup();
    const loadWeek = vi
      .fn()
      .mockResolvedValueOnce(currentWeek)
      .mockRejectedValueOnce(new Error('Week unavailable'));

    renderApp(loadWeek);

    await screen.findByText('Green Bay Packers (GB)');
    await user.selectOptions(screen.getByLabelText(/^select week$/i), '2026-1');

    expect(await screen.findByText(/week unavailable/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: /^week 1$/i }),
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
          userSub: KENNY_SUB,
          logout,
        }}
        listWeeks={vi.fn().mockResolvedValue(weekSummaries)}
        loadStandings={vi.fn().mockResolvedValue(standings)}
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
