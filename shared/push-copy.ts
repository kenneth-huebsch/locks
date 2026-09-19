import { findTeam } from './teams.js';
import type { Pick as PickRecord } from './types.js';

export interface GameSides {
  awayTeam: string;
  homeTeam: string;
  awayAbbr: string;
  homeAbbr: string;
}

export function formatSpread(spread: number): string {
  if (spread > 0) {
    return `+${spread}`;
  }

  return String(spread);
}

export function formatPickNotification(input: {
  displayName: string;
  pickedTeam: string;
  spreadAtPick: number;
  isSwing: boolean;
}): string {
  const city = findTeam(input.pickedTeam)?.city ?? input.pickedTeam;
  const spread = formatSpread(input.spreadAtPick);
  if (input.isSwing) {
    return `🚨 ${input.displayName} swung ${city} ${spread}`;
  }

  return `🔒 ${input.displayName} locked ${city} ${spread}`;
}

export function formatIncompleteReminder(remainingPicks: number): string {
  const noun = remainingPicks === 1 ? 'lock' : 'locks';
  return `You still have ${remainingPicks} ${noun} left. Open Locks and get them in.`;
}

export function formatSurvivorPickNotification(input: {
  displayName: string;
  pickedTeam: string;
}): string {
  const teamName =
    findTeam(input.pickedTeam)?.fullName ?? input.pickedTeam;
  return `🔥 ${input.displayName} picked ${teamName} for survival`;
}

export function formatSurvivorIncompleteReminder(): string {
  return 'You still need a survivor pick this week. Open Locks and Survive before kickoff.';
}

export function isOppositeSidePick(
  pickedTeam: string,
  otherPickedTeam: string,
  game: GameSides,
): boolean {
  const pickedSide = teamSide(pickedTeam, game);
  const otherSide = teamSide(otherPickedTeam, game);
  return (
    pickedSide !== undefined &&
    otherSide !== undefined &&
    pickedSide !== otherSide
  );
}

export function isSwingAgainstPeers(
  pickerSub: string,
  pickedTeam: string,
  gameId: string,
  picks: readonly PickRecord[],
  game: GameSides,
): boolean {
  return picks.some(
    (pick) =>
      pick.gameId === gameId &&
      pick.playerId !== pickerSub &&
      isOppositeSidePick(pickedTeam, pick.pickedTeam, game),
  );
}

function teamSide(
  team: string,
  game: GameSides,
): 'away' | 'home' | undefined {
  if (matchesTeam(team, game.awayTeam, game.awayAbbr)) {
    return 'away';
  }

  if (matchesTeam(team, game.homeTeam, game.homeAbbr)) {
    return 'home';
  }

  return undefined;
}

function matchesTeam(team: string, name: string, abbr: string): boolean {
  if (team === name || team === abbr) {
    return true;
  }

  const resolved = findTeam(team);
  return (
    resolved !== undefined &&
    (resolved.fullName === name || resolved.abbreviation === abbr)
  );
}
