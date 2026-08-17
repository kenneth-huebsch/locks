<!-- Status: Shipped to production (main Deploy). Historical handoff. -->
# Handoff: ESPN Scores for Grading

## Outcome

**Done.** `grade-games` uses ESPN’s free scoreboard API. The Odds API is
spreads-only (`sync-odds`). Matching Dynamo games by **team names**, not vendor
event ids. Deployed via `main`; smoke-tested `2026#W01` (idempotent) and active
Week 2 (no finals yet → zero finalize).

Phase 4 mobile / empty-state polish remains **cancelled**.

## As-built (for operators)

- **Scores:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD`
- **Match key:** ESPN `team.displayName` ↔ Dynamo `awayTeam` / `homeTeam`
- **Fetch:** distinct kickoff calendar dates from week games (not ESPN week #)
- **Kill switch:** `GRADE_GAMES_ENABLED` (default `true`); not gated on Odds SSM
- **Manual:** `AWS_PROFILE=locks-publish npx tsx scripts/invoke-grade-games.ts [seasonWeek]`

## Original mission (archived)

Replace The Odds API **scores** path so Odds credits are used only for spreads
sync (~1 credit per call). Implementation steps, file list, and non-goals are
below for archaeology; do not re-execute unless reverting.

### Implementation steps (completed)

1. ESPN client — `backend/lib/espn-scoreboard-client.ts` (+ tests)
2. Rewire `grade-games` — team-name match, Dynamo `id`, no Odds scores/quota
3. CDK — Grade env `GRADE_GAMES_ENABLED`; remove Grade Odds SSM/`ODDS_*`
4. Docs — `PLAN.md`, odds-management, architecture, data-model, skills

### Non-goals (still true)

- Changing `sync-odds` or Odds spreads schedules
- Storing ESPN event ids on game items
- Mobile polish / empty states
- Admin grading UI
- Odds `/scores` fallback
