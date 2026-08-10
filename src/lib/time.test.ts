import { describe, expect, it } from 'vitest';
import { groupGamesByDay, sortGamesByStartTimeAsc } from './time';

describe('game ordering', () => {
  it('sorts games by commenceTime ascending', () => {
    const games = [
      { id: 'a', commenceTime: '2026-08-13T23:00:00Z' },
      { id: 'b', commenceTime: '2026-08-16T00:00:00Z' },
      { id: 'c', commenceTime: '2026-08-15T17:00:00Z' },
    ];
    expect(sortGamesByStartTimeAsc(games).map((g) => g.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('groups preseason days and keeps ascending kickoffs', () => {
    const games = [
      { id: 'thu', commenceTime: '2026-08-13T23:00:00Z' },
      { id: 'fri-early', commenceTime: '2026-08-14T23:00:00Z' },
      { id: 'fri-late', commenceTime: '2026-08-15T01:00:00Z' },
      { id: 'sat', commenceTime: '2026-08-16T00:00:00Z' },
    ];
    const grouped = groupGamesByDay(games);
    expect(grouped.map((g) => g.group)).toEqual([
      'Thursday',
      'Friday',
      'Saturday',
    ]);
    expect(grouped[0]?.games.map((g) => g.id)).toEqual(['thu']);
    expect(grouped[1]?.games.map((g) => g.id)).toEqual([
      'fri-early',
      'fri-late',
    ]);
  });
});
