# Agent Onboarding — Locks

Fast-start guide for any agent working on this repository.

## 1. Read These

1. `AGENTS.md` — hard constraints, repo structure, live system details
2. This file — orientation and health checks
3. The skill matching your task (see table in AGENTS.md)

## 2. What's Live

| Resource | Value |
|---|---|
| SPA | https://d141pq884g4gai.cloudfront.net |
| API Gateway | https://0blz753no0.execute-api.us-east-1.amazonaws.com |
| AWS account | `580956784928` |
| Region | `us-east-1` |
| DynamoDB table | `locks` |
| Cognito user pool | `us-east-1_6a7XXnD43` |
| GitHub deploy | OIDC from `main` → `LocksAppStack` only |

## 3. AWS Profiles (Container)

| Profile | Purpose | Identity |
|---|---|---|
| `coding-agent` | Read-only inspection, CDK deploy | `arn:aws:iam::580956784928:user/coding-agent` |
| `locks-publish` | Static publish, seed, CloudFront invalidation | Assumed role `LocksAppPublishRole` (1h session) |

## 4. Health Check Commands

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# Account guard (run before anything)
AWS_PROFILE=coding-agent aws sts get-caller-identity --query 'Account' --output text
# Must output: 580956784928

# SPA is serving
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/
# Must output: 200

# API is wired (401 = route exists, JWT authorizer active)
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/api/week/current
# Must output: 401

# App stack status
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksAppStack --query 'Stacks[0].StackStatus' --output text
# Must output: CREATE_COMPLETE or UPDATE_COMPLETE

# DynamoDB table exists
AWS_PROFILE=coding-agent aws dynamodb describe-table \
  --table-name locks --query 'Table.TableStatus' --output text 2>&1
# Must output: ACTIVE
```

## 5. Common First Tasks

- **Verify deployment:** `npx tsx scripts/verify-deployment.ts`
- **Run tests:** `npm test`
- **Lint + typecheck:** `npm run lint && npm run typecheck`
- **Synth CDK:** `npm run synth` (after account guard)
- **Deploy app stack:** See `.agent/skills/deploying-locks/SKILL.md`
- **Seed data:** See `.agent/skills/operating-locks/seeding.md`

## 6. Key Rules

- Never deploy without explicit user approval.
- Never deploy all stacks — use specific `deploy:oidc`, `deploy:infrastructure`, or `deploy:app`.
- Run the account guard before any AWS mutation.
- All API routes require Cognito JWT — expect 401 without a token.
- The DynamoDB table, Cognito pool, and site bucket have destroy removal policies.
