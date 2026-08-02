export interface BoardPlayer {
  sub: string;
  displayName: string;
}

/**
 * Build the player list for the picks board from the current week's picks
 * and the authenticated user. Any player who has submitted a pick appears
 * as a column. The current user is always included even if they have no
 * picks yet. Display names come from a known mapping; unknown subs get a
 * generic label.
 */
const KNOWN_DISPLAY_NAMES: Record<string, string> = {
  // Kenny's Cognito sub will be filled in at runtime; this is a fallback.
};

const FALLBACK_NAMES: Record<string, string> = {};

export function boardPlayersForUser(
  userSub: string,
  picks: { playerId: string }[],
): BoardPlayer[] {
  const subs = new Set<string>([userSub]);
  for (const pick of picks) {
    subs.add(pick.playerId);
  }

  return Array.from(subs).map((sub) => ({
    sub,
    displayName: KNOWN_DISPLAY_NAMES[sub] ?? FALLBACK_NAMES[sub] ?? 'Player',
  }));
}

/**
 * Register a display name for a Cognito sub. Called when the app knows
 * who the current user is.
 */
export function registerDisplayName(sub: string, name: string): void {
  FALLBACK_NAMES[sub] = name;
}
