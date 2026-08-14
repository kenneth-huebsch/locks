// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Game, Pick } from '../../shared/types';
import { JACK_SUB, KENNY_SUB } from '../lib/players';
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
  awayScore: null,
  homeScore: null,
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

const finalGame: Game = {
  ...startedGame,
  id: 'game-3',
  status: 'final',
  awayScore: 17,
  homeScore: 24,
};

const existingPick: Pick = {
  playerId: KENNY_SUB,
  gameId: 'game-1',
  seasonWeek: '2026#W01',
  pickedTeam: 'Dallas Cowboys',
  spreadAtPick: -3.5,
  submittedAt: '2099-09-09T12:00:00.000Z',
  result: 'pending',
};

const driftedPick: Pick = {
  ...existingPick,
  spreadAtPick: -3.5,
};

const gradedPick: Pick = {
  ...existingPick,
  gameId: 'game-3',
  result: 'win',
};

const peerPick: Pick = {
  playerId: JACK_SUB,
  gameId: 'game-2',
  seasonWeek: '2026#W01',
  pickedTeam: 'Philadelphia Eagles',
  spreadAtPick: 3.5,
  submittedAt: '2099-09-09T12:30:00.000Z',
  result: 'pending',
};

const gradedPeerPick: Pick = {
  ...peerPick,
  gameId: 'game-3',
  result: 'loss',
};

describe('GameCard', () => {
  it('shows selectable sides for an unstarted game without a pick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<GameCard game={futureGame} onPick={onPick} />);

    const awayButton = screen.getByRole('button', {
      name: /Dallas Cowboys \(DAL\) -3\.5/i,
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
      screen.getByRole('button', { name: /Dallas Cowboys \(DAL\) -3\.5/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Philadelphia Eagles \(PHI\) \+3\.5/i }),
    ).toBeDisabled();
  });

  it('shows the final score once a game is scored', () => {
    render(
      <GameCard
        game={finalGame}
        now={new Date('2025-01-01T00:00:00.000Z')}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText(/DAL 17 @ PHI 24/i)).toBeInTheDocument();
    expect(screen.queryByText(/game in progress/i)).not.toBeInTheDocument();
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
    const lockedButton = screen.getByRole('button', {
      name: /Dallas Cowboys \(DAL\) -3\.5/i,
    });
    expect(lockedButton).toBeDisabled();
    expect(within(lockedButton).getAllByText(/DAL -3.5/i).length).toBeGreaterThan(0);
  });

  it('shows locked and current lines when the spread has moved', () => {
    render(
      <GameCard
        existingPick={driftedPick}
        game={{ ...futureGame, awaySpread: -1.5, homeSpread: 1.5 }}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Locked DAL -3\.5/i)).toBeInTheDocument();
    expect(screen.getByText(/Now DAL -1\.5/i)).toBeInTheDocument();
  });

  it('shows revealed peer picks for a started game', () => {
    render(
      <GameCard
        existingPick={{ ...existingPick, gameId: 'game-2' }}
        game={startedGame}
        now={new Date('2025-01-01T00:00:00.000Z')}
        onPick={vi.fn()}
        revealedPicks={[
          { ...existingPick, gameId: 'game-2' },
          peerPick,
        ]}
      />,
    );

    const revealed = screen.getByLabelText(/revealed picks/i);
    expect(within(revealed).getByText('Kenny')).toBeInTheDocument();
    expect(within(revealed).getByText('Jack')).toBeInTheDocument();
    expect(within(revealed).getByText('DAL -3.5')).toBeInTheDocument();
    expect(within(revealed).getByText('PHI +3.5')).toBeInTheDocument();
  });

  it('shows graded results for the caller and revealed peers', () => {
    render(
      <GameCard
        existingPick={gradedPick}
        game={finalGame}
        now={new Date('2025-01-01T00:00:00.000Z')}
        onPick={vi.fn()}
        revealedPicks={[gradedPick, gradedPeerPick]}
      />,
    );

    expect(screen.getByText(/^win$/i)).toBeInTheDocument();
    const revealed = screen.getByLabelText(/revealed picks/i);
    expect(within(revealed).getByText('Kenny')).toBeInTheDocument();
    expect(within(revealed).getByText('Jack')).toBeInTheDocument();
    expect(within(revealed).getByText('DAL -3.5')).toBeInTheDocument();
    expect(within(revealed).getByText('PHI +3.5')).toBeInTheDocument();
  });
});
