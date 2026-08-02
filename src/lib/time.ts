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
  | 'Sunday Early'
  | 'Sunday Late'
  | 'Monday';

const GAME_DAY_GROUP_ORDER: GameDayGroup[] = [
  'Thursday',
  'Sunday Early',
  'Sunday Late',
  'Monday',
];

export function getGameDayGroup(commenceTime: string): GameDayGroup {
  const { weekday, hour, minute } = getEasternParts(commenceTime);

  if (weekday === 'Thu') {
    return 'Thursday';
  }

  if (weekday === 'Mon') {
    return 'Monday';
  }

  if (weekday === 'Sun') {
    const minutesSinceMidnight = hour * 60 + minute;
    const lateKickoff = 16 * 60 + 25;
    return minutesSinceMidnight >= lateKickoff ? 'Sunday Late' : 'Sunday Early';
  }

  return 'Sunday Early';
}

export function groupGamesByDay<T extends { commenceTime: string }>(
  games: T[],
): { group: GameDayGroup; games: T[] }[] {
  const grouped = new Map<GameDayGroup, T[]>();

  for (const game of games) {
    const group = getGameDayGroup(game.commenceTime);
    const existing = grouped.get(group) ?? [];
    existing.push(game);
    grouped.set(group, existing);
  }

  return GAME_DAY_GROUP_ORDER.filter((group) => grouped.has(group)).map(
    (group) => ({
      group,
      games: grouped.get(group) ?? [],
    }),
  );
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
