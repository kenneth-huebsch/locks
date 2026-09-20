import type { Game, Pick, SurvivorPick } from '../../shared/types';
import { LEAGUE_ROSTER } from '../lib/players';
import { finalScoreLabel } from '../lib/game';
import {
  formatKickoffTime,
  formatSpread,
  hasGameStarted,
} from '../lib/time';
import { PickResultChip, RESULT_STYLES } from './PickResultChip';

export interface PendingSelection {
  team: string;
  spread: number;
}

export interface GameCardProps {
  game: Game;
  existingPick?: Pick;
  revealedPicks?: Pick[];
  revealedSurvivorPicks?: SurvivorPick[];
  selectedSide?: PendingSelection;
  usedTeams?: string[];
  mySurvivorTeam?: string;
  onTeamSelect: (gameId: string, team: string, spread: number) => void;
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

function lockedSideResultClass(result: Pick['result'] | undefined): string {
  if (!result || result === 'pending') {
    return 'border-blue-950 bg-blue-50';
  }

  if (result === 'win') {
    return 'border-green-700 bg-green-50';
  }

  if (result === 'loss') {
    return 'border-red-700 bg-red-50';
  }

  return 'border-yellow-600 bg-yellow-50';
}

export function GameCard({
  game,
  existingPick,
  revealedPicks = [],
  revealedSurvivorPicks = [],
  selectedSide,
  usedTeams = [],
  mySurvivorTeam,
  onTeamSelect,
  now = new Date(),
}: GameCardProps) {
  const started = hasGameStarted(game.commenceTime, now);
  const selectable = !started && game.status === 'scheduled';
  const scoreLabel = finalScoreLabel(game);

  const statusLabel = scoreLabel
    ? scoreLabel
    : game.status === 'final'
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

  const survivorAway =
    mySurvivorTeam &&
    matchesTeam(game.awayTeam, game.awayAbbr, mySurvivorTeam);
  const survivorHome =
    mySurvivorTeam &&
    matchesTeam(game.homeTeam, game.homeAbbr, mySurvivorTeam);

  const rosterPicks = LEAGUE_ROSTER.flatMap((player) => {
    const pick = revealedPicks.find((entry) => entry.playerId === player.sub);
    if (!pick) {
      return [];
    }
    return [{ player, pick, kind: 'lock' as const }];
  });

  const rosterSurvivor = LEAGUE_ROSTER.flatMap((player) => {
    const pick = revealedSurvivorPicks.find(
      (entry) => entry.playerId === player.sub,
    );
    if (!pick) {
      return [];
    }
    return [{ player, pick, kind: 'survive' as const }];
  });

  return (
    <article className="border border-slate-200 bg-white p-4 shadow-sm md:p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold text-slate-500">
          {formatKickoffTime(game.commenceTime)}
        </p>
        {statusLabel ? (
          <p
            className={`text-sm font-semibold uppercase tracking-wide ${
              scoreLabel ? 'text-blue-950' : 'text-slate-500'
            }`}
          >
            {statusLabel}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        <SideButton
          abbr={game.awayAbbr}
          currentSpread={game.awaySpread}
          disabled={!selectable}
          isLocked={Boolean(lockedAway)}
          isSelected={awaySelected}
          isSurvivor={Boolean(survivorAway)}
          isUsed={usedTeams.includes(game.awayTeam)}
          lockedSpread={lockedAway ? existingPick?.spreadAtPick : undefined}
          onSelect={() => onTeamSelect(game.id, game.awayTeam, game.awaySpread)}
          result={lockedAway ? existingPick?.result : undefined}
          teamName={game.awayTeam}
        />
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          at
        </p>
        <SideButton
          abbr={game.homeAbbr}
          currentSpread={game.homeSpread}
          disabled={!selectable}
          isLocked={Boolean(lockedHome)}
          isSelected={homeSelected}
          isSurvivor={Boolean(survivorHome)}
          isUsed={usedTeams.includes(game.homeTeam)}
          lockedSpread={lockedHome ? existingPick?.spreadAtPick : undefined}
          onSelect={() => onTeamSelect(game.id, game.homeTeam, game.homeSpread)}
          result={lockedHome ? existingPick?.result : undefined}
          teamName={game.homeTeam}
        />
      </div>

      {rosterPicks.length > 0 || rosterSurvivor.length > 0 ? (
        <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3" aria-label="Revealed picks">
          {rosterPicks.map(({ player, pick }) => (
            <li
              className="flex items-center justify-between gap-2 text-sm"
              key={`lock-${player.sub}`}
            >
              <span className="text-slate-600">{player.displayName}</span>
              <PickResultChip pick={pick} />
            </li>
          ))}
          {rosterSurvivor.map(({ player, pick }) => (
            <li
              className="flex items-center justify-between gap-2 text-sm"
              key={`survive-${player.sub}`}
            >
              <span className="text-slate-600">{player.displayName} · survive</span>
              <span className="font-semibold text-blue-950">
                {pick.pickedTeam}
                {pick.result !== 'pending' ? ` · ${pick.result}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

interface SideButtonProps {
  teamName: string;
  abbr: string;
  currentSpread: number;
  disabled: boolean;
  isSelected: boolean;
  isLocked: boolean;
  isSurvivor: boolean;
  isUsed: boolean;
  lockedSpread?: number;
  result?: Pick['result'];
  onSelect: () => void;
}

function SideButton({
  teamName,
  abbr,
  currentSpread,
  disabled,
  isSelected,
  isLocked,
  isSurvivor,
  isUsed,
  lockedSpread,
  result,
  onSelect,
}: SideButtonProps) {
  const displaySpread = lockedSpread ?? currentSpread;
  const spreadMoved =
    isLocked &&
    lockedSpread !== undefined &&
    lockedSpread !== currentSpread;
  const spreadText = `${abbr} ${formatSpread(displaySpread)}`;
  const currentSpreadText = `${abbr} ${formatSpread(currentSpread)}`;

  const stateClass = isLocked || isSurvivor
    ? lockedSideResultClass(result)
    : isSelected
      ? 'border-blue-700 bg-blue-100'
      : disabled
        ? 'border-slate-200 bg-slate-50 text-slate-400'
        : 'border-slate-200 bg-white hover:border-blue-700';

  return (
    <button
      aria-label={accessiblePickLabel(teamName, abbr, displaySpread)}
      className={`w-full border px-3 py-2.5 text-left transition-colors md:px-4 md:py-3 ${stateClass} ${
        disabled && !isLocked && !isSurvivor ? 'cursor-not-allowed' : ''
      }`}
      disabled={disabled && !isLocked && !isSurvivor}
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
            {isLocked ? `Locked ${spreadText}` : spreadText}
          </p>
          {spreadMoved ? (
            <p className="mt-1 text-xs text-slate-500">
              Now {currentSpreadText}
            </p>
          ) : null}
          {isLocked && result && result !== 'pending' ? (
            <p
              className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${RESULT_STYLES[result]}`}
            >
              {result}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isUsed && !isSurvivor ? (
            <span
              aria-label="Already used in survivor"
              className="text-slate-500"
              title="Used in survivor"
            >
              ✕
            </span>
          ) : null}
          {isSurvivor ? (
            <span aria-label="Survivor pick" title="Survive">
              🔥
            </span>
          ) : null}
          {isLocked ? (
            <span aria-label="Locked pick" className="text-blue-950" title="Locked">
              🔒
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
