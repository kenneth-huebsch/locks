import { parseSeasonWeekToken, seasonWeekToken } from './dynamo.js';
import type { Pick, PlayerStandings, StandingsResponse, WinLossTie } from './types.js';

export function computePlayerRecord(picks: Pick[]): WinLossTie {
  const record: WinLossTie = { wins: 0, losses: 0, pushes: 0 };

  for (const pick of picks) {
    switch (pick.result) {
      case 'win':
        record.wins += 1;
        break;
      case 'loss':
        record.losses += 1;
        break;
      case 'push':
        record.pushes += 1;
        break;
      case 'pending':
        break;
    }
  }

  return record;
}

export function formatPlayerRecord(record: WinLossTie): string {
  return `${record.wins}-${record.losses}-${record.pushes}`;
}

export function recordsThroughWeek(
  standings: StandingsResponse,
  throughWeek: number,
): Record<string, string> {
  const records: Record<string, string> = {};

  for (const player of standings.players) {
    const record = player.weeks
      .filter((week) => week.week <= throughWeek)
      .reduce<WinLossTie>(
        (total, week) => ({
          wins: total.wins + week.record.wins,
          losses: total.losses + week.record.losses,
          pushes: total.pushes + week.record.pushes,
        }),
        { wins: 0, losses: 0, pushes: 0 },
      );
    records[player.playerId] = formatPlayerRecord(record);
  }

  return records;
}

export function recordsForWeek(
  standings: StandingsResponse,
  weekNumber: number,
): Record<string, string> {
  const records: Record<string, string> = {};

  for (const player of standings.players) {
    const week = player.weeks.find((entry) => entry.week === weekNumber);
    if (week) {
      records[player.playerId] = formatPlayerRecord(week.record);
    }
  }

  return records;
}

export function computePlayerRecordsById(picks: Pick[]): Record<string, string> {
  const picksByPlayer = new Map<string, Pick[]>();

  for (const pick of picks) {
    const playerPicks = picksByPlayer.get(pick.playerId) ?? [];
    playerPicks.push(pick);
    picksByPlayer.set(pick.playerId, playerPicks);
  }

  const records: Record<string, string> = {};
  for (const [playerId, playerPicks] of picksByPlayer) {
    records[playerId] = formatPlayerRecord(computePlayerRecord(playerPicks));
  }

  return records;
}

export function computeStandingsFromPicks(
  picks: Pick[],
  season: number,
  currentWeek: number,
  rosterPlayerIds?: readonly string[],
): StandingsResponse {
  const picksByPlayer = new Map<string, Pick[]>();
  for (const pick of picks) {
    const playerPicks = picksByPlayer.get(pick.playerId) ?? [];
    playerPicks.push(pick);
    picksByPlayer.set(pick.playerId, playerPicks);
  }

  const playerIds = rosterPlayerIds
    ? [...rosterPlayerIds]
    : [...picksByPlayer.keys()].sort();
  const players: PlayerStandings[] = playerIds.map((playerId) => {
    const playerPicks = picksByPlayer.get(playerId) ?? [];
    const picksByWeek = new Map<string, Pick[]>();
    for (const pick of playerPicks) {
      const weekPicks = picksByWeek.get(pick.seasonWeek) ?? [];
      weekPicks.push(pick);
      picksByWeek.set(pick.seasonWeek, weekPicks);
    }

    const weeks = Array.from({ length: currentWeek }, (_, index) => {
      const week = index + 1;
      const token = seasonWeekToken(season, week);
      const { season: weekSeason, week: weekNumber } = parseSeasonWeekToken(token);
      const weekPicks = picksByWeek.get(token) ?? [];
      const record =
        week < currentWeek && weekPicks.length === 0
          ? { wins: 0, losses: 3, pushes: 0 }
          : computePlayerRecord(weekPicks);
      return {
        season: weekSeason,
        week: weekNumber,
        seasonWeek: token,
        isCurrent: week === currentWeek,
        record,
      };
    });

    const seasonRecord = weeks.reduce<WinLossTie>(
      (total, week) => ({
        wins: total.wins + week.record.wins,
        losses: total.losses + week.record.losses,
        pushes: total.pushes + week.record.pushes,
      }),
      { wins: 0, losses: 0, pushes: 0 },
    );

    return {
      playerId,
      season: seasonRecord,
      weeks,
    };
  });

  return {
    season,
    currentWeek,
    players,
  };
}
