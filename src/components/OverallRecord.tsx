import type {
  StandingsResponse,
  SurvivorPlayerStatus,
} from '../../shared/types';
import { formatPlayerRecord } from '../lib/records';
import { LEAGUE_ROSTER } from '../lib/players';

export interface OverallRecordProps {
  standings: StandingsResponse;
}

function survivorLabel(
  status: SurvivorPlayerStatus | null | undefined,
): string | null {
  if (status === 'alive' || status === 'winner') {
    return '🔥 Alive';
  }
  if (status === 'eliminated') {
    return '☠️ Dead';
  }
  return null;
}

export function OverallRecord({ standings }: OverallRecordProps) {
  const standingsByPlayer = new Map(
    standings.players.map((player) => [player.playerId, player]),
  );

  return (
    <section>
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
        {standings.season} season
      </p>
      <h2 className="mt-1 text-3xl font-black text-blue-950 md:text-4xl">
        Standings
      </h2>

      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {LEAGUE_ROSTER.map((player) => {
          const entry = standingsByPlayer.get(player.sub);
          const record = entry?.season ?? {
            wins: 0,
            losses: 0,
            pushes: 0,
          };
          const survivor = survivorLabel(entry?.survivorStatus);

          return (
            <li
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
              key={player.sub}
            >
              <img
                alt={player.displayName}
                className="aspect-square w-full object-cover"
                src={player.portraitUrl}
              />
              <div className="px-4 py-3 text-center">
                <h3 className="font-bold text-blue-950">{player.displayName}</h3>
                {survivor ? (
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      survivor.includes('Alive')
                        ? 'text-red-700'
                        : 'text-slate-600'
                    }`}
                    aria-label={`${player.displayName} survivor status`}
                  >
                    {survivor}
                  </p>
                ) : null}
                <p
                  className="mt-1 text-2xl font-black tabular-nums text-slate-800"
                  aria-label={`${player.displayName} overall record`}
                >
                  {formatPlayerRecord(record)}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                  W-L-P
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
