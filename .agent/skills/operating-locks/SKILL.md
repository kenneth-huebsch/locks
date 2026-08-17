# Skill: Operating Locks

Use for day-to-day operations: seeding data, managing Cognito users, managing
the Odds API, troubleshooting issues, and monitoring system health.

## When to Use

- Seeding or resetting game data
- Creating or managing Cognito users (Jack, Eric)
- Managing the Odds API key, spreads sync, or ESPN grading schedules
- Debugging API errors, stale CloudFront, or Lambda failures
- Checking AWS billing or usage metrics

## When NOT to Use

- Deploying code changes → `.agent/skills/deploying-locks/SKILL.md`
- Writing application code → `.agent/skills/developing-locks/SKILL.md`
- Infrastructure/IAM changes → `.agent/skills/managing-locks-infrastructure/SKILL.md`

## Operations Routing

| Task | Guide |
|---|---|
| Seed game data | `seeding.md` |
| Manage Odds API key, spreads schedules, grading | `odds-management.md` |
| Manual grade / week advance | `odds-management.md` (`invoke-grade-games.ts`, `invoke-advance-week.ts`) |
| Create/manage Cognito users | `cognito-users.md` |
| Debug API, CloudFront, or Lambda issues | `troubleshooting.md` |
| Check billing, logs, or metrics | `monitoring.md` |

## Live URLs

| Surface | URL |
|---|---|
| Application | https://locks.inov8.cc |
| CloudFront fallback | https://d141pq884g4gai.cloudfront.net |

Prefer the custom domain for health checks and operator smoke tests.

## AWS Profiles

| Profile | Purpose |
|---|---|
| `coding-agent` | Read-only: DynamoDB scans/queries, Lambda logs, CloudWatch |
| `locks-publish` | Mutations: seeding, CloudFront invalidation |

## Hard Rules

- **Never delete the DynamoDB table.** It has a destroy removal policy.
- **Never change the Odds API key without explicit user approval.**
- **Never disable Cognito user accounts without explicit approval.**
- **Never mutate AWS resources without explicit approval.**
- **Read-only operations** (list, scan, query, describe) are generally safe.
  Mutations (create, update, delete, put, seed) require explicit approval.
