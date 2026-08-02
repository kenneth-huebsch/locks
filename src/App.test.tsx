// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, type AppAuth } from './App';
import type { CurrentWeekResponse } from '../shared/types';

const mockWeek: CurrentWeekResponse = {
  week: {
    season: 2026,
    week: 1,
    status: 'open',
    seasonWeek: '2026#W01',
  },
  games: [
    {
      id: 'foundation-week-1-game',
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
  ],
  picks: [],
  remainingPicks: 3,
  oddsUpdatedAt: '2099-09-09T12:00:00.000Z',
};

const unauthenticatedAuth: AppAuth = {
  isAuthenticated: false,
  isLoading: false,
  signinRedirect: vi.fn(),
  logout: vi.fn(),
};

describe('App', () => {
  it('redirects to Cognito login when unauthenticated', () => {
    render(<App auth={unauthenticatedAuth} loadCurrentWeek={vi.fn()} />);

    expect(unauthenticatedAuth.signinRedirect).toHaveBeenCalledOnce();
    expect(screen.getByText(/redirecting to sign in/i)).toBeInTheDocument();
  });

  it('loads and displays the current-week game when authenticated', async () => {
    render(
      <App
        auth={{
          ...unauthenticatedAuth,
          isAuthenticated: true,
          accessToken: 'access-token',
          userSub: 'kenny-sub',
        }}
        loadCurrentWeek={vi.fn().mockResolvedValue(mockWeek)}
      />,
    );

    expect(await screen.findByText('Dallas Cowboys (DAL)')).toBeInTheDocument();
    expect(screen.getByText(/week 1/i)).toBeInTheDocument();
    expect(
      screen.getByText(/picks are final once submitted/i),
    ).toBeInTheDocument();
  });

  it('switches to the picks board tab', async () => {
    const user = userEvent.setup();

    render(
      <App
        auth={{
          ...unauthenticatedAuth,
          isAuthenticated: true,
          accessToken: 'access-token',
          userSub: 'kenny-sub',
        }}
        loadCurrentWeek={vi.fn().mockResolvedValue(mockWeek)}
      />,
    );

    await screen.findByText('Dallas Cowboys (DAL)');
    await user.click(screen.getByRole('button', { name: /picks board/i }));

    expect(screen.getByRole('heading', { name: /picks board/i })).toBeInTheDocument();
    expect(screen.getByText('Player')).toBeInTheDocument();
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
        loadCurrentWeek={vi.fn().mockResolvedValue({
          ...mockWeek,
          games: [],
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(logout).toHaveBeenCalledOnce();
  });
});
