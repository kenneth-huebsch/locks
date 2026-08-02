import { useCallback, useEffect, useState } from 'react';
import type { CurrentWeekResponse } from '../shared/types';
import { PicksBoard } from './components/PicksBoard';
import { WeekView } from './components/WeekView';

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
  loadCurrentWeek: (accessToken: string) => Promise<CurrentWeekResponse>;
}

type AppTab = 'week' | 'board';

const REFRESH_INTERVAL_MS = 30_000;

export function App({ auth, loadCurrentWeek }: AppProps) {
  const [currentWeek, setCurrentWeek] = useState<CurrentWeekResponse>();
  const [loadError, setLoadError] = useState<string>();
  const [activeTab, setActiveTab] = useState<AppTab>('week');

  const refreshCurrentWeek = useCallback(async (): Promise<void> => {
    if (!auth.accessToken) {
      return;
    }

    const response = await loadCurrentWeek(auth.accessToken);
    setCurrentWeek(response);
    setLoadError(undefined);
  }, [auth.accessToken, loadCurrentWeek]);

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

    void refreshCurrentWeek().catch((error: unknown) => {
      if (active) {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load the current week',
        );
      }
    });

    function handleFocus() {
      void refreshCurrentWeek().catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Unable to load the current week',
          );
        }
      });
    }

    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(() => {
      void refreshCurrentWeek().catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Unable to load the current week',
          );
        }
      });
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [auth.accessToken, auth.isAuthenticated, refreshCurrentWeek]);

  if (auth.isLoading) {
    return <StatusPage message="Checking your session…" />;
  }

  if (auth.error) {
    return <StatusPage message={`Sign-in failed: ${auth.error.message}`} />;
  }

  if (!auth.isAuthenticated) {
    return <StatusPage message="Redirecting to sign in…" />;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-blue-950 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <h1 className="text-2xl font-black tracking-tight">Locks</h1>
          <button
            className="text-sm font-semibold underline underline-offset-4"
            onClick={() => void auth.logout()}
            type="button"
          >
            Sign out
          </button>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-2 px-6 pb-4">
          <TabButton
            isActive={activeTab === 'week'}
            label="This Week"
            onClick={() => setActiveTab('week')}
          />
          <TabButton
            isActive={activeTab === 'board'}
            label="Picks Board"
            onClick={() => setActiveTab('board')}
          />
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        {loadError ? (
          <p className="mb-8 border-l-4 border-red-700 bg-red-50 p-4 text-red-900">
            {loadError}
          </p>
        ) : null}

        {!currentWeek ? (
          <p className="text-slate-600">Loading this week’s games…</p>
        ) : activeTab === 'week' && auth.userSub ? (
          <WeekView
            accessToken={auth.accessToken ?? ''}
            currentWeek={currentWeek}
            onRefresh={refreshCurrentWeek}
            userSub={auth.userSub}
          />
        ) : activeTab === 'board' && auth.userSub ? (
          <PicksBoard
            games={currentWeek.games}
            picks={currentWeek.picks}
            userSub={auth.userSub}
          />
        ) : (
          <p className="text-slate-600">Loading player session…</p>
        )}
      </section>
    </main>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded px-4 py-2 text-sm font-semibold ${
        isActive
          ? 'bg-white text-blue-950'
          : 'bg-blue-900 text-white hover:bg-blue-800'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function StatusPage({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <p className="text-slate-700">{message}</p>
    </main>
  );
}
