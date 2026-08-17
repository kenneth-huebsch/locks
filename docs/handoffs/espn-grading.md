<!-- Status: Ready for implementation. Do not start until the operator hands this off. -->
# Handoff: ESPN Scores for Grading

## Mission

Replace The Odds API **scores** path in `grade-games` with ESPN’s free
scoreboard API so Odds API credits are used only for spreads sync (~1 credit
per call). Matching Dynamo games by **team names**, not vendor event ids.

Also update `PLAN.md` open items: Phase 4 polish (mobile / empty states) is
**cancelled** — product looks fine; do not implement polish as part of this
handoff unless the operator reopens it.

Execution plan author shipped docs only on `main`. **This handoff is the
implementation work.**

## Read first

1. `AGENTS.md`
2. `PLAN.md` (Odds API free-tier strategy + Phase 4 ESPN bullet)
3. `.agent/skills/developing-locks/SKILL.md`
4. `.agent/skills/operating-locks/odds-management.md`
5. `.agent/skills/deploying-locks/SKILL.md` before any push to `main`

Live app: https://locks.inov8.cc  
AWS account: `580956784928` · region: `us-east-1`  
Push/merge to `main` = production Deploy workflow.

## Why the current grader cannot use ESPN as-is

[`backend/functions/grade-games.ts`](../../backend/functions/grade-games.ts):

1. Calls Odds API `/scores` (2 credits when `daysFrom` is set).
2. Finalizes games with `gameSortKey(score.eventId)` — Dynamo `GAME#` id must
   equal The Odds API event id.

Competition Week 2 was seeded with ids like `seed-2026-w02-game-N`. Odds and
ESPN event ids will never match those. Match ESPN finals to Dynamo rows by
`awayTeam` + `homeTeam` full names, then update by Dynamo `id`.

## Locked decisions

- **Scores source:** ESPN site API scoreboard (no API key, 0 Odds credits).
- **Spreads source:** unchanged — `sync-odds` + The Odds API.
- **Match key:** ESPN `team.displayName` ↔ Dynamo `awayTeam` / `homeTeam`
  (same strings as [`shared/teams.ts`](../../shared/teams.ts) `fullName`).
- **Fetch strategy:** load the competition week’s games from Dynamo, derive
  distinct kickoff calendar dates (`YYYYMMDD` from each `commenceTime`), GET
  scoreboard once per date. Do not rely on ESPN week number ≡ competition week
  (preseason week numbers diverge; W02 slate was ESPN preseason week 3).
- **Enable flag:** `GRADE_GAMES_ENABLED` (default `true`). Do **not** gate
  grading on `ODDS_API_ENABLED` or SSM Odds key after the switch.
- **No admin grading UI.** Unusual outcomes = operator DynamoDB update.
- **No Phase 4 mobile/empty-state polish** in this handoff.

## Implementation steps

### 1. ESPN client

Add [`backend/lib/espn-scoreboard-client.ts`](../../backend/lib/espn-scoreboard-client.ts)
(+ co-located tests):

- Base URL: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- Query: `dates=YYYYMMDD` (one date per request is fine).
- Parse events where the competition is final / `status.type.completed === true`.
- Return list of `{ awayTeam, homeTeam, awayScore, homeScore }` using competitor
  `homeAway` and `team.displayName`, scores from competitor `score`.
- Injectable `HttpClient` for tests (same pattern as odds client).
- Throw on non-OK HTTP so Scheduler can retry.

### 2. Rewire `grade-games`

Update [`backend/functions/grade-games.ts`](../../backend/functions/grade-games.ts)
(+ [`grade-games.test.ts`](../../backend/functions/grade-games.test.ts)):

1. Resolve active week (or `event.seasonWeek` override) — keep existing helper.
2. Query week games: `id`, `awayTeam`, `homeTeam`, `commenceTime`.
3. Fetch ESPN finals for those dates.
4. For each Dynamo game, find ESPN final with same away+home names; skip if none.
5. Finalize scores and grade pending picks using **Dynamo `game.id`** (not ESPN id).
6. Remove Odds scores fetch, SSM key load, and scores quota writes from this Lambda.
7. `isEnabled()` → `GRADE_GAMES_ENABLED !== 'false'`.
8. Keep structured result `{ status, seasonWeek, gamesFinalized, picksGraded, picksSkipped }`.
9. On operational failure, log and **throw** (Scheduler retry policy).

### 3. CDK

[`infrastructure/lib/locks-app-stack.ts`](../../infrastructure/lib/locks-app-stack.ts):

- Grade Lambda env: `GRADE_GAMES_ENABLED: 'true'`.
- Remove Odds-related env (`ODDS_API_ENABLED`, `ODDS_API_SPORT`) and
  `ssm:GetParameter` on `/locks/odds-api-key` from **GradeGames** role only.
- Leave SyncOdds Odds SSM + env unchanged.
- Update CDK assertion tests if they expect Grade SSM access.

### 4. Docs

- `PLAN.md`: ESPN grading open item; polish removed / cancelled.
- `.agent/skills/operating-locks/odds-management.md`: scores via ESPN; Odds
  credits for spreads only; grade kill switch = `GRADE_GAMES_ENABLED`.

### 5. Verify and ship

```bash
npm run lint
npm run typecheck
npm test
npm run build
# After account guard:
AWS_PROFILE=coding-agent npm run synth
AWS_PROFILE=coding-agent npm run cdk -- diff LocksAppStack --no-change-set
```

Expect Grade Lambda code + IAM/env narrowing; no foundation/OIDC changes.

With explicit operator approval to ship:

- Commit and push `main` (Deploy workflow).
- Optional smoke: `AWS_PROFILE=locks-publish npx tsx scripts/invoke-grade-games.ts 2026#W01`
  (idempotent on already-graded week) and/or current week once finals exist.

## Files to touch (expected)

| Path | Change |
|---|---|
| `backend/lib/espn-scoreboard-client.ts` | New |
| `backend/lib/espn-scoreboard-client.test.ts` | New |
| `backend/functions/grade-games.ts` | ESPN path; team-name match |
| `backend/functions/grade-games.test.ts` | Mock ESPN client |
| `infrastructure/lib/locks-app-stack.ts` | Grade env/IAM |
| `infrastructure/test/locks-app-stack.test.ts` | Assertions |
| `PLAN.md` | Open items / Phase 4 |
| `.agent/skills/operating-locks/odds-management.md` | Score source note |

## Non-goals

- Changing `sync-odds` or Odd spreads schedules.
- Storing ESPN event ids on game items.
- Mobile polish / empty states.
- Admin grading UI.
- Invoking Odds `/scores` as a fallback (operator can temporarily revert if needed).

## Done when

1. Scheduled `grade-games` uses ESPN only; no Odds scores credits.
2. Seeded and Odds-synced games both grade when ESPN shows final and names match.
3. Tests + synth/diff clean; deployed via `main` after operator approval.
4. `PLAN.md` no longer lists Phase 4 polish; ESPN grading marked complete after ship.
