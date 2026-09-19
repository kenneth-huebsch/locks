import type {
  SurvivorChallengeStatus,
  SurvivorPick,
  SurvivorPlayerState,
  SurvivorPlayerStatus,
} from './types.js';
import { seasonWeekToken } from './dynamo.js';

export interface SurvivorLifecycleInput {
  season: number;
  week: number;
  challengeStatus: SurvivorChallengeStatus;
  players: SurvivorPlayerState[];
  picks: SurvivorPick[];
  /** True when every game on the week slate is final (missed-pick elim may run). */
  allGamesFinal: boolean;
}

export interface SurvivorLifecycleResult {
  challengeStatus: SurvivorChallengeStatus;
  winners: string[];
  players: SurvivorPlayerState[];
  eliminatedThisWeek: string[];
}

function clonePlayers(
  players: readonly SurvivorPlayerState[],
): SurvivorPlayerState[] {
  return players.map((player) => ({
    ...player,
    usedTeams: [...player.usedTeams],
  }));
}

/**
 * Apply survivor results for a week: losses and (when the slate is complete)
 * missed picks eliminate; then resolve sole winner / co-winners / Week 18.
 */
export function resolveSurvivorWeek(
  input: SurvivorLifecycleInput,
): SurvivorLifecycleResult {
  if (input.challengeStatus === 'complete') {
    return {
      challengeStatus: 'complete',
      winners: input.players
        .filter((player) => player.status === 'winner')
        .map((player) => player.playerId),
      players: clonePlayers(input.players),
      eliminatedThisWeek: [],
    };
  }

  const seasonWeek = seasonWeekToken(input.season, input.week);
  const players = clonePlayers(input.players);
  const aliveEntering = players
    .filter((player) => player.status === 'alive')
    .map((player) => player.playerId);
  const eliminatedThisWeek: string[] = [];
  const picksByPlayer = new Map(
    input.picks.map((pick) => [pick.playerId, pick] as const),
  );

  for (const player of players) {
    if (player.status !== 'alive') {
      continue;
    }

    const pick = picksByPlayer.get(player.playerId);
    if (pick?.result === 'loss') {
      player.status = 'eliminated';
      player.eliminatedWeek = seasonWeek;
      eliminatedThisWeek.push(player.playerId);
      continue;
    }

    if (input.allGamesFinal && !pick) {
      player.status = 'eliminated';
      player.eliminatedWeek = seasonWeek;
      eliminatedThisWeek.push(player.playerId);
    }
  }

  const stillAlive = players.filter((player) => player.status === 'alive');

  if (stillAlive.length === 1) {
    const winner = stillAlive[0]!;
    winner.status = 'winner';
    return {
      challengeStatus: 'complete',
      winners: [winner.playerId],
      players,
      eliminatedThisWeek,
    };
  }

  if (stillAlive.length === 0) {
    return {
      challengeStatus: 'complete',
      winners: [...aliveEntering],
      players: players.map((player) =>
        aliveEntering.includes(player.playerId)
          ? { ...player, status: 'winner' as SurvivorPlayerStatus }
          : player,
      ),
      eliminatedThisWeek,
    };
  }

  if (input.week >= 18 && input.allGamesFinal) {
    const winners = stillAlive.map((player) => player.playerId);
    for (const player of stillAlive) {
      player.status = 'winner';
    }
    return {
      challengeStatus: 'complete',
      winners,
      players,
      eliminatedThisWeek,
    };
  }

  return {
    challengeStatus: 'active',
    winners: [],
    players,
    eliminatedThisWeek,
  };
}

export function survivorCanPick(input: {
  challengeStatus: SurvivorChallengeStatus;
  myStatus: SurvivorPlayerStatus | null;
  hasPickThisWeek: boolean;
}): boolean {
  return (
    input.challengeStatus === 'active' &&
    input.myStatus === 'alive' &&
    !input.hasPickThisWeek
  );
}
