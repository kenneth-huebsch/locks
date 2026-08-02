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

function teamLabel(team: string, abbr: string): string {
  return `${team} (${abbr})`;
}

function spreadLabel(abbr: string, spread: number): string {
  return `${abbr} ${formatSpread(spread)}`;
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
    <article className="border border-slate-200 bg-white p-6 shadow-sm">
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
          disabled={!selectable}
          isLocked={Boolean(lockedAway)}
          isSelected={awaySelected}
          label={teamLabel(game.awayTeam, game.awayAbbr)}
          lockedSpread={lockedAway ? existingPick?.spreadAtPick : undefined}
          onSelect={() => onPick(game.id, game.awayTeam, game.awaySpread)}
          spread={spreadLabel(game.awayAbbr, game.awaySpread)}
        />
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          at
        </p>
        <SideButton
          disabled={!selectable}
          isLocked={Boolean(lockedHome)}
          isSelected={homeSelected}
          label={teamLabel(game.homeTeam, game.homeAbbr)}
          lockedSpread={lockedHome ? existingPick?.spreadAtPick : undefined}
          onSelect={() => onPick(game.id, game.homeTeam, game.homeSpread)}
          spread={spreadLabel(game.homeAbbr, game.homeSpread)}
        />
      </div>
    </article>
  );
}

interface SideButtonProps {
  label: string;
  spread: string;
  disabled: boolean;
  isSelected: boolean;
  isLocked: boolean;
  lockedSpread?: number;
  onSelect: () => void;
}

function SideButton({
  label,
  spread,
  disabled,
  isSelected,
  isLocked,
  lockedSpread,
  onSelect,
}: SideButtonProps) {
  const stateClass = isLocked
    ? 'border-blue-950 bg-blue-50'
    : isSelected
      ? 'border-blue-700 bg-blue-100'
      : disabled
        ? 'border-slate-200 bg-slate-50 text-slate-400'
        : 'border-slate-200 bg-white hover:border-blue-700';

  return (
    <button
      className={`w-full border px-4 py-3 text-left transition-colors ${stateClass} ${
        disabled && !isLocked ? 'cursor-not-allowed' : ''
      }`}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-blue-950">{label}</p>
          <p className="mt-1 text-sm text-slate-600">
            {isLocked && lockedSpread !== undefined
              ? `${spread.split(' ')[0]} ${formatSpread(lockedSpread)}`
              : spread}
          </p>
        </div>
        {isLocked ? (
          <span aria-label="Locked pick" className="text-blue-950" title="Locked">
            🔒
          </span>
        ) : null}
      </div>
    </button>
  );
}
