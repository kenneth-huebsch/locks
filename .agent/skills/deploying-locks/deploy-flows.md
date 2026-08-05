# Locks Deployment Flows

Detailed instructions for each deployment type.

## Flow 0: GitHub Actions from `main` (default production path)

**When:** Any application change that should go live — SPA, Lambda, API routes
wired in `LocksAppStack`, shared types used by the app, etc.

**Trigger:** Push or merge to `main` (not PR open; not other branches).

**Workflow:** `.github/workflows/deploy.yml` (name: **Deploy**)

**What CI runs (in order):**

1. Checkout + Node 22 + `aws-actions/configure-aws-credentials` → role
   `arn:aws:iam::580956784928:role/LocksGitHubDeployRole`
2. Assert STS account is `580956784928`
3. `npm ci`
4. `npm run lint` / `typecheck` / `test` / `build` / `synth`
5. `npm run deploy:infrastructure` (`LocksAppStack` only)
6. `npm run deploy:app` (build/publish SPA, runtime-config, foundation seed,
   CloudFront invalidation)

**Not deployed by this flow:** `LocksGitHubOidcStack` / foundation IAM. Those
stay on Flow 1 (local `deploy:oidc`) with explicit approval.

**Agent checklist after pushing `main`:**

```bash
gh run list --repo kenneth-huebsch/locks --branch main --workflow Deploy --limit 5
gh run view <run-id> --repo kenneth-huebsch/locks  # if a run failed
```

**Approval model:** User asked to land the change on `main` (direct push or
merge). Do not add a second "may I deploy?" unless they only approved a PR
branch or explicitly deferred production.

**Failure modes:** OIDC trust mismatch, quality gate failure, CDK/deploy
permissions. See `managing-locks-infrastructure/runbooks.md` for OIDC assume
failures.

---

## Flow 1: Foundation/OIDC (`deploy:oidc`)

**When:** IAM roles, policies, permissions boundary, OIDC trust, or deploy role
changes in `infrastructure/lib/github-oidc-stack.ts`.

**Profile:** `coding-agent` (assumes CDK deploy role)

**Approval:** Required — this changes IAM and foundation infrastructure.

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# Account guard
account="$(AWS_PROFILE=coding-agent aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account" >&2; exit 1; }

# Pre-deploy checks
npm run lint && npm run typecheck && npm test && npm run build
AWS_PROFILE=coding-agent npm run synth

# Review the diff
AWS_PROFILE=coding-agent npm run cdk -- diff LocksGitHubOidcStack

# Deploy (after explicit approval)
AWS_PROFILE=coding-agent npm run deploy:oidc
```

**Post-deploy:**
- Verify `LocksCodingAgentReadPolicy` is attached to `coding-agent`
- Verify `LocksAppPublishRole` exists if it was part of the change
- Verify live GitHub OIDC trust is exact id-qualified main:

```bash
AWS_PROFILE=coding-agent aws iam get-role \
  --role-name LocksGitHubDeployRole \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
# Expect StringEquals aud=sts.amazonaws.com and
# sub=repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main
```

- If Deploy was failing only on OIDC, re-run or push and confirm assume succeeds
  before treating the foundation change as done.

## Flow 2: Application Infrastructure (`deploy:infrastructure`)

**When:** New Lambda functions, API routes, DynamoDB changes, Cognito changes,
EventBridge schedules, or any `LocksAppStack` resource change.

**Profile:** `coding-agent`

**Approval:** Required.

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# Account guard
account="$(AWS_PROFILE=coding-agent aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account" >&2; exit 1; }

# Pre-deploy checks
npm run lint && npm run typecheck && npm test && npm run build
AWS_PROFILE=coding-agent npm run synth

# Review the diff
AWS_PROFILE=coding-agent npm run cdk -- diff LocksAppStack

# Deploy (after explicit approval)
AWS_PROFILE=coding-agent npm run deploy:infrastructure
```

**Post-deploy:**
- Run verification script: `npx tsx scripts/verify-deployment.ts`
- Check stack outputs for any new exports
- Test API routes

## Flow 3: App Publish + Seed (`deploy:app`)

**When:** SPA changes (frontend code), static assets, runtime config update,
or re-seeding the foundation game.

**Profile:** `locks-publish` (assumes `LocksAppPublishRole`)

**Approval:** Required.

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# Account guard
account="$(AWS_PROFILE=locks-publish aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account" >&2; exit 1; }

# Pre-deploy checks (build is part of deploy:app script)
npm run lint && npm run typecheck && npm test

# Deploy (after explicit approval)
AWS_PROFILE=locks-publish npm run deploy:app
```

What `deploy:app` does:
1. Reads CloudFormation stack outputs (API endpoint, Cognito config, bucket, distribution)
2. Builds the SPA (`vite build`)
3. Generates `runtime-config.json` with same-origin config
4. Syncs `dist/` to the S3 site bucket
5. Idempotently writes the canonical foundation game to DynamoDB
6. Creates a CloudFront invalidation

**Post-deploy:**
- Verify SPA: `curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/`
- Verify runtime config loads
- Test login flow if possible

## Typical Update Scenarios

### Normal app or frontend change (preferred)
```bash
# Pre-checks locally
npm run lint && npm run typecheck && npm test && npm run build

# Land on main (direct push or merge PR) — GitHub Actions deploys production
git push origin main
gh run list --repo kenneth-huebsch/locks --branch main --workflow Deploy --limit 3
```

### Manual frontend-only publish (local operator; needs explicit approval)
```bash
npm run lint && npm run typecheck && npm test && npm run build
AWS_PROFILE=locks-publish npm run deploy:app
```

### Manual new API endpoint (local operator; needs explicit approval)
```bash
# 1. Deploy infrastructure (new Lambda + route)
AWS_PROFILE=coding-agent npm run deploy:infrastructure

# 2. Publish updated SPA (if frontend calls the new endpoint)
AWS_PROFILE=locks-publish npm run deploy:app
```
# Equivalent preferred path: merge/push main and let Flow 0 run both steps.

### IAM/foundation change
```bash
# 1. Deploy OIDC stack
AWS_PROFILE=coding-agent npm run deploy:oidc

# 2. If app stack also changed, deploy infrastructure
AWS_PROFILE=coding-agent npm run deploy:infrastructure

# 3. If SPA changed, publish app
AWS_PROFILE=locks-publish npm run deploy:app
```
