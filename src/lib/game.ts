import type { Game } from '../../shared/types.js';

export function finalScoreLabel(game: Game): string | null {
  if (
    game.status !== 'final' ||
    game.awayScore === null ||
    game.homeScore === null
  ) {
    return null;
  }

  return `${game.awayAbbr} ${game.awayScore} @ ${game.homeAbbr} ${game.homeScore}`;
}
