import type { Pick } from '../../shared/types';
import { getTeamByName } from '../../shared/teams';
import { formatSpread } from '../lib/time';

export const RESULT_STYLES: Record<Pick['result'], string> = {
  pending: 'bg-slate-100 text-slate-700',
  win: 'bg-green-100 text-green-900',
  loss: 'bg-red-100 text-red-900',
  push: 'bg-yellow-100 text-yellow-900',
};

export function pickChipLabel(pick: Pick): string {
  const team = getTeamByName(pick.pickedTeam);
  const abbr = team?.abbreviation ?? pick.pickedTeam;
  return `${abbr} ${formatSpread(pick.spreadAtPick)}`;
}

export function PickResultChip({ pick }: { pick: Pick }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${RESULT_STYLES[pick.result]}`}
    >
      {pickChipLabel(pick)}
    </span>
  );
}
