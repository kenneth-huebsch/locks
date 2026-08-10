const EASTERN_TIME_ZONE = 'America/New_York';

type EasternParts = {
  weekday: string;
  hour: number;
  minute: number;
};

function getEasternParts(isoTime: string): EasternParts {
  const date = new Date(isoTime);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);

  return { weekday, hour, minute };
}

export function formatKickoffTime(isoTime: string): string {
  const date = new Date(isoTime);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
    .format(date)
    .replace(', ', ' ')
    .replace(' AM', ' AM')
    .replace(' PM', ' PM');
}

export function formatOddsUpdatedAt(isoTime: string): string {
  const date = new Date(isoTime);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

export type GameDayGroup =
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday Early'
  | 'Sunday Late'
  | 'Monday'
  | 'Other';

const GAME_DAY_GROUP_ORDER: GameDayGroup[] = [
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday Early',
  'Sunday Late',
  'Monday',
  'Other',
];

function compareCommenceDesc(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

export function sortGamesByStartTimeDesc<T extends { commenceTime: string }>(
  games: T[],
): T[] {
  return [...games].sort((left, right) =>
    compareCommenceDesc(left.commenceTime, right.commenceTime),
  );
}

export function getGameDayGroup(commenceTime: string): GameDayGroup {
  const { weekday, hour, minute } = getEasternParts(commenceTime);

  if (weekday === 'Thu') {
    return 'Thursday';
  }
  if (weekday === 'Fri') {
    return 'Friday';
  }
  if (weekday === 'Sat') {
    return 'Saturday';
  }
  if (weekday === 'Mon') {
    return 'Monday';
  }

  if (weekday === 'Sun') {
    const minutesSinceMidnight = hour * 60 + minute;
    const lateKickoff = 16 * 60 + 25;
    return minutesSinceMidnight >= lateKickoff ? 'Sunday Late' : 'Sunday Early';
  }

  return 'Other';
}

export function groupGamesByDay<T extends { commenceTime: string }>(
  games: T[],
): { group: GameDayGroup; games: T[] }[] {
  const grouped = new Map<GameDayGroup, T[]>();

  // Newest kickoff first overall and within each day group.
  for (const game of sortGamesByStartTimeDesc(games)) {
    const group = getGameDayGroup(game.commenceTime);
    const existing = grouped.get(group) ?? [];
    existing.push(game);
    grouped.set(group, existing);
  }

  // Order day sections by the latest kickoff in that section (descending).
  return [...grouped.entries()]
    .map(([group, sectionGames]) => ({ group, games: sectionGames }))
    .sort((left, right) => {
      const leftTime = left.games[0]?.commenceTime ?? '';
      const rightTime = right.games[0]?.commenceTime ?? '';
      const byTime = compareCommenceDesc(leftTime, rightTime);
      if (byTime !== 0) {
        return byTime;
      }
      return (
        GAME_DAY_GROUP_ORDER.indexOf(left.group) -
        GAME_DAY_GROUP_ORDER.indexOf(right.group)
      );
    });
}

export function hasGameStarted(
  commenceTime: string,
  now: Date = new Date(),
): boolean {
  return new Date(commenceTime).getTime() <= now.getTime();
}

export function formatSpread(spread: number): string {
  if (spread > 0) {
    return `+${spread}`;
  }

  return String(spread);
}
