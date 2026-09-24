import { useMemo, useState } from 'react';
import type { CurrentWeekResponse } from '../../shared/types';
import {
  submitPick as submitPickRequest,
  submitSurvivorPick as submitSurvivorPickRequest,
} from '../api';
import { groupGamesByDay, formatOddsUpdatedAt } from '../lib/time';
import {
  ConfirmPickModal,
  type ConfirmMode,
  type PickSummary,
} from './ConfirmPickModal';
import { GameCard } from './GameCard';
import { LEAGUE_ROSTER } from '../lib/players';

interface PendingSelection {
  gameId: string;
  team: string;
  spread: number;
}

export interface WeekViewProps {
  currentWeek: CurrentWeekResponse;
  userSub: string;
  accessToken: string;
  apiBaseUrl?: string;
  onRefresh: () => Promise<void>;
}

export function WeekView({
  currentWeek,
  userSub,
  accessToken,
  apiBaseUrl = '/api',
  onRefresh,
}: WeekViewProps) {
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(
    null,
  );
  const [confirmMode, setConfirmMode] = useState<ConfirmMode | null>(null);

  const survivor = currentWeek.survivor ?? {
    challengeStatus: 'active' as const,
    winners: [],
    myStatus: null,
    usedTeams: [],
    canPick: false,
    picks: [],
  };

  const playerPicks = useMemo(
    () => (currentWeek.picks ?? []).filter((pick) => pick.playerId === userSub),
    [currentWeek.picks, userSub],
  );

  const picksByGameId = useMemo(() => {
    const map = new Map<string, (typeof playerPicks)[number]>();
    for (const pick of playerPicks) {
      map.set(pick.gameId, pick);
    }
    return map;
  }, [playerPicks]);

  const revealedPicksByGameId = useMemo(() => {
    const map = new Map<string, typeof currentWeek.picks>();
    for (const pick of currentWeek.picks ?? []) {
      if (pick.playerId === userSub) {
        continue;
      }
      const existing = map.get(pick.gameId) ?? [];
      existing.push(pick);
      map.set(pick.gameId, existing);
    }
    return map;
  }, [currentWeek.picks, userSub]);

  const survivorPicksByGameId = useMemo(() => {
    const map = new Map<string, typeof survivor.picks>();
    for (const pick of survivor.picks) {
      const existing = map.get(pick.gameId) ?? [];
      existing.push(pick);
      map.set(pick.gameId, existing);
    }
    return map;
  }, [survivor.picks]);

  const mySurvivorPick = useMemo(
    () => survivor.picks.find((pick) => pick.playerId === userSub),
    [survivor.picks, userSub],
  );

  const groupedGames = useMemo(
    () => groupGamesByDay(currentWeek.games ?? []),
    [currentWeek.games],
  );

  const canLock = currentWeek.remainingPicks > 0;
  const canSurvive = survivor.canPick;
  const showLockForSelection =
    canLock &&
    pendingSelection !== null &&
    !picksByGameId.has(pendingSelection.gameId);
  const showSurviveForSelection =
    canSurvive &&
    pendingSelection !== null &&
    !survivor.usedTeams.includes(pendingSelection.team);

  const pendingSummaries = useMemo<PickSummary[]>(() => {
    if (!pendingSelection || !confirmMode) {
      return [];
    }
    return [
      {
        gameId: pendingSelection.gameId,
        team: pendingSelection.team,
        spread: pendingSelection.spread,
      },
    ];
  }, [pendingSelection, confirmMode]);

  function handleTeamSelect(gameId: string, team: string, spread: number) {
    setPendingSelection((current) => {
      if (current?.gameId === gameId && current.team === team) {
        return null;
      }
      return { gameId, team, spread };
    });
    setConfirmMode(null);
  }

  async function handleConfirm(picks: PickSummary[]) {
    const pick = picks[0];
    if (!pick || !confirmMode) {
      return;
    }

    if (confirmMode === 'lock') {
      await submitPickRequest(
        accessToken,
        {
          gameId: pick.gameId,
          pickedTeam: pick.team,
          spreadAtPick: pick.spread,
        },
        apiBaseUrl,
        userSub,
      );
    } else {
      await submitSurvivorPickRequest(
        accessToken,
        { gameId: pick.gameId, pickedTeam: pick.team },
        apiBaseUrl,
      );
    }

    setPendingSelection(null);
    setConfirmMode(null);
    await onRefresh();
  }

  const survivorStatusLabel = (() => {
    if (survivor.challengeStatus === 'complete') {
      const names = survivor.winners
        .map(
          (sub) =>
            LEAGUE_ROSTER.find((player) => player.sub === sub)?.displayName ??
            'Winner',
        )
        .join(', ');
      return names ? `Survivor winners: ${names}` : 'Survivor complete';
    }
    if (survivor.myStatus === 'eliminated') {
      return `Eliminated from survivor${
        survivor.picks.length ? '' : ''
      }`;
    }
    if (survivor.myStatus === 'winner') {
      return 'You won survivor';
    }
    if (survivor.myStatus === 'alive') {
      return mySurvivorPick
        ? `Survivor pick: ${mySurvivorPick.pickedTeam}`
        : 'Survivor: pick required';
    }
    return null;
  })();

  return (
    <section>
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
          {currentWeek.week.season} season
        </p>
        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-4">
          <h2 className="text-3xl font-black text-blue-950 md:text-4xl">
            Week {currentWeek.week.week}
          </h2>
          <p className="text-sm text-slate-600 sm:text-base">
            {currentWeek.remainingPicks} lock
            {currentWeek.remainingPicks === 1 ? '' : 's'} remaining
            {canSurvive ? ' · survivor open' : ''}
          </p>
        </div>
        {survivorStatusLabel ? (
          <p className="mt-2 text-sm font-medium text-slate-700">
            {survivorStatusLabel}
          </p>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-slate-600">
        {currentWeek.oddsUpdatedAt
          ? `Lines last updated ${formatOddsUpdatedAt(currentWeek.oddsUpdatedAt)}`
          : 'Lines not yet available'}
      </p>

      {(currentWeek.games ?? []).length === 0 ? (
        <p className="mt-8 text-slate-600">No games are scheduled.</p>
      ) : (
        <div className="mt-8 space-y-10">
          {groupedGames.map(({ group, games }) => (
            <section key={group}>
              <h3 className="text-lg font-black uppercase tracking-wide text-blue-950">
                {group}
              </h3>
              <ul className="mt-4 grid gap-4">
                {games.map((game) => (
                  <li key={game.id}>
                    <GameCard
                      existingPick={picksByGameId.get(game.id)}
                      game={game}
                      mySurvivorTeam={
                        mySurvivorPick?.gameId === game.id
                          ? mySurvivorPick.pickedTeam
                          : undefined
                      }
                      onTeamSelect={handleTeamSelect}
                      revealedPicks={revealedPicksByGameId.get(game.id) ?? []}
                      revealedSurvivorPicks={
                        survivorPicksByGameId.get(game.id) ?? []
                      }
                      selectedSide={
                        pendingSelection?.gameId === game.id
                          ? {
                              team: pendingSelection.team,
                              spread: pendingSelection.spread,
                            }
                          : undefined
                      }
                      usedTeams={survivor.usedTeams}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-10 text-sm text-slate-500">
        Lines update Tue 2:00 AM, Thu 5:00 PM, Sun 8:00 AM / 12:30 PM / 3:30 PM
        / 7:30 PM, and Mon 5:00 PM ET.
      </p>

      {pendingSelection && (showLockForSelection || showSurviveForSelection) ? (
        <div className="sticky bottom-0 mt-8 border-t border-slate-200 bg-slate-50 px-4 pb-safe pt-4 md:px-0">
          <p className="mb-3 text-sm text-slate-600">
            {pendingSelection.team}
          </p>
          <div className="flex gap-3">
            {showLockForSelection ? (
              <button
                className="flex-1 bg-blue-950 px-5 py-3 font-bold text-white hover:bg-blue-800"
                onClick={() => setConfirmMode('lock')}
                type="button"
              >
                🔒 Lock
              </button>
            ) : null}
            {showSurviveForSelection ? (
              <button
                className="flex-1 border-2 border-red-700 bg-white px-5 py-3 font-bold text-red-700 hover:bg-red-50"
                onClick={() => setConfirmMode('survive')}
                type="button"
              >
                🔥 Survive
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmPickModal
        isOpen={confirmMode !== null && pendingSummaries.length > 0}
        mode={confirmMode ?? 'lock'}
        onCancel={() => setConfirmMode(null)}
        onSubmit={handleConfirm}
        picks={pendingSummaries}
      />
    </section>
  );
}
