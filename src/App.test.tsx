// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, type AppAuth } from './App';
import { FOUNDATION_GAME, FOUNDATION_WEEK } from '../shared/foundation';

const unauthenticatedAuth: AppAuth = {
  isAuthenticated: false,
  isLoading: false,
  signinRedirect: vi.fn(),
  signoutRedirect: vi.fn(),
};

describe('App', () => {
  it('offers Cognito managed login when unauthenticated', async () => {
    const user = userEvent.setup();
    render(<App auth={unauthenticatedAuth} loadCurrentWeek={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(unauthenticatedAuth.signinRedirect).toHaveBeenCalledOnce();
    expect(screen.queryByText(FOUNDATION_GAME.homeTeam)).not.toBeInTheDocument();
  });

  it('loads and displays the current-week game when authenticated', async () => {
    render(
      <App
        auth={{
          ...unauthenticatedAuth,
          isAuthenticated: true,
          accessToken: 'access-token',
        }}
        loadCurrentWeek={vi.fn().mockResolvedValue({
          season: FOUNDATION_WEEK.season,
          week: FOUNDATION_WEEK.week,
          games: [FOUNDATION_GAME],
        })}
      />,
    );

    expect(await screen.findByText(FOUNDATION_GAME.awayTeam)).toBeInTheDocument();
    expect(screen.getByText(FOUNDATION_GAME.homeTeam)).toBeInTheDocument();
    expect(screen.getByText(/week 1/i)).toBeInTheDocument();
  });
});
