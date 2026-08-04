# Skill: Deploying Locks

Use when deploying any part of the Locks application to AWS. Covers pre-deploy
checks, the three deployment flows, post-deploy verification, and rollback.

## When to Use

- Deploying the OIDC/foundation stack (`deploy:oidc`)
- Deploying the application infrastructure (`deploy:infrastructure`)
- Publishing the SPA and seeding (`deploy:app`)
- Verifying a deployment is healthy
- Rolling back a bad deployment

## When NOT to Use

- Writing application code → `.agent/skills/developing-locks/SKILL.md`
- Infrastructure/IAM changes (that's CDK authoring, not deploying) → `.agent/skills/managing-locks-infrastructure/SKILL.md`
- Seeding or odds management without deploying → `.agent/skills/operating-locks/SKILL.md`

## AWS Profiles

| Profile | Purpose | Command prefix |
|---|---|---|
| `coding-agent` | CDK deploy (assumes deploy role) | `AWS_PROFILE=coding-agent` |
| `locks-publish` | Static publish + seed (assumes publish role) | `AWS_PROFILE=locks-publish` |

## Pre-Deploy Checklist

Always run these before any deployment:

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# 1. Account guard
account="$(AWS_PROFILE=coding-agent aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account: $account" >&2; exit 1; }

# 2. Code quality
npm run lint
npm run typecheck
npm test
npm run build

# 3. CDK synth (validates templates)
AWS_PROFILE=coding-agent npm run synth

# 4. Review the diff (see deploy-flows.md for per-stack diffs)
AWS_PROFILE=coding-agent npm run cdk -- diff <StackName>
```

Never deploy if any check fails. Never deploy all stacks with a broad command.

## Deployment Flows

See `deploy-flows.md` for detailed instructions for each flow:

| Flow | Command | When |
|---|---|---|
| Foundation/OIDC | `AWS_PROFILE=coding-agent npm run deploy:oidc` | IAM, roles, policies, boundary changes |
| App infrastructure | `AWS_PROFILE=coding-agent npm run deploy:infrastructure` | New Lambda, API routes, DynamoDB, Cognito |
| App publish + seed | `AWS_PROFILE=locks-publish npm run deploy:app` | SPA changes, static assets, runtime config, seed |

**Typical app update:** `deploy:infrastructure` then `deploy:app`
**SPA-only update:** `deploy:app` alone
**IAM/foundation change:** `deploy:oidc` (requires explicit approval)

## Post-Deploy Verification

See `verification.md` for the full checklist. Quick version:

```bash
# SPA serving
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/
# Expect: 200

# API route exists (401 = JWT authorizer active)
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/api/week/current
# Expect: 401

# Stack status
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksAppStack --query 'Stacks[0].StackStatus' --output text
# Expect: CREATE_COMPLETE or UPDATE_COMPLETE

# Full verification script
npx tsx scripts/verify-deployment.ts
```

## Rollback

See `rollback.md` for procedures. Quick summary:

1. **Git revert + redeploy:** Revert the commit that caused the issue, push to
   `main` (GitHub Actions redeploys `LocksAppStack`), or manually redeploy.
2. **CDK rollback:** `AWS_PROFILE=coding-agent npm run cdk -- rollback <StackName>`
   rolls back to the previous CloudFormation stack version.

Never force a rollback without understanding what changed. Check the diff first.

## Hard Rules

- **Explicit approval required** for any deployment. Never deploy without it.
- **Account guard is mandatory** before any mutation.
- **Never use `cdk deploy --all`.** Always specify the exact stack.
- **GitHub Actions deploys only `LocksAppStack`.** Foundation changes are local.
- **`deploy:oidc` changes IAM.** Review the diff for privilege escalation.
