# Locks Codebase Guide

Detailed map of how the pieces fit together.

## Frontend (src/)

### Entry Flow
```
index.html → src/main.tsx → src/App.tsx → components/
```

`main.tsx` renders `App` into `#root`. `App` handles auth state, loads runtime
config, and renders either the login flow or `WeekView`.

### Runtime Config
`src/runtime-config.ts` fetches `/runtime-config.json` (same-origin via
CloudFront). This file is generated at deploy time by
`scripts/deploy-app.ts` and contains the API endpoint, Cognito user pool ID,
client ID, and authority URL.

### API Client
`src/api.ts` contains all HTTP calls to the API Gateway. Components never call
`fetch` directly. Add new endpoints here.

### Components
| Component | Purpose |
|---|---|
| `App.tsx` | Auth gate, loads WeekView when authenticated |
| `WeekView.tsx` | Main page: game cards + picks board + remaining picks |
| `GameCard.tsx` | Single game display with pick selection |
| `ConfirmPickModal.tsx | Confirmation dialog before locking picks |
| `PicksBoard.tsx` | Shows all players' submitted picks |

### Utilities
- `src/lib/players.ts` — Player display helpers
- `src/lib/time.ts` — Eastern Time formatting

## Backend (backend/)

### Lambda Functions

Each function is a Node.js Lambda bundled by CDK's `NodejsFunction`.

| Function | Route | Method | Purpose |
|---|---|---|---|
| `current-week.ts` | `/api/week/current` | GET | Returns current week's games and all picks |
| `submit-pick.ts` | `/api/picks` | POST | Atomic pick submission with validation |
| `sync-odds.ts` | (scheduled) | — | Fetches odds from The Odds API, caches in DynamoDB |

### Handler Structure
Each handler:
1. Parses the API Gateway event (JWT claims, path params, body)
2. Reads/writes DynamoDB via `@aws-sdk/lib-dynamodb`
3. Returns a typed response or error

### Backend Libraries
- `backend/lib/odds-api-client.ts` — The Odds API client with quota tracking
- `backend/lib/odds-api-types.ts` — Odds API response types
- `backend/lib/game-mapper.ts` — Maps Odds API events to Game models

## Shared (shared/)

| File | Purpose |
|---|---|
| `types.ts` | All domain types: Game, Pick, Player, Week, API request/response shapes |
| `teams.ts` | NFL team name ↔ abbreviation mapping |
| `dynamo.ts` | DynamoDB partition/sort key patterns and helpers |
| `foundation.ts` | Foundation fixture constants (seeded Week 1 game) |
| `runtime-config.ts` | Runtime config type shared by build scripts and SPA |

### DynamoDB Key Patterns (shared/dynamo.ts)

All DynamoDB key construction goes through `shared/dynamo.ts`. Key patterns:

- **Active season:** `ACTIVE_SEASON_PARTITION_KEY` / `ACTIVE_SEASON_SORT_KEY`
- **Week:** `weekPartitionKey(season, week)` / `WEEK_META_SORT_KEY`
- **Game:** `weekPartitionKey(...)` / `gameSortKey(gameId)`
- **Player:** `playerPartitionKey(sub)` / various
- **Pick:** `playerPartitionKey(sub)` / `pickSortKey(seasonWeek, gameId)`
- **Pick GSI1:** `pickGsi1PartitionKey(seasonWeek)` / `pickGsi1SortKey(playerId, gameId)`
- **Quota:** `QUOTA_PARTITION_KEY` / timestamp sort key
- **Counter:** `weekPartitionKey(...)` / `counterSortKey(playerId)`

Never inline key construction. Always use or add helpers in `dynamo.ts`.

## Infrastructure (infrastructure/)

### Stacks

- `LocksGitHubOidcStack` — Foundation: OIDC, deploy roles, IAM policies, permissions boundary
- `LocksAppStack` — Application: S3, CloudFront, Cognito, API Gateway, Lambda, DynamoDB, EventBridge

### CDK App Entry
`infrastructure/bin/locks.ts` creates both stacks targeting account
`580956784928` in `us-east-1`.

### API Gateway
HTTP API (`aws-cdk-lib/aws-apigatewayv2`) with JWT authorizer backed by
Cognito. Routes are added via `httpApi.addRoutes()` in `locks-app-stack.ts`.

### CloudFront
S3 origin for the SPA. `/api/*` path pattern proxies to the API Gateway.
A CloudFront function (`SpaRewrite`) handles SPA routing.

## Scripts (scripts/)

| Script | Purpose |
|---|---|
| `deploy-app.ts` | Builds SPA, syncs S3, writes runtime-config, seeds, invalidates CloudFront |
| `seed-foundation.ts` | Seeds the canonical Week 1 foundation game |
| `seed-active-week.ts` | Seeds active week metadata + fake game slate |
| `seed-week.ts` | Seeds a fake game slate for a specific week |
| `verify-deployment.ts` | Post-deploy verification (curl probes, stack outputs) |
| `synth.sh` | Wrapper for CDK synth |
| `aws-context.ts` | AWS context helpers |
| `runtime-config.ts` | Runtime config generation |
| `deployment-order.ts` | Deployment order validation |
| `npm-command.ts` | NPM command helpers |

## GitHub Actions (.github/workflows/deploy.yml)

Triggers on push to `main`. Uses OIDC to assume `LocksGitHubDeployRole`
with the id-qualified subject
`repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main`
(see `GITHUB_SUBJECT` in `infrastructure/lib/github-oidc-stack.ts`).
Runs lint, typecheck, test, build, synth, then deploys `LocksAppStack` and
publishes the app. Cannot deploy foundation/OIDC changes — those need local
`deploy:oidc` after explicit approval.
