import { useMemo, useState } from 'react';
import type { CurrentWeekResponse } from '../../shared/types';
import type { SubmitPickRequest } from '../../shared/types';
import { submitPick as submitPickRequest } from '../api';
import { groupGamesByDay, formatOddsUpdatedAt } from '../lib/time';
import {
  ConfirmPickModal,
  type PickSummary,
} from './ConfirmPickModal';
import { GameCard, type PendingSelection } from './GameCard';

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
  const [selections, setSelections] = useState<Record<string, PendingSelection>>(
    {},
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

  const groupedGames = useMemo(
    () => groupGamesByDay((currentWeek.games ?? [])),
    [(currentWeek.games ?? [])],
  );

  const pendingSelections = useMemo<PickSummary[]>(() => {
    return Object.entries(selections).map(([gameId, selection]) => ({
      gameId,
      team: selection.team,
      spread: selection.spread,
    }));
  }, [selections]);

  function handlePick(gameId: string, team: string, spread: number) {
    setSelections((current) => {
      const isNewSelection = !current[gameId];
      const pendingCount = Object.keys(current).length;
      if (isNewSelection && pendingCount >= currentWeek.remainingPicks) {
        return current;
      }

      return {
        ...current,
        [gameId]: { team, spread },
      };
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
        await submitPickRequest(accessToken, request, apiBaseUrl);
        succeededGameIds.push(pick.gameId);
      } catch (error) {
        if (firstError === null) {
          firstError = error;
        }
      }
    }

    // Always remove successful picks from the selection state and refresh.
    if (succeededGameIds.length > 0) {
      setSelections((current) => {
        const next = { ...current };
        for (const gameId of succeededGameIds) {
          delete next[gameId];
        }
        return next;
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
            {currentWeek.week.season} season
          </p>
          <h2 className="mt-1 text-4xl font-black text-blue-950">
            Week {currentWeek.week.week}
          </h2>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Season record
          </p>
          <p className="text-2xl font-black text-blue-950">0-0-0</p>
          <p className="mt-2 text-sm text-slate-600">
            {currentWeek.remainingPicks} pick
            {currentWeek.remainingPicks === 1 ? '' : 's'} remaining
          </p>
        </div>
      </div>

      <p className="mt-6 border-l-4 border-amber-500 bg-amber-50 p-4 font-semibold text-amber-950">
        Picks are final once submitted — you cannot change them.
      </p>

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
                      selectedSide={selections[game.id]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pendingSelections.length > 0 ? (
        <div className="sticky bottom-0 mt-8 border-t border-slate-200 bg-slate-50 py-4">
          <button
            className="w-full bg-blue-950 px-5 py-3 font-bold text-white hover:bg-blue-800"
            onClick={() => setIsModalOpen(true)}
            type="button"
          >
            Submit {pendingSelections.length} pick
            {pendingSelections.length === 1 ? '' : 's'}
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
