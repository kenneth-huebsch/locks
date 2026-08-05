# Skill: Deploying Locks

Use when deploying any part of the Locks application to AWS. Covers pre-deploy
checks, the three deployment flows, post-deploy verification, and rollback.

## When to Use

- Understanding how a `main` push reaches production (default path)
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

## Default production path: push to `main`

**This is how almost all app changes go live.**

| Trigger | Workflow | Effect |
|---|---|---|
| `git push` / merge to branch `main` | `.github/workflows/deploy.yml` (**Deploy**) | Assumes `LocksGitHubDeployRole` via OIDC → account assert → lint/typecheck/test/build/synth → `deploy:infrastructure` → `deploy:app` |

- Scope: **`LocksAppStack` only** (not OIDC/foundation).
- Concurrency group `locks-production` (no cancel-in-progress).
- Live app: https://d141pq884g4gai.cloudfront.net
- Agent rule: if you pushed `main` and Deploy succeeded, production **was**
  updated. Do not tell the user a separate deploy step is still required.
- Check runs: `gh run list --repo kenneth-huebsch/locks --branch main --workflow Deploy --limit 5`
- User approval to land on `main` counts as deploy approval for this path.
  Still get explicit approval before local `deploy:*` or any `deploy:oidc`.

## Deployment Flows

See `deploy-flows.md` for detailed instructions for each flow:

| Flow | Command / trigger | When |
|---|---|---|
| **0. GitHub Actions (default)** | Push/merge to `main` | Normal app + SPA production updates |
| Foundation/OIDC | `AWS_PROFILE=coding-agent npm run deploy:oidc` | IAM, roles, policies, boundary changes (local only) |
| App infrastructure | `AWS_PROFILE=coding-agent npm run deploy:infrastructure` | Manual/local app stack deploy |
| App publish + seed | `AWS_PROFILE=locks-publish npm run deploy:app` | Manual/local SPA publish |

**Typical app update:** push to `main` (CI runs infrastructure + app publish)
**Manual SPA-only update:** `deploy:app` alone (explicit approval)
**IAM/foundation change:** `deploy:oidc` (explicit approval; never via GitHub)

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
  For the default path, approval to **push/merge `main`** is that approval.
  Local `deploy:*` and all `deploy:oidc` still need their own explicit approval.
- **Account guard is mandatory** before any local mutation.
- **Never use `cdk deploy --all`.** Always specify the exact stack.
- **GitHub Actions deploys only `LocksAppStack`.** Foundation changes are local.
- **`deploy:oidc` changes IAM.** Review the diff for privilege escalation.
- **OIDC trust uses the id-qualified main `sub`**, not classic `owner/name`.
  See `managing-locks-infrastructure/runbooks.md` → "GitHub Actions OIDC assume failures".
- **Never describe a successful `main` push as "not deployed"** without checking
  the Deploy workflow; that path is the production release mechanism.
