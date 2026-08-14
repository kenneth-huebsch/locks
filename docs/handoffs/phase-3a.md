<!-- Status: Phase 3a backend grading foundation; CDK schedule wiring deferred. -->
# Phase 3a Handoff: Score Fetch and ATS Grading Core

## Mission

Add the backend grading foundation: pure ATS math, Odds API scores client
support, and a `grade-games` Lambda that writes final scores and pending-only
pick results. No standings API, no frontend, and no EventBridge schedule wiring
in this slice (Phase 3b).

## Locked product decisions

- Preseason is a dry run for regular season. Use the same ATS math on completed
  games from the configured `ODDS_API_SPORT` key (currently preseason).
- Grade only picks where `result` is `pending`. Do not re-grade terminal
  results. Do not design for post-final score corrections.
- Current-week selection remains `SEASON#ACTIVE`. Document only: competition
  week starts Tuesday 02:00 America/New_York. Do not implement auto-advance.
- Do not write aggregate standings items.
- Pick-submission immutability is unchanged (no update/delete of pick identity).

## What landed

| Piece | Location |
|---|---|
| ATS helper | `shared/grading.ts` — `gradeAgainstTheSpread` |
| Scores client | `backend/lib/odds-api-client.ts` — `fetchNflScores` |
| Scores types | `backend/lib/odds-api-types.ts` |
| Grading Lambda | `backend/functions/grade-games.ts` |
| Season-week parse helper | `shared/dynamo.ts` — `parseSeasonWeekToken` |

### Write boundaries

1. Scores fetch is metered (2 credits with `daysFrom`). Quota rows are written
   like `sync-odds` under `QUOTA#ODDS_API` with a 30-day TTL.
2. For each completed Odds event that matches a game in the active week
   partition by vendor event id:
   - Separate `UpdateItem` sets `awayScore`, `homeScore`, and `status = final`.
   - Separate conditional `UpdateItem` sets pick `result` only when currently
     `pending`.
3. Incomplete / in-progress / missing scores are skipped; picks stay `pending`.
4. Optional invoke payload `{ "seasonWeek": "2026#W01" }` overrides
   `SEASON#ACTIVE` for manual runs.

### `daysFrom` choice

`ODDS_API_SCORES_DAYS_FROM = 3` (vendor maximum). One bulk scores call covers
TNF through Monday finals for the planned grading windows without extra
metered requests.

## Out of scope (later phases)

- CDK `NodejsFunction`, IAM, and EventBridge schedule for `grade-games`
- Standings HTTP API and Dynamo aggregate items
- Historical picks board / UI result rendering
- Admin grading overrides
- Automatic Tuesday 02:00 ET week rollover

## Verification

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

Do not commit, push, deploy, or open a PR from this phase unless the parent
explicitly requests it.
