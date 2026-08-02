// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Game, Pick } from '../../shared/types';
import { GameCard } from './GameCard';

const futureGame: Game = {
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
};

const startedGame: Game = {
  ...futureGame,
  id: 'game-2',
  commenceTime: '2020-09-10T17:00:00.000Z',
  status: 'in_progress',
};

const existingPick: Pick = {
  playerId: 'player-1',
  gameId: 'game-1',
  seasonWeek: '2026#W01',
  pickedTeam: 'Dallas Cowboys',
  spreadAtPick: -3.5,
  submittedAt: '2099-09-09T12:00:00.000Z',
  result: 'pending',
};

describe('GameCard', () => {
  it('shows selectable sides for an unstarted game without a pick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<GameCard game={futureGame} onPick={onPick} />);

    const awayButton = screen.getByRole('button', {
      name: /Dallas Cowboys \(DAL\)/i,
    });
    expect(awayButton).toBeEnabled();

    await user.click(awayButton);
    expect(onPick).toHaveBeenCalledWith(
      'game-1',
      'Dallas Cowboys',
      -3.5,
    );
  });

  it('shows a disabled state for a started game', () => {
    render(
      <GameCard
        game={startedGame}
        now={new Date('2025-01-01T00:00:00.000Z')}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText(/game in progress/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Philadelphia Eagles \(PHI\)/i }),
    ).toBeDisabled();
  });

  it('shows a locked pick for an existing selection', () => {
    render(
      <GameCard
        existingPick={existingPick}
        game={futureGame}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/locked pick/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\)/i }),
    ).toBeDisabled();
    expect(screen.getByText(/DAL -3.5/i)).toBeInTheDocument();
  });
});
