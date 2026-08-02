export function formatWeekNumber(week: number): string {
  return String(week).padStart(2, '0');
}

export function seasonWeekToken(season: number, week: number): string {
  return `${season}#W${formatWeekNumber(week)}`;
}

export function weekPartitionKey(season: number, week: number): string {
  return `WEEK#${seasonWeekToken(season, week)}`;
}

export function gameSortKey(eventId: string): string {
  return `GAME#${eventId}`;
}

export const QUOTA_PARTITION_KEY = 'QUOTA#ODDS_API';

export const ACTIVE_SEASON_PARTITION_KEY = 'SEASON#ACTIVE';
export const ACTIVE_SEASON_SORT_KEY = 'META';

export const WEEK_META_SORT_KEY = 'META';
