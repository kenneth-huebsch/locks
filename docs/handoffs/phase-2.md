<!-- Status: Phase 2 complete for preseason; Eric invite deferred; DraftKings locked. -->
# Phase 2 Handoff: Picks and Odds

## Mission

Implement Phase 2 from `PLAN.md`: replace the manually seeded foundation flow
with cached NFL spreads and immutable, atomic pick submission while preserving
the deployed Phase 1 security and operations model.

Phase 1 is complete on `main` and deployed at
https://d141pq884g4gai.cloudfront.net in AWS account `580956784928`,
`us-east-1`.

## Read first

1. `AGENTS.md`
2. `PLAN.md`
3. `README.md`
4. `.agent/skills/managing-locks-infrastructure/SKILL.md`
5. The skill's `architecture.md` and `runbooks.md` before any AWS or CDK work

The CDK source is the infrastructure source of truth. Do not weaken the
separated foundation/application deployment identities, app execution role, or
runtime permissions boundary.

## Inputs still required from the user

Do not guess these values:

1. Free-tier Odds API key.
2. Jack and Eric's Cognito email addresses.
3. Preferred sportsbook. DraftKings is the current recommendation.
4. Whether the real launch target is 2026 Week 1 or an earlier test window.

Changing the Odds API key or creating its Parameter Store value is a credential
operation and requires explicit approval. Never put the key in source, prompts,
logs, GitHub, Lambda environment variables, or browser configuration.

## Locked product rules

- Three competitors: Kenny, Jack, and Eric.
- Each player may submit at most three picks per week.
- Picks may be submitted incrementally.
- A player may pick a game only once.
- A pick stores `picked_team` and `spread_at_pick`.
- Each game locks independently at `commence_time`.
- Submitted picks are immediately visible to all authenticated players.
- Submitted picks cannot be edited or deleted.
- The API must reject a stale team/spread pair that does not match the current
  cached game.
- Grading and standings remain Phase 3; Phase 2 pick results stay `pending`.

## Current implementation

### Data and API

- DynamoDB table: `locks`, keys `PK` and `SK`, pay-per-request, AWS-managed
  encryption, PITR enabled, `RemovalPolicy.DESTROY`.
- `shared/foundation.ts` defines a hard-coded 2026 Week 1 game.
- `backend/functions/current-week.ts` queries one hard-coded week partition and
  returns games only.
- `scripts/seed-foundation.ts` idempotently writes the dummy game.
- API Gateway exposes only authenticated `GET /api/week/current`.
- CloudFront's `/api/*` behavior currently allows only GET, HEAD, and OPTIONS.
  Phase 2 must permit POST before `POST /api/picks` can work.

### Infrastructure

- `LocksAppStack` owns app resources and uses `LocksAppDeployRole` plus
  `LocksAppCloudFormationExecutionRole`.
- Every app-created runtime role receives `LocksAppRuntimeBoundary`.
- The runtime boundary currently allows table reads, exact odds-parameter read,
  site cleanup, and Locks Lambda logs. Add only the exact DynamoDB writes needed
  by new functions.
- EventBridge Scheduler group `locks` exists but has no schedules.
- `FutureScheduledFunctionRole` exists with basic Lambda logging and
  `ssm:GetParameter` for `/locks/odds-api-key`.
- The SSM parameter value does not exist.
- Cognito currently provisions only `kenneth.huebsch@gmail.com`.

### Frontend and deployment

- Cognito managed login uses Authorization Code + PKCE.
- Runtime configuration is output-driven and served from
  `/runtime-config.json`.
- `scripts/deploy-app.ts` uploads immutable assets, then mutable files, then
  removes stale objects; preserve this order.
- `.github/workflows/deploy.yml` deploys only `LocksAppStack` from `main`.
- Foundation/OIDC changes are local and require explicit approval.

## Required design work before implementation

Create `docs/data-model.md` before changing persistent records. It must define:

- Exact PK/SK patterns for players, active season/week, games, picks, weekly
  pick counters, cached odds metadata, and quota-usage records.
- Any GSIs and the query they serve.
- DynamoDB attribute types and ISO UTC timestamp format.
- Transaction boundaries and conditional expressions.
- TTL only for short-lived API-usage diagnostics, not picks or games.
- Migration/replacement behavior for the existing foundation game item.

Define the authenticated player mapping. Prefer stable Cognito `sub` as the
player identifier, with email/display name as attributes. Do not authorize
players by a browser-supplied player ID.

