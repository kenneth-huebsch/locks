export function formatWeekNumber(week: number): string {
  return String(week).padStart(2, '0');
}

export function seasonWeekToken(season: number, week: number): string {
  return `${season}#W${formatWeekNumber(week)}`;
}

const SEASON_WEEK_TOKEN_PATTERN = /^(\d{4})#W(\d{2})$/;

/** Parse a canonical season-week token such as `2026#W01`. */
export function parseSeasonWeekToken(token: string): {
  season: number;
  week: number;
} {
  const match = SEASON_WEEK_TOKEN_PATTERN.exec(token);
  if (!match) {
    throw new Error(
      `Invalid seasonWeek token "${token}"; expected YYYY#Wnn (e.g. 2026#W01)`,
    );
  }

  return {
    season: Number(match[1]),
    week: Number(match[2]),
  };
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

export function playerPartitionKey(cognitoSub: string): string {
  return `PLAYER#${cognitoSub}`;
}

export function pickSortKey(
  season: number,
  week: number,
  gameId: string,
): string {
  return `PICK#${seasonWeekToken(season, week)}#GAME#${gameId}`;
}

export function pickGsi1PartitionKey(season: number, week: number): string {
  return weekPartitionKey(season, week);
}

export function pickGsi1SortKey(cognitoSub: string, gameId: string): string {
  return `PICK#${cognitoSub}#GAME#${gameId}`;
}

export function counterSortKey(season: number, week: number): string {
  return `COUNTER#${seasonWeekToken(season, week)}`;
}

export const PUSH_CONFIG_PARTITION_KEY = 'CONFIG#PUSH';
export const PUSH_VAPID_SORT_KEY = 'VAPID';
export const PUSH_SUBSCRIPTION_SORT_PREFIX = 'PUSH#';

export function pushSubscriptionSortKey(endpointHash: string): string {
  return `${PUSH_SUBSCRIPTION_SORT_PREFIX}${endpointHash}`;
}

export const SURVIVOR_META_SORT_KEY = 'META';
export const SURVIVOR_PICK_SK_PREFIX = 'SURVIVOR#';

export function survivorChallengePartitionKey(season: number): string {
  return `SURVIVOR#${season}`;
}

export function survivorPlayerSortKey(cognitoSub: string): string {
  return `PLAYER#${cognitoSub}`;
}

export function survivorPickSortKey(season: number, week: number): string {
  return `${SURVIVOR_PICK_SK_PREFIX}${seasonWeekToken(season, week)}`;
}

export function survivorPickGsi1SortKey(cognitoSub: string): string {
  return `${SURVIVOR_PICK_SK_PREFIX}${cognitoSub}`;
}
