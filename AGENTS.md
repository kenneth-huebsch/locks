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
| Application URL | https://d141pq884g4gai.cloudfront.net |
| API Gateway | https://0blz753no0.execute-api.us-east-1.amazonaws.com |
| AWS account | `580956784928` |
| AWS region | `us-east-1` |
| Production branch | `main` |
| Cognito user pool | `us-east-1_6a7XXnD43` |
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

## Data and Destructive Operations

- The site bucket, Cognito pool, and DynamoDB table use destroy-oriented Phase
  1 policies. Teardown is destructive and must follow the order in
  `.agent/skills/managing-locks-infrastructure/runbooks.md`.
- A high-severity `brace-expansion` advisory is bundled inside the latest CDK
  tooling dependency. It is not shipped in the SPA or Lambda; update CDK when
  AWS releases a version containing the patched bundle.
