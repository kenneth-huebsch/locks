import { useEffect, useState } from 'react';
import type { CurrentWeekResponse } from '../shared/foundation';

export interface AppAuth {
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: Error;
  accessToken?: string;
  signinRedirect: () => void | Promise<void>;
  signoutRedirect: () => void | Promise<void>;
}

interface AppProps {
  auth: AppAuth;
  loadCurrentWeek: (accessToken: string) => Promise<CurrentWeekResponse>;
}

export function App({ auth, loadCurrentWeek }: AppProps) {
  const [currentWeek, setCurrentWeek] = useState<CurrentWeekResponse>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.accessToken) {
      return;
    }

    let active = true;
    loadCurrentWeek(auth.accessToken)
      .then((response) => {
        if (active) {
          setCurrentWeek(response);
          setLoadError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Unable to load the current week',
          );
        }
      });

    return () => {
      active = false;
    };
  }, [auth.accessToken, auth.isAuthenticated, loadCurrentWeek]);

  if (auth.isLoading) {
    return <StatusPage message="Checking your session…" />;
  }

  if (auth.error) {
    return <StatusPage message={`Sign-in failed: ${auth.error.message}`} />;
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6">
        <section className="w-full max-w-md border-t-4 border-blue-950 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
            NFL picks
          </p>
          <h1 className="mt-2 text-5xl font-black tracking-tight text-blue-950">
            Locks
          </h1>
          <p className="mt-4 leading-7 text-slate-600">
            Sign in with your invited account to view this week’s game.
          </p>
          <button
            className="mt-8 w-full bg-blue-950 px-5 py-3 font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            onClick={() => void auth.signinRedirect()}
            type="button"
          >
            Sign in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-blue-950 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <h1 className="text-2xl font-black tracking-tight">Locks</h1>
          <button
            className="text-sm font-semibold underline underline-offset-4"
            onClick={() => void auth.signoutRedirect()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
          2026 season
        </p>
        <h2 className="mt-1 text-4xl font-black text-blue-950">
          {currentWeek ? `Week ${currentWeek.week}` : 'This week'}
        </h2>
        {loadError ? (
          <p className="mt-8 border-l-4 border-red-700 bg-red-50 p-4 text-red-900">
            {loadError}
          </p>
        ) : !currentWeek ? (
          <p className="mt-8 text-slate-600">Loading this week’s games…</p>
        ) : currentWeek.games.length === 0 ? (
          <p className="mt-8 text-slate-600">No games are scheduled.</p>
        ) : (
          <ul className="mt-8 grid gap-4">
            {currentWeek.games.map((game) => (
              <li
                className="border border-slate-200 bg-white p-6 shadow-sm"
                key={game.id}
              >
                <p className="text-sm font-semibold text-slate-500">
                  {new Date(game.commenceTime).toLocaleString()}
                </p>
                <div className="mt-3 grid gap-1 text-xl font-bold text-blue-950">
                  <span>{game.awayTeam}</span>
                  <span className="text-sm font-normal uppercase tracking-wider text-slate-400">
                    at
                  </span>
                  <span>{game.homeTeam}</span>
                </div>
              </li>
            ))}
          </ul>
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
