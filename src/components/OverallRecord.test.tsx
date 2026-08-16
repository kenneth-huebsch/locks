// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { StandingsResponse } from '../../shared/types';
import { ERIC_SUB, JACK_SUB, KENNY_SUB } from '../lib/players';
import { OverallRecord } from './OverallRecord';

const standings: StandingsResponse = {
  season: 2026,
  currentWeek: 2,
  players: [
    {
      playerId: KENNY_SUB,
      season: { wins: 3, losses: 0, pushes: 0 },
      weeks: [],
    },
    {
      playerId: JACK_SUB,
      season: { wins: 1, losses: 2, pushes: 0 },
      weeks: [],
    },
    {
      playerId: ERIC_SUB,
      season: { wins: 0, losses: 3, pushes: 0 },
      weeks: [],
    },
  ],
};

describe('OverallRecord', () => {
  it('renders each player portrait and overall W-L-P record', () => {
    render(<OverallRecord standings={standings} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /^standings$/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/kenny overall record/i)).toHaveTextContent(
      '3-0-0',
    );
    expect(screen.getByLabelText(/jack overall record/i)).toHaveTextContent(
      '1-2-0',
    );
    expect(screen.getByLabelText(/eric overall record/i)).toHaveTextContent(
      '0-3-0',
    );
    expect(screen.getByRole('img', { name: 'Eric' })).toHaveAttribute(
      'src',
      '/players/eric.jpg',
    );
  });
});
