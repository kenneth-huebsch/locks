import type { Game, Pick } from '../../shared/types';
import {
  formatKickoffTime,
  formatSpread,
  hasGameStarted,
} from '../lib/time';

export interface PendingSelection {
  team: string;
  spread: number;
}

export interface GameCardProps {
  game: Game;
  existingPick?: Pick;
  selectedSide?: PendingSelection;
  onPick: (gameId: string, team: string, spread: number) => void;
  now?: Date;
}

function accessibleTeamLabel(team: string, abbr: string): string {
  return `${team} (${abbr})`;
}

function accessiblePickLabel(team: string, abbr: string, spread: number): string {
  return `${accessibleTeamLabel(team, abbr)} ${formatSpread(spread)}`;
}

function matchesTeam(
  team: string,
  abbr: string,
  pickedTeam: string,
): boolean {
  return pickedTeam === team || pickedTeam === abbr;
}

export function GameCard({
  game,
  existingPick,
  selectedSide,
  onPick,
  now = new Date(),
}: GameCardProps) {
  const started = hasGameStarted(game.commenceTime, now);
  const locked = Boolean(existingPick);
  const selectable = !started && !locked && game.status === 'scheduled';

  const statusLabel =
    game.status === 'final'
      ? 'Final'
      : started || game.status === 'in_progress'
        ? 'Game in progress'
        : null;

  const awaySelected =
    selectedSide?.team === game.awayTeam ||
    selectedSide?.team === game.awayAbbr;
  const homeSelected =
    selectedSide?.team === game.homeTeam ||
    selectedSide?.team === game.homeAbbr;

  const lockedAway =
    existingPick &&
    matchesTeam(game.awayTeam, game.awayAbbr, existingPick.pickedTeam);
  const lockedHome =
    existingPick &&
    matchesTeam(game.homeTeam, game.homeAbbr, existingPick.pickedTeam);

  return (
    <article className="border border-slate-200 bg-white p-4 shadow-sm md:p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold text-slate-500">
          {formatKickoffTime(game.commenceTime)}
        </p>
        {statusLabel ? (
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {statusLabel}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        <SideButton
          abbr={game.awayAbbr}
          disabled={!selectable}
          isLocked={Boolean(lockedAway)}
          isSelected={awaySelected}
          lockedSpread={lockedAway ? existingPick?.spreadAtPick : undefined}
          onSelect={() => onPick(game.id, game.awayTeam, game.awaySpread)}
          spread={game.awaySpread}
          teamName={game.awayTeam}
        />
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          at
        </p>
        <SideButton
          abbr={game.homeAbbr}
          disabled={!selectable}
          isLocked={Boolean(lockedHome)}
          isSelected={homeSelected}
          lockedSpread={lockedHome ? existingPick?.spreadAtPick : undefined}
          onSelect={() => onPick(game.id, game.homeTeam, game.homeSpread)}
          spread={game.homeSpread}
          teamName={game.homeTeam}
        />
      </div>
    </article>
  );
}

interface SideButtonProps {
  teamName: string;
  abbr: string;
  spread: number;
  disabled: boolean;
  isSelected: boolean;
  isLocked: boolean;
  lockedSpread?: number;
  onSelect: () => void;
}

function SideButton({
  teamName,
  abbr,
  spread,
  disabled,
  isSelected,
  isLocked,
  lockedSpread,
  onSelect,
}: SideButtonProps) {
  const displaySpread = lockedSpread ?? spread;
  const spreadText = `${abbr} ${formatSpread(displaySpread)}`;

  const stateClass = isLocked
    ? 'border-blue-950 bg-blue-50'
    : isSelected
      ? 'border-blue-700 bg-blue-100'
      : disabled
        ? 'border-slate-200 bg-slate-50 text-slate-400'
        : 'border-slate-200 bg-white hover:border-blue-700';

  return (
    <button
      aria-label={accessiblePickLabel(teamName, abbr, displaySpread)}
      className={`w-full border px-3 py-2.5 text-left transition-colors md:px-4 md:py-3 ${stateClass} ${
        disabled && !isLocked ? 'cursor-not-allowed' : ''
      }`}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-blue-950 md:hidden">{spreadText}</p>
          <p className="truncate text-xs text-slate-500 md:hidden">{teamName}</p>
          <p className="hidden font-bold text-blue-950 md:block">
            {accessibleTeamLabel(teamName, abbr)}
          </p>
          <p className="mt-1 hidden text-sm text-slate-600 md:block">
            {spreadText}
          </p>
        </div>
        {isLocked ? (
          <span
            aria-label="Locked pick"
            className="shrink-0 text-blue-950"
            title="Locked"
          >
            🔒
          </span>
        ) : null}
      </div>
    </button>
  );
}
