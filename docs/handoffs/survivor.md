# Handoff: Survivor challenge

## What shipped

Parallel survivor mode alongside ATS locks:

- `POST /api/survivor/picks` (JWT)
- `CurrentWeekResponse.survivor` on week APIs
- Straight-up grading + elimination in `grade-games`
- Immediate Web Push on survivor submit; Sunday noon ET incomplete survivor reminder
- Week UI: team tap → **Lock** / **Survive** actions; used-team icon

## Ops before first use

1. Deploy `LocksAppStack` (CI from `main` or approved local deploy).
2. Seed challenge rows: `npm run seed:survivor`
3. Confirm `GET /api/week/current` includes `survivor.canPick: true` for alive players.

## Verify

- Submit a survivor pick; other devices get a push.
- Used team shows ✕ on the week slate.
- After finals, loss/tie eliminates; sole survivor completes the challenge.
- Sunday noon ET reminder when alive without a survivor pick.

## Key files

- `shared/survivor.ts`, `shared/dynamo.ts`, `shared/types.ts`
- `backend/functions/submit-survivor-pick.ts`, `notify-survivor-pick.ts`
- `backend/functions/grade-games.ts`, `remind-incomplete.ts`, `current-week.ts`
- `src/components/WeekView.tsx`, `GameCard.tsx`, `ConfirmPickModal.tsx`
- `scripts/seed-survivor.ts`
