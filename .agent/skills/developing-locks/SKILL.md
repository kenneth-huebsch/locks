# Skill: Developing Locks

Use when adding features, fixing bugs, or modifying application code in the
Locks repository. Covers codebase structure, conventions, and testing.

## When to Use

- Adding or modifying React components
- Adding or modifying Lambda handlers
- Changing shared types or DynamoDB key patterns
- Adding API routes
- Frontend or backend bug fixes

## When NOT to Use

- Infrastructure/IAM/CDK changes → `.agent/skills/managing-locks-infrastructure/SKILL.md`
- Deploying to AWS → `.agent/skills/deploying-locks/SKILL.md`
- Seeding, odds management, Cognito users → `.agent/skills/operating-locks/SKILL.md`

## Codebase Map

See `codebase-guide.md` for the detailed map. Quick summary:

- `src/` — React SPA. Entry: `main.tsx` → `App.tsx`. Components in `src/components/`.
- `backend/functions/` — Lambda handlers. Each has a co-located `.test.ts`.
- `backend/lib/` — Backend utilities (odds API client, game mapper).
- `shared/` — Types and logic imported by both frontend and backend.
- `infrastructure/lib/` — CDK stacks that define all AWS resources.

## Conventions

- **TypeScript everywhere.** Strict mode. No `any` without justification.
- **Shared types live in `shared/types.ts`.** Frontend and backend import from
  `shared/`. Never duplicate type definitions.
- **Tests are co-located.** `foo.ts` → `foo.test.ts` in the same directory.
- **Vitest is the test runner.** Config in `vitest.config.ts`.
- **DynamoDB key patterns live in `shared/dynamo.ts`.** Never inline key
  construction in handlers. Add or use helpers there.
- **Lambda handlers import from `../../shared/` and `../lib/`.** Keep handlers
  thin — business logic goes in `backend/lib/` or `shared/`.
- **Frontend components import from `../api`, `../../shared/`, and `../lib/`.**
  Keep API calls in `src/api.ts`.
- **No secrets in code.** The Odds API key lives in SSM Parameter Store. Lambda
  reads it at runtime via `GetParameterCommand`.

## Before Completing Work

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For infrastructure changes, also run `npm run synth` after the account guard.

## Adding a New Feature

See `adding-a-feature.md` for the step-by-step guide covering new Lambda
functions, API routes, CDK wiring, shared types, and frontend components.

## Testing Guide

See `testing-guide.md` for patterns, what to test per layer, and how to run
targeted tests.
