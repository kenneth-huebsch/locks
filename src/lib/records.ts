import type { Pick } from '../../shared/types';

export interface PlayerRecord {
  wins: number;
  losses: number;
  pushes: number;
}

export function computePlayerRecord(picks: Pick[]): PlayerRecord {
  const record: PlayerRecord = { wins: 0, losses: 0, pushes: 0 };

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

export function formatPlayerRecord(record: PlayerRecord): string {
  return `${record.wins}-${record.losses}-${record.pushes}`;
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
