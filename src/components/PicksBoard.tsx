import { useMemo } from 'react';
import type { Game, Pick } from '../../shared/types';
import { getTeamByName } from '../../shared/teams';
import { LEAGUE_ROSTER } from '../lib/players';
import { formatKickoffTime, formatSpread } from '../lib/time';

export interface PicksBoardProps {
  games: Game[];
  picks: Pick[];
  userSub: string;
  weekNumber: number;
  playerRecords?: Record<string, string>;
}

const RESULT_STYLES: Record<Pick['result'], string> = {
  pending: 'bg-slate-100 text-slate-700',
  win: 'bg-green-100 text-green-900',
  loss: 'bg-red-100 text-red-900',
  push: 'bg-yellow-100 text-yellow-900',
};

function pickChipLabel(pick: Pick): string {
  const team = getTeamByName(pick.pickedTeam);
  const abbr = team?.abbreviation ?? pick.pickedTeam;
  return `${abbr} ${formatSpread(pick.spreadAtPick)}`;
}

function PickChip({ pick }: { pick: Pick }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${RESULT_STYLES[pick.result]}`}
    >
      {pickChipLabel(pick)}
    </span>
  );
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
                {game.awayAbbr} @ {game.homeAbbr}
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
                    <PickChip pick={pick} />
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
