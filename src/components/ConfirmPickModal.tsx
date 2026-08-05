import { useState } from 'react';
import { ApiError } from '../api';
import { ErrorCodes } from '../../shared/types';
import { formatSpread } from '../lib/time';

export interface PickSummary {
  gameId: string;
  team: string;
  spread: number;
}

export interface ConfirmPickModalProps {
  picks: PickSummary[];
  isOpen: boolean;
  onCancel: () => void;
  onSubmit: (picks: PickSummary[]) => Promise<void>;
}

const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCodes.STALE_LINES]: 'Odds have changed — please refresh',
  [ErrorCodes.GAME_STARTED]: 'This game has already started',
  [ErrorCodes.DUPLICATE_PICK]: 'You already picked this game',
  [ErrorCodes.WEEKLY_LIMIT]: 'You have reached the three-pick weekly limit',
};

export function ConfirmPickModal({
  picks,
  isOpen,
  onCancel,
  onSubmit,
}: ConfirmPickModalProps) {
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) {
    return null;
  }

  async function handleConfirm() {
    setError(undefined);
    setIsSubmitting(true);

    try {
      await onSubmit(picks);
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setError(ERROR_MESSAGES[submitError.code] ?? submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError('Unable to submit pick');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 md:items-center md:px-6">
      <div
        aria-labelledby="confirm-picks-title"
        aria-modal="true"
        className="w-full max-w-lg border-t-4 border-blue-950 bg-white px-4 pt-4 pb-safe shadow-lg md:rounded-none md:p-8"
        role="dialog"
      >
        <h2
          className="text-xl font-black text-blue-950 md:text-2xl"
          id="confirm-picks-title"
        >
          Confirm pick
        </h2>
        <p className="mt-2 text-sm text-slate-600 md:mt-3 md:text-base">
          This cannot be undone. Lock in this pick?
        </p>

        <ul className="mt-4 space-y-2 md:mt-6 md:space-y-3">
          {picks.map((pick) => (
            <li
              className="border border-slate-200 bg-slate-50 px-4 py-3"
              key={pick.gameId}
            >
              <span className="font-semibold text-blue-950">{pick.team}</span>
              <span className="ml-2 text-slate-600">
                {formatSpread(pick.spread)}
              </span>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="mt-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex gap-3 md:mt-8">
          <button
            className="flex-1 border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex-1 bg-blue-950 px-4 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void handleConfirm()}
            type="button"
          >
            {isSubmitting ? 'Submitting…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
