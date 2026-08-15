# AGENTS.md

This repository is the Locks NFL pick pool application — a serverless AWS app
with a React SPA, Lambda APIs, and DynamoDB storage.

## Required Reading

Before making any change, read the skill that matches your task:

| Task | Skill |
|---|---|
| Infrastructure, IAM, CDK, teardown | `.agent/skills/managing-locks-infrastructure/SKILL.md` |
| Feature development, UI, Lambda, shared types | `.agent/skills/developing-locks/SKILL.md` |
| Deploying to AWS (any stack or app publish) | `.agent/skills/deploying-locks/SKILL.md` |
| Seeding, odds, Cognito users, troubleshooting | `.agent/skills/operating-locks/SKILL.md` |

For a fast orientation to the live system, read
`.agent/skills/managing-locks-infrastructure/onboarding.md` first.

`README.md` is the human operations guide. `PLAN.md` is the product roadmap
with phase status. Both are authoritative for their scope.

## Repository Structure

```
src/                    React SPA (Vite, TypeScript, Tailwind)
  components/            UI components (GameCard, WeekView, PicksBoard, ConfirmPickModal)
  lib/                  Client utilities (players, time formatting)
  api.ts                API client for Lambda-backed endpoints
  runtime-config.ts     Loads same-origin runtime config from CloudFront
backend/
  functions/             Lambda handlers (current-week, submit-pick, sync-odds)
  lib/                  Backend utilities (odds-api-client, game-mapper)
shared/                  Types and logic shared between frontend and backend
  types.ts              API request/response types, domain models
  teams.ts              NFL team name/abbreviation mappings
  dynamo.ts             DynamoDB key patterns and helpers
  foundation.ts         Foundation fixture constants
  runtime-config.ts     Runtime config shape shared by build and client
infrastructure/
  bin/locks.ts          CDK app entrypoint
  lib/
    locks-app-stack.ts   Application stack (S3, CloudFront, Cognito, API Gateway, Lambda, DynamoDB)
    github-oidc-stack.ts Foundation stack (OIDC, deploy roles, IAM policies, permissions boundary)
  test/                 CDK assertion tests (IAM invariants, resource shape)
scripts/                Deploy, seed, verify, and config scripts
docs/                    Data model and handoff documents
.github/workflows/       GitHub Actions OIDC deployment (main → LocksAppStack only)
```

## Tech Stack

- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **Backend:** AWS Lambda (Node.js 22), API Gateway HTTP API, DynamoDB
- **Auth:** Amazon Cognito (invite-only, JWT authorizer on all API routes)
- **Infra:** AWS CDK in TypeScript, EventBridge Scheduler, SSM Parameter Store
- **CI:** GitHub Actions with OIDC (deploys only `LocksAppStack` from `main`)
- **Testing:** Vitest (unit/integration), CDK assertions (IAM invariants)

## Live System

| Item | Value |
|---|---|
| Application URL | https://locks.inov8.cc |
| CloudFront fallback | https://d141pq884g4gai.cloudfront.net |
| API Gateway | https://0blz753no0.execute-api.us-east-1.amazonaws.com |
| AWS account | `580956784928` |
| AWS region | `us-east-1` |
| Production branch | `main` |
| Cognito user pool | `us-east-1_yNKgsyVvF` |
| DynamoDB table | `locks` |
| Current users | `kenneth.huebsch@gmail.com` (Jack and Eric pending) |

## Hard Constraints

- **AWS account:** `580956784928`. **Region:** `us-east-1`. Always run the STS
  account guard before synthesis or any AWS mutation. Stop if it returns
  another account.
- **Never deploy, bootstrap, destroy, change credentials, or mutate GitHub/AWS
  without explicit user approval.**
- **Never leave the CDK bootstrap execution role on `AdministratorAccess`.**
- **GitHub Actions may deploy only `LocksAppStack`.** Foundation/OIDC changes
  are local, explicitly approved operations.
- **Never let the GitHub OIDC role assume the generic CDK bootstrap deploy role.**
- **Preserve the dedicated app deploy role, app CloudFormation execution role,
  and runtime permissions boundary.**
- **Do not add long-lived AWS credentials to GitHub.**
- **Do not create or change the Odds API parameter value until the user
  explicitly provides and approves that credential operation.**
- **Do not treat DynamoDB point-in-time recovery as permission to destroy
  production data.**
- **Do not commit, push, merge, publish, or open a PR unless explicitly
  requested.**
- **A push (or merge) to `main` is a production deploy.** `.github/workflows/deploy.yml`
  runs on every `main` push: lint, typecheck, test, build, synth, then
  `deploy:infrastructure` and `deploy:app` (S3 + CloudFront invalidation).
  Treat approval to commit/push to `main` as approval to ship live unless the
  user explicitly says otherwise. Prefer a PR when the user has not approved
  production impact. Local `deploy:*` commands still need separate explicit
  approval.

## Engineering Workflow

- Keep application resources in `LocksAppStack`.
- Change `LocksGitHubOidcStack` only for identity, deployment, execution-policy,
  or permissions-boundary requirements.
- Use tests first for behavior and IAM invariants.
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
  guarded `npm run synth` before completion.
- Inspect the CDK diff for replacements, deletions, public access, IAM
  broadening, and missing JWT authorization.
- Use the dedicated package scripts; do not deploy all CDK stacks with a broad
  command.
- See `.agent/skills/developing-locks/SKILL.md` for code conventions and
  testing patterns.

## How production gets deployed (read this before shipping)

| Path | What happens | Approval model |
|---|---|---|
| **Push/merge to `main`** | GitHub Actions workflow **Deploy** (`.github/workflows/deploy.yml`) automatically deploys **only** `LocksAppStack`: quality gates → `npm run deploy:infrastructure` → `npm run deploy:app` (publish SPA, seed foundation fixture, CloudFront invalidate). Live URL: https://locks.inov8.cc | User approval to land on `main` **is** production deploy approval. Do not claim "no deploy" after pushing `main`. |
| **Local `deploy:infrastructure` / `deploy:app`** | Same app stack / publish path run from an operator machine or Mira container | Separate explicit approval each time |
| **Local `deploy:oidc`** | Foundation IAM/OIDC only — **not** run by GitHub Actions | Always explicit approval; higher risk |

Implications for agents:

1. Direct commits to `main` ship to production within a few minutes if CI is green.
2. PRs do **not** deploy until merged to `main`.
3. Frontend-only and backend app-stack changes both ride the same `main` workflow.
4. Foundation/OIDC/IAM still never deploys from GitHub; those stay local + approved.
5. After a `main` push, check `gh run list --branch main` (workflow **Deploy**) and
   do not tell the user the site is undeployed if that run succeeded.
6. Details: `.agent/skills/deploying-locks/SKILL.md` and `deploy-flows.md`
   (Flow 0: GitHub Actions from `main`).

## Data and Destructive Operations

- The site bucket, Cognito pool, and DynamoDB table use destroy-oriented Phase
  1 policies. Teardown is destructive and must follow the order in
  `.agent/skills/managing-locks-infrastructure/runbooks.md`.
- A high-severity `brace-expansion` advisory is bundled inside the latest CDK
  tooling dependency. It is not shipped in the SPA or Lambda; update CDK when
  AWS releases a version containing the patched bundle.
