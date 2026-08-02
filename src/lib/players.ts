export interface BoardPlayer {
  sub: string | null;
  displayName: string;
}

export const BOARD_PLAYERS: BoardPlayer[] = [
  { sub: null, displayName: 'Kenny' },
  { sub: null, displayName: 'Jack' },
  { sub: null, displayName: 'Eric' },
];

export function boardPlayersForUser(userSub: string): BoardPlayer[] {
  return BOARD_PLAYERS.map((player, index) =>
    index === 0 ? { ...player, sub: userSub } : player,
  );
}