## Recommended implementation sequence

### 1. Shared contracts and data model

- Write `docs/data-model.md`.
- Add shared game, spread, player, pick, week, quota, and API response types.
- Add canonical NFL team-name/abbreviation mappings with tests.
- Remove foundation-only constants only when all consumers have migrated.

### 2. Odds API boundary

- Build one shared server-side Odds API client.
- Permit only the NFL events, spreads, and later scores endpoints required by
  the plan.
- Use region `us`, market `spreads`, and one bulk request for the slate.
- Capture request cost and remaining-credit response headers.
- Fail closed below the 50-credit reserve.
- Honor `ODDS_API_ENABLED=false` without calling the vendor.
- Never fetch odds per game or from the browser.
- Use injected HTTP and clock dependencies so quota, malformed responses,
  disabled mode, and reserve behavior are deterministic in tests.

### 3. Odds synchronization

- Create a dedicated `sync-odds` Lambda and least-privilege role.
- Read the key from `/locks/odds-api-key` at runtime.
- Upsert games and spreads without modifying locked picks.
- Store the bookmaker and last successful update timestamp.
- Record metered quota usage with diagnostic TTL.
- Add conservative EventBridge schedules from the plan, disabled outside the
  NFL season.
- Keep schedules disabled until the user approves the real key and launch
  window.

### 4. Atomic pick submission

Implement `POST /api/picks` using a DynamoDB transaction that:

1. Condition-checks the cached game still exists, has not started, and matches
   the submitted team and spread.
2. Conditionally inserts one pick per player/game.
3. Conditionally increments the player's weekly count only while below three.

Use server time, the authenticated Cognito identity, and the cached game item.
Do not trust browser timestamps, player IDs, or calculated spreads. Return
structured conflict errors for started games, stale lines, duplicate picks,
and the weekly limit. Do not add update or delete routes.

### 5. Current-week API and UI

- Return games, odds update time, the authenticated player's remaining count,
  and every submitted pick for the week.
- Add game groups and selectable sides.
- Disable started games.
- Show the final-pick warning and confirmation modal.
- Display submitted picks as locked and read-only.
- Refresh after submission, on window focus, and at a short interval.
- Keep all API traffic same-origin through CloudFront.

### 6. Accounts, deployment, and verification

- Add Jack and Eric only after their emails are supplied.
- Run lint, typecheck, tests, build, guarded synth, and targeted
  `LocksAppStack` diff.
- Inspect replacements, IAM changes, schedule state, API authorization, table
  access, and CloudFront POST behavior before deployment.
- Obtain explicit approval before SSM, Cognito, AWS, or GitHub mutations.
- Deploy foundation permissions first only when the app stack depends on them.
- Verify the site, login, cached slate, last-updated time, atomic limits,
  duplicate/stale/deadline rejection, immediate shared visibility, quota
  records, circuit breaker, and disabled schedules.

## Acceptance criteria

- Browser page loads consume zero Odds API credits.
- One bulk sync populates the week's games and spreads.
- Odds quota usage and remaining credits are persisted.
- No vendor call occurs when disabled or below reserve.
- Started games cannot be selected or submitted.
- A stale spread submission is rejected.
- The fourth weekly pick is rejected under concurrent requests.
- Duplicate player/game submissions produce one stored pick.
- Stored picks preserve the spread at submission permanently.
- Every authenticated player sees submitted picks promptly.
- No player-facing update/delete path exists.
- All routes remain JWT protected.
- Runtime roles remain boundary-constrained and least privilege.
- Grading remains out of scope and pick results remain pending.

## Verification commands

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build

$Profile = "kenneth.huebsch@gmail.com"
$Account = aws sts get-caller-identity --profile $Profile --query Account --output text
if ($Account -ne "580956784928") { throw "Wrong AWS account: $Account" }
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = "us-east-1"
$env:AWS_DEFAULT_REGION = "us-east-1"

npm run synth
npm run cdk -- diff LocksAppStack
```

Do not deploy merely because checks pass. Remote mutation still requires
explicit approval.

## Known constraints

- No AWS Budget exists; spending is monitored manually.
- The latest CDK package currently bundles a high-severity `brace-expansion`
  advisory in deployment tooling. It is not shipped to the SPA or Lambda.
- Historical 2025 picks, grading, standings, badges, survivor, and office pools
  remain outside Phase 2.
- Do not import historical data or add backward compatibility unless requested.
