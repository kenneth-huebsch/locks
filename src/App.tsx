import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CurrentWeekResponse, Pick, WeekSummary } from '../shared/types';
import { loadPicksThroughWeek as defaultLoadPicksThroughWeek } from './api';
import { PicksBoard } from './components/PicksBoard';
import { WeekView } from './components/WeekView';
import { computePlayerRecordsById } from './lib/records';

export interface AppAuth {
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: Error;
  accessToken?: string;
  userSub?: string;
  signinRedirect: () => void | Promise<void>;
  logout: () => void | Promise<void>;
}

interface AppProps {
  auth: AppAuth;
  listWeeks: (accessToken: string) => Promise<WeekSummary[]>;
  loadWeek: (
    accessToken: string,
    season: number,
    week: number,
    userSub?: string,
  ) => Promise<CurrentWeekResponse>;
  loadPicksThroughWeek?: (season: number, throughWeek: number) => Pick[];
}

const REFRESH_INTERVAL_MS = 30_000;

function weekKey(season: number, week: number): string {
  return `${season}-${week}`;
}

function weekOptionLabel(summary: WeekSummary): string {
  return summary.isCurrent
    ? `Week ${summary.week} (current)`
    : `Week ${summary.week}`;
}

function weekDataMatchesSelection(
  weekData: CurrentWeekResponse | undefined,
  selectedWeek: WeekSummary | undefined,
): boolean {
  if (!weekData || !selectedWeek) {
    return false;
  }

  return (
    weekData.week.season === selectedWeek.season &&
    weekData.week.week === selectedWeek.week
  );
}

export function App({
  auth,
  listWeeks,
  loadWeek,
  loadPicksThroughWeek = defaultLoadPicksThroughWeek,
}: AppProps) {
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<WeekSummary>();
  const [weekData, setWeekData] = useState<CurrentWeekResponse>();
  const [loadError, setLoadError] = useState<string>();

  const refreshSelectedWeek = useCallback(async (): Promise<void> => {
    if (!auth.accessToken || !selectedWeek) {
      return;
    }

    try {
      const response = await loadWeek(
        auth.accessToken,
        selectedWeek.season,
        selectedWeek.week,
        auth.userSub,
      );
      setWeekData(response);
      setLoadError(undefined);
    } catch (error: unknown) {
      setWeekData(undefined);
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load week data',
      );
    }
  }, [auth.accessToken, auth.userSub, loadWeek, selectedWeek]);

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      void auth.signinRedirect();
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.signinRedirect]);

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.accessToken) {
      return;
    }

    let active = true;

    void listWeeks(auth.accessToken)
      .then((summaries) => {
        if (!active) {
          return;
        }

        setWeekSummaries(summaries);
        const current =
          summaries.find((summary) => summary.isCurrent) ?? summaries[0];
        setSelectedWeek(current);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Unable to load available weeks',
          );
        }
      });

    return () => {
      active = false;
    };
  }, [auth.accessToken, auth.isAuthenticated, listWeeks]);

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.accessToken || !selectedWeek) {
      return;
    }

    let active = true;

    void loadWeek(
      auth.accessToken,
      selectedWeek.season,
      selectedWeek.week,
      auth.userSub,
    )
      .then((response) => {
        if (active) {
          setWeekData(response);
          setLoadError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setWeekData(undefined);
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load week data',
          );
        }
      });

    function handleFocus() {
      void refreshSelectedWeek();
    }

    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(() => {
      void refreshSelectedWeek();
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [
    auth.accessToken,
    auth.isAuthenticated,
    auth.userSub,
    loadWeek,
    refreshSelectedWeek,
    selectedWeek,
  ]);

  const showingCurrentWeek = selectedWeek?.isCurrent ?? false;
  const playerRecords = useMemo(() => {
    if (!selectedWeek || showingCurrentWeek) {
      return undefined;
    }

    const cumulativePicks = loadPicksThroughWeek(
      selectedWeek.season,
      selectedWeek.week,
    );
    return computePlayerRecordsById(cumulativePicks);
  }, [loadPicksThroughWeek, selectedWeek, showingCurrentWeek]);

  if (auth.isLoading) {
    return <StatusPage message="Checking your session…" />;
  }

  if (auth.error) {
    return <StatusPage message={`Sign-in failed: ${auth.error.message}`} />;
  }

  if (!auth.isAuthenticated) {
    return <StatusPage message="Redirecting to sign in…" />;
  }

  const weekDataReady = weekDataMatchesSelection(weekData, selectedWeek);
  const readyWeekData = weekDataReady ? weekData : undefined;
  const currentWeekSummary = weekSummaries.find((summary) => summary.isCurrent);

  function handleLocksClick(): void {
    if (!currentWeekSummary) {
      return;
    }

    if (
      selectedWeek?.season === currentWeekSummary.season &&
      selectedWeek?.week === currentWeekSummary.week
    ) {
      void refreshSelectedWeek();
      return;
    }

    setSelectedWeek(currentWeekSummary);
    setWeekData(undefined);
    setLoadError(undefined);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-blue-950 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3 md:gap-4 md:px-6 md:py-5">
          <button
            className="shrink-0 text-xl font-black tracking-tight md:text-2xl"
            onClick={handleLocksClick}
            type="button"
          >
            Locks
          </button>
          <div className="flex shrink-0 items-center gap-2 md:gap-4">
            {weekSummaries.length > 0 ? (
              <div className="flex items-center">
                <select
                  aria-label="Weeks"
                  className="max-w-[9.5rem] truncate rounded bg-white px-2 py-1 text-xs font-semibold text-blue-950 sm:max-w-none sm:px-3 sm:py-1.5 sm:text-sm"
                  id="weeks-select"
                  onChange={(event) => {
                    const [season, week] = event.target.value
                      .split('-')
                      .map(Number);
                    const summary = weekSummaries.find(
                      (item) =>
                        item.season === season && item.week === week,
                    );
                    if (summary) {
                      setSelectedWeek(summary);
                      setWeekData(undefined);
                      setLoadError(undefined);
                    }
                  }}
                  value={
                    selectedWeek
                      ? weekKey(selectedWeek.season, selectedWeek.week)
                      : ''
                  }
                >
                  {weekSummaries.map((summary) => (
                    <option
                      key={weekKey(summary.season, summary.week)}
                      value={weekKey(summary.season, summary.week)}
                    >
                      {weekOptionLabel(summary)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <button
              className="shrink-0 whitespace-nowrap text-xs font-semibold underline underline-offset-4 sm:text-sm"
              onClick={() => void auth.logout()}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        {loadError ? (
          <p className="mb-8 border-l-4 border-red-700 bg-red-50 p-4 text-red-900">
            {loadError}
          </p>
        ) : null}

        {!readyWeekData || !selectedWeek ? (
          <p className="text-slate-600">Loading this week’s games…</p>
        ) : showingCurrentWeek && auth.userSub ? (
          <WeekView
            accessToken={auth.accessToken ?? ''}
            currentWeek={readyWeekData}
            onRefresh={refreshSelectedWeek}
            userSub={auth.userSub}
          />
        ) : !showingCurrentWeek && auth.userSub ? (
          <PicksBoard
            games={readyWeekData.games}
            picks={readyWeekData.picks ?? []}
            playerRecords={playerRecords}
            userSub={auth.userSub}
            weekNumber={selectedWeek.week}
          />
        ) : (
          <p className="text-slate-600">Loading player session…</p>
        )}
      </section>
    </main>
  );
}

function StatusPage({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <p className="text-slate-700">{message}</p>
    </main>
  );
}
