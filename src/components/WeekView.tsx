import { useMemo, useState } from 'react';
import type { CurrentWeekResponse } from '../../shared/types';
import type { SubmitPickRequest } from '../../shared/types';
import { submitPick as submitPickRequest } from '../api';
import { groupGamesByDay, formatOddsUpdatedAt } from '../lib/time';
import {
  ConfirmPickModal,
  type PickSummary,
} from './ConfirmPickModal';
import { GameCard } from './GameCard';

interface PendingPick {
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
  const [pendingSelection, setPendingSelection] = useState<PendingPick | null>(
    null,
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  const playerPicks = useMemo(
    () => (currentWeek.picks ?? []).filter((pick) => pick.playerId === userSub),
    [currentWeek.picks ?? [], userSub],
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
  }, [currentWeek.picks ?? [], userSub]);

  const groupedGames = useMemo(
    () => groupGamesByDay((currentWeek.games ?? [])),
    [(currentWeek.games ?? [])],
  );

  const pendingSelections = useMemo<PickSummary[]>(() => {
    if (!pendingSelection) {
      return [];
    }
    return [
      {
        gameId: pendingSelection.gameId,
        team: pendingSelection.team,
        spread: pendingSelection.spread,
      },
    ];
  }, [pendingSelection]);

  function handlePick(gameId: string, team: string, spread: number) {
    setPendingSelection((current) => {
      if (current?.gameId === gameId && current.team === team) {
        return null;
      }

      if (current === null && currentWeek.remainingPicks === 0) {
        return null;
      }

      return { gameId, team, spread };
    });
  }

  async function handleSubmitPicks(picks: PickSummary[]) {
    const succeededGameIds: string[] = [];
    let firstError: unknown = null;

    for (const pick of picks) {
      const request: SubmitPickRequest = {
        gameId: pick.gameId,
        pickedTeam: pick.team,
        spreadAtPick: pick.spread,
      };

      try {
        await submitPickRequest(accessToken, request, apiBaseUrl, userSub);
        succeededGameIds.push(pick.gameId);
      } catch (error) {
        if (firstError === null) {
          firstError = error;
        }
      }
    }

    // Always remove successful picks from the selection state and refresh.
    if (succeededGameIds.length > 0) {
      setPendingSelection((current) => {
        if (current && succeededGameIds.includes(current.gameId)) {
          return null;
        }
        return current;
      });
      await onRefresh();
    }

    // Close modal only if everything succeeded. Otherwise keep it open
    // and rethrow the first error so the modal shows the right message.
    if (succeededGameIds.length === picks.length) {
      setIsModalOpen(false);
    } else if (firstError !== null) {
      throw firstError;
    }
  }

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
            {currentWeek.remainingPicks} pick
            {currentWeek.remainingPicks === 1 ? '' : 's'} remaining
          </p>
        </div>
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
                      onPick={handlePick}
                      revealedPicks={revealedPicksByGameId.get(game.id) ?? []}
                      selectedSide={
                        pendingSelection?.gameId === game.id
                          ? {
                              team: pendingSelection.team,
                              spread: pendingSelection.spread,
                            }
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pendingSelections.length > 0 ? (
        <div className="sticky bottom-0 mt-8 border-t border-slate-200 bg-slate-50 px-4 pb-safe pt-4 md:px-0">
          <button
            className="w-full bg-blue-950 px-5 py-3 font-bold text-white hover:bg-blue-800"
            onClick={() => setIsModalOpen(true)}
            type="button"
          >
            Submit pick
          </button>
        </div>
      ) : null}

      <ConfirmPickModal
        isOpen={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onSubmit={handleSubmitPicks}
        picks={pendingSelections}
      />
    </section>
  );
}
