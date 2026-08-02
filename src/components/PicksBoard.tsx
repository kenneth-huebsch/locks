import { useMemo } from 'react';
import type { Game, Pick } from '../../shared/types';
import { boardPlayersForUser } from '../lib/players';
import { formatKickoffTime, formatSpread } from '../lib/time';

export interface PicksBoardProps {
  games: Game[];
  picks: Pick[];
  userSub: string;
}

const RESULT_STYLES: Record<Pick['result'], string> = {
  pending: 'bg-slate-100 text-slate-700',
  win: 'bg-green-100 text-green-900',
  loss: 'bg-red-100 text-red-900',
  push: 'bg-yellow-100 text-yellow-900',
};

function pickLabel(pick: Pick | undefined): string {
  if (!pick) {
    return '—';
  }

  return `${pick.pickedTeam} ${formatSpread(pick.spreadAtPick)}`;
}

export function PicksBoard({ games, picks, userSub }: PicksBoardProps) {
  const players = useMemo(() => boardPlayersForUser(userSub), [userSub]);

  const picksByPlayerAndGame = useMemo(() => {
    const map = new Map<string, Pick>();
    for (const pick of picks) {
      map.set(`${pick.playerId}:${pick.gameId}`, pick);
    }
    return map;
  }, [picks]);

  if (games.length === 0) {
    return <p className="text-slate-600">No games are scheduled.</p>;
  }

  return (
    <section>
      <h2 className="text-3xl font-black text-blue-950">Picks board</h2>
      <p className="mt-2 text-slate-600">
        All submitted picks are visible to every player.
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="min-w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Game
              </th>
              {players.map((player) => (
                <th
                  className="border border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500"
                  key={player.displayName}
                >
                  {player.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.id}>
                <td className="border border-slate-200 bg-white px-4 py-3">
                  <p className="font-semibold text-blue-950">
                    {game.awayAbbr} @ {game.homeAbbr}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatKickoffTime(game.commenceTime)}
                  </p>
                </td>
                {players.map((player) => {
                  const pick = player.sub
                    ? picksByPlayerAndGame.get(`${player.sub}:${game.id}`)
                    : undefined;

                  return (
                    <td
                      className="border border-slate-200 px-4 py-3"
                      key={`${game.id}-${player.displayName}`}
                    >
                      <span
                        className={`inline-block rounded px-2 py-1 text-sm font-semibold ${
                          pick
                            ? RESULT_STYLES[pick.result]
                            : 'bg-slate-50 text-slate-400'
                        }`}
                      >
                        {pickLabel(pick)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
