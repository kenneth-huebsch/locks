import { describe, expect, it } from 'vitest';
import type { Pick } from './types.js';
import {
  computePlayerRecord,
  computePlayerRecordsById,
  computeStandingsFromPicks,
  formatPlayerRecord,
  recordsForWeek,
  recordsThroughWeek,
} from './records.js';

function pick(
  playerId: string,
  result: Pick['result'],
  seasonWeek = '2026#W01',
  gameId = 'g1',
): Pick {
  return {
    playerId,
    gameId,
    seasonWeek,
    pickedTeam: 'Team',
    spreadAtPick: -3,
    submittedAt: '2026-09-09T18:00:00.000Z',
    result,
  };
}

describe('computePlayerRecord', () => {
  it('counts wins, losses, and pushes', () => {
    expect(
      computePlayerRecord([
        pick('kenny', 'win'),
        pick('kenny', 'loss', '2026#W01', 'g2'),
        pick('kenny', 'push', '2026#W01', 'g3'),
      ]),
    ).toEqual({ wins: 1, losses: 1, pushes: 1 });
  });

  it('ignores pending picks', () => {
    expect(
      computePlayerRecord([
        pick('kenny', 'win'),
        pick('kenny', 'pending', '2026#W01', 'g2'),
      ]),
    ).toEqual({ wins: 1, losses: 0, pushes: 0 });
  });

  it('returns zeroes for an empty pick list', () => {
    expect(computePlayerRecord([])).toEqual({ wins: 0, losses: 0, pushes: 0 });
  });
});

describe('formatPlayerRecord', () => {
  it('formats as W-L-T', () => {
    expect(formatPlayerRecord({ wins: 2, losses: 1, pushes: 0 })).toBe('2-1-0');
  });
});

describe('recordsThroughWeek', () => {
  it('formats cumulative records through the selected week', () => {
    const standings = computeStandingsFromPicks(
      [
        pick('kenny', 'win', '2026#W01', 'w1-g1'),
        pick('kenny', 'push', '2026#W02', 'w2-g1'),
        pick('kenny', 'loss', '2026#W03', 'w3-g1'),
        pick('jack', 'loss', '2026#W01', 'w1-g1'),
        pick('jack', 'win', '2026#W02', 'w2-g1'),
      ],
      2026,
      3,
    );

    expect(recordsThroughWeek(standings, 2)).toEqual({
      jack: '1-1-0',
      kenny: '1-0-1',
    });
  });

  it('includes missed-week losses through the selected week', () => {
    const standings = computeStandingsFromPicks(
      [pick('kenny', 'win', '2026#W03', 'w3-g1')],
      2026,
      3,
    );

    expect(recordsThroughWeek(standings, 2)).toEqual({
      kenny: '0-6-0',
    });
  });
});

describe('recordsForWeek', () => {
  it('formats only the selected weekly record', () => {
    const standings = computeStandingsFromPicks(
      [
        pick('kenny', 'win', '2026#W01', 'w1-g1'),
        pick('kenny', 'loss', '2026#W02', 'w2-g1'),
      ],
      2026,
      3,
    );

    expect(recordsForWeek(standings, 2)).toEqual({
      kenny: '0-1-0',
    });
  });
});

describe('computePlayerRecordsById', () => {
  it('builds cumulative records per player across weeks', () => {
    const picks: Pick[] = [
      pick('kenny', 'win', '2026#W01', 'w1-g1'),
      pick('kenny', 'push', '2026#W01', 'w1-g2'),
      pick('jack', 'loss', '2026#W01', 'w1-g1'),
      pick('kenny', 'win', '2026#W02', 'w2-g1'),
      pick('kenny', 'loss', '2026#W02', 'w2-g2'),
      pick('jack', 'win', '2026#W02', 'w2-g2'),
    ];

    expect(computePlayerRecordsById(picks)).toEqual({
      kenny: '2-1-1',
      jack: '1-1-0',
    });
  });

  it('excludes pending picks from each player record', () => {
    expect(
      computePlayerRecordsById([
        pick('kenny', 'win'),
        pick('kenny', 'pending', '2026#W01', 'g2'),
        pick('jack', 'pending', '2026#W01', 'g3'),
      ]),
    ).toEqual({
      kenny: '1-0-0',
      jack: '0-0-0',
    });
  });
});

describe('computeStandingsFromPicks', () => {
  it('returns empty players when there are no picks', () => {
    expect(computeStandingsFromPicks([], 2026, 2)).toEqual({
      season: 2026,
      currentWeek: 2,
      players: [],
    });
  });

  it('aggregates season and weekly records separately', () => {
    const picks: Pick[] = [
      pick('kenny', 'win', '2026#W01', 'w1-g1'),
      pick('kenny', 'loss', '2026#W01', 'w1-g2'),
      pick('jack', 'push', '2026#W01', 'w1-g1'),
      pick('kenny', 'win', '2026#W02', 'w2-g1'),
      pick('jack', 'loss', '2026#W02', 'w2-g1'),
    ];

    expect(computeStandingsFromPicks(picks, 2026, 2)).toEqual({
      season: 2026,
      currentWeek: 2,
      players: [
        {
          playerId: 'jack',
          season: { wins: 0, losses: 1, pushes: 1 },
          weeks: [
            {
              season: 2026,
              week: 1,
              seasonWeek: '2026#W01',
              isCurrent: false,
              record: { wins: 0, losses: 0, pushes: 1 },
            },
            {
              season: 2026,
              week: 2,
              seasonWeek: '2026#W02',
              isCurrent: true,
              record: { wins: 0, losses: 1, pushes: 0 },
            },
          ],
        },
        {
          playerId: 'kenny',
          season: { wins: 2, losses: 1, pushes: 0 },
          weeks: [
            {
              season: 2026,
              week: 1,
              seasonWeek: '2026#W01',
              isCurrent: false,
              record: { wins: 1, losses: 1, pushes: 0 },
            },
            {
              season: 2026,
              week: 2,
              seasonWeek: '2026#W02',
              isCurrent: true,
              record: { wins: 1, losses: 0, pushes: 0 },
            },
          ],
        },
      ],
    });
  });

  it('includes the roster and charges three losses for a past week with no picks', () => {
    const standings = computeStandingsFromPicks(
      [pick('kenny', 'win', '2026#W01', 'w1-g1')],
      2026,
      2,
      ['kenny', 'eric'],
    );

    expect(standings.players).toEqual([
      {
        playerId: 'kenny',
        season: { wins: 1, losses: 0, pushes: 0 },
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
            isCurrent: true,
            record: { wins: 0, losses: 0, pushes: 0 },
          },
        ],
      },
      {
        playerId: 'eric',
        season: { wins: 0, losses: 3, pushes: 0 },
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
            isCurrent: true,
            record: { wins: 0, losses: 0, pushes: 0 },
          },
        ],
      },
    ]);
  });

  it('does not pad partial weeks or an empty current week', () => {
    const standings = computeStandingsFromPicks(
      [pick('kenny', 'win', '2026#W01', 'w1-g1')],
      2026,
      2,
      ['kenny'],
    );

    expect(standings.players[0]?.weeks.map((week) => week.record)).toEqual([
      { wins: 1, losses: 0, pushes: 0 },
      { wins: 0, losses: 0, pushes: 0 },
    ]);
  });
});
