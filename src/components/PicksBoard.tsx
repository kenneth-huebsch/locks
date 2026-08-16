import { useMemo } from 'react';
import type { Game, Pick } from '../../shared/types';
import { finalScoreLabel } from '../lib/game';
import { LEAGUE_ROSTER } from '../lib/players';
import { formatKickoffTime } from '../lib/time';
import { PickResultChip } from './PickResultChip';

export interface PicksBoardProps {
  games: Game[];
  picks: Pick[];
  userSub: string;
  weekNumber: number;
  playerRecords?: Record<string, string>;
}

export function PicksBoard({
  games,
  picks,
  weekNumber,
  playerRecords,
}: PicksBoardProps) {
  const picksByPlayerAndGame = useMemo(() => {
    const map = new Map<string, Pick>();
    for (const pick of picks) {
      if (LEAGUE_ROSTER.some((player) => player.sub === pick.playerId)) {
        map.set(`${pick.playerId}:${pick.gameId}`, pick);
      }
    }
    return map;
  }, [picks]);

  if (games.length === 0) {
    return <p className="text-slate-600">No games are scheduled.</p>;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-black text-blue-950">Week {weekNumber}</h2>

      {playerRecords ? (
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          aria-label="Standings"
        >
          {LEAGUE_ROSTER.map((player) => (
            <div className="flex items-baseline gap-1.5" key={player.sub}>
              <span className="font-semibold text-blue-950">{player.displayName}</span>
              {playerRecords[player.sub] ? (
                <span className="text-xs text-slate-500">{playerRecords[player.sub]}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <ul className="space-y-2">
        {games.map((game) => (
          <li
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
            key={game.id}
          >
            <div className="mb-1.5 border-b border-slate-100 pb-1.5">
              <p className="text-sm font-semibold text-blue-950">
                {finalScoreLabel(game) ??
                  `${game.awayAbbr} @ ${game.homeAbbr}`}
              </p>
              <p className="text-xs text-slate-500">
                {formatKickoffTime(game.commenceTime)}
              </p>
            </div>
            <ul className="space-y-1">
              {LEAGUE_ROSTER.flatMap((player) => {
                const pick = picksByPlayerAndGame.get(`${player.sub}:${game.id}`);
                if (!pick) {
                  return [];
                }

                return (
                  <li
                    className="flex items-center justify-between gap-2 text-sm"
                    key={player.sub}
                  >
                    <span className="text-slate-600">{player.displayName}</span>
                    <PickResultChip pick={pick} />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
