import { describe, expect, it } from 'vitest';
import { groupGamesByDay, sortGamesByStartTimeDesc } from './time';

describe('game ordering', () => {
  it('sorts games by commenceTime descending', () => {
    const games = [
      { id: 'a', commenceTime: '2026-08-13T23:00:00Z' },
      { id: 'b', commenceTime: '2026-08-16T00:00:00Z' },
      { id: 'c', commenceTime: '2026-08-15T17:00:00Z' },
    ];
    expect(sortGamesByStartTimeDesc(games).map((g) => g.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('groups preseason days and keeps descending kickoffs', () => {
    const games = [
      { id: 'thu', commenceTime: '2026-08-13T23:00:00Z' },
      { id: 'fri-early', commenceTime: '2026-08-14T23:00:00Z' },
      { id: 'fri-late', commenceTime: '2026-08-15T01:00:00Z' },
      { id: 'sat', commenceTime: '2026-08-16T00:00:00Z' },
    ];
    const grouped = groupGamesByDay(games);
    expect(grouped.map((g) => g.group)).toEqual([
      'Saturday',
      'Friday',
      'Thursday',
    ]);
    expect(grouped[0]?.games.map((g) => g.id)).toEqual(['sat']);
    expect(grouped[1]?.games.map((g) => g.id)).toEqual([
      'fri-late',
      'fri-early',
    ]);
  });
});
