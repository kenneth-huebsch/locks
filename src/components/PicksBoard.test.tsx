// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { Game, Pick } from '../../shared/types';
import { PicksBoard } from './PicksBoard';

const game: Game = {
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
};

const picks: Pick[] = [
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
  {
    playerId: 'stray-sub',
    gameId: 'w1-g1',
    seasonWeek: '2026#W01',
    pickedTeam: 'Dallas Cowboys',
    spreadAtPick: -3.5,
    submittedAt: '2026-09-09T20:00:00.000Z',
    result: 'win',
  },
];

describe('PicksBoard', () => {
  it('renders week title, standings strip, and card-per-game layout', () => {
    render(
      <PicksBoard
        games={[game]}
        picks={picks}
        userSub="kenny-sub"
        weekNumber={1}
        playerRecords={{
          'kenny-sub': '1-0-0',
          'jack-sub': '0-1-0',
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: /^week 1$/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/standings/i)).toBeInTheDocument();
    expect(screen.getByText('1-0-0')).toBeInTheDocument();
    expect(screen.getByText('0-1-0')).toBeInTheDocument();
    expect(screen.getByText('DAL @ PHI')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows only players who submitted a pick for each game', () => {
    render(
      <PicksBoard
        games={[game]}
        picks={picks}
        userSub="kenny-sub"
        weekNumber={1}
      />,
    );

    expect(screen.getAllByText('Kenny')).toHaveLength(1);
    expect(screen.getAllByText('Jack')).toHaveLength(1);
    expect(screen.queryByText('Eric')).not.toBeInTheDocument();
    expect(screen.queryByText('Player')).not.toBeInTheDocument();
    expect(screen.queryByText('stray-sub')).not.toBeInTheDocument();
  });

  it('shows pick chips with team abbr and spread for submitted picks', () => {
    render(
      <PicksBoard
        games={[game]}
        picks={picks}
        userSub="kenny-sub"
        weekNumber={1}
      />,
    );

    expect(screen.getByText('DAL -3.5')).toBeInTheDocument();
    expect(screen.getByText('PHI +3.5')).toBeInTheDocument();
    expect(screen.queryByText('No pick')).not.toBeInTheDocument();
  });
});
