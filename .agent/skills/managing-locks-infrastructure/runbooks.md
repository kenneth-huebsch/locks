# Infrastructure Runbooks

All mutating runbooks require explicit user approval. Run the account guard from `SKILL.md` first.

## Read-only inspection

Use the approved profile and inspect before changing anything:

```powershell
aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1 --profile $Profile
aws cloudformation describe-stacks --stack-name LocksGitHubOidcStack --region us-east-1 --profile $Profile
aws cloudformation describe-stacks --stack-name LocksAppStack --region us-east-1 --profile $Profile
```

For code changes, run:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run synth
npm run cdk -- diff LocksAppStack
```

Use a targeted foundation diff only when changing OIDC, IAM, deployment roles, execution policies, or the runtime boundary.

## Routine application deployment

1. Confirm approval and the account guard.
2. Verify checks and inspect the `LocksAppStack` diff.
3. Deploy infrastructure:

```powershell
npm run deploy:infrastructure
```

4. Publish runtime configuration and static assets, seed idempotently, and invalidate CloudFront:

```powershell
npm run deploy:app
```

The publisher uploads hashed assets first, mutable files second, and deletes stale objects last.

## Foundation or IAM update

Foundation updates are local-only:

```powershell
npm run deploy:oidc
```

Before deployment, prove:

- GitHub still trusts only the exact id-qualified main subject
  `repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main`
  (StringEquals on both `aud` and `sub`; no temporary `repo:*`).
- GitHub cannot assume the generic CDK deploy role.
- App deployment and CloudFormation execution roles remain dedicated.
- Every app runtime role has `LocksAppRuntimeBoundary`.
- IAM mutation cannot target foundation, GitHub, deployment, or execution identities.
- Fixed-name bootstrap policy replacement-sensitive properties are unchanged.

Deploy the foundation first when an app change depends on a new permission, role, or boundary, then deploy the application.

## Greenfield bootstrap

The initial bootstrap temporarily uses the CDK default execution policy. Do not run this without explicit approval:

```powershell
npx cdk bootstrap "aws://580956784928/us-east-1" --profile $Profile
npm run deploy:oidc
npx cdk bootstrap "aws://580956784928/us-east-1" `
  --profile $Profile `
  --cloudformation-execution-policies "arn:aws:iam::580956784928:policy/LocksCdkExecutionPolicy" `
  --cloudformation-execution-policies "arn:aws:iam::580956784928:policy/LocksCdkIamExecutionPolicy"
npm run deploy:infrastructure
npm run deploy:app
```

Immediately verify that the bootstrap execution role has only the two Locks foundation policies.

## Failed deployment

1. Stop retries.
2. Read CloudFormation events and identify the first failed resource.
3. Wait for rollback to finish.
4. If rollback fails, identify the exact missing lifecycle action or retained dependency before using recovery commands.
5. Add the narrow permission or fix the resource dependency in CDK with a regression test.
6. Deploy foundation policy changes first, then retry the application.

Set the failing stack name to `CDKToolkit`, `LocksGitHubOidcStack`, or
`LocksAppStack`, then inspect it:

```powershell
$Stack = "LocksAppStack"
aws cloudformation describe-stacks `
  --stack-name $Stack `
  --region us-east-1 `
  --profile $Profile `
  --query "Stacks[0].StackStatus" `
  --output text
aws cloudformation describe-stack-events `
  --stack-name $Stack `
  --region us-east-1 `
  --profile $Profile `
  --query "StackEvents[?ResourceStatusReason!=null].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]" `
  --output table
```

Use `aws cloudformation continue-update-rollback` only for
`UPDATE_ROLLBACK_FAILED`.

### Continue-update-rollback from Mira / coding-agent

`coding-agent` and `locks-publish` cannot call `cloudformation:ContinueUpdateRollback`
directly on `LocksGitHubOidcStack`. Do **not** stop at that AccessDenied and ask
for a separate host admin profile first.

Assume the CDK bootstrap deploy role (the role CDK CLI uses for local deploys)
and run recovery from that session:

```bash
CREDS=$(aws sts assume-role \
  --role-arn arn:aws:iam::580956784928:role/cdk-hnb659fds-deploy-role-580956784928-us-east-1 \
  --role-session-name mira-oidc-rollback \
  --profile coding-agent \
  --query 'Credentials' \
  --output json)

export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["AccessKeyId"])')
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["SecretAccessKey"])')
export AWS_SESSION_TOKEN=$(echo "$CREDS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["SessionToken"])')
export AWS_DEFAULT_REGION=us-east-1

aws cloudformation continue-update-rollback \
  --stack-name LocksGitHubOidcStack \
  --region us-east-1
aws cloudformation describe-stacks \
  --stack-name LocksGitHubOidcStack \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus' \
  --output text
```

Optional durable AWS config profile (no secrets in the file):

```ini
[profile locks-cdk-deploy]
role_arn = arn:aws:iam::580956784928:role/cdk-hnb659fds-deploy-role-580956784928-us-east-1
source_profile = coding-agent
role_session_name = mira-cdk-deploy
region = us-east-1
```

Then: `AWS_PROFILE=locks-cdk-deploy aws cloudformation continue-update-rollback ...`

Still requires Kenny approval before mutating CFN. If assume-role itself is
denied, escalate — that is a real host/admin gap.

Delete and recreate a `ROLLBACK_COMPLETE` initial
creation only after confirming that every resource rolled back and no retained
data will be lost.

Do not switch to broad permanent permissions to make a deployment pass. Any temporary bootstrap administrator migration requires approval, a paused `main` workflow, and immediate restoration of both scoped bootstrap policies.

Pausing or resuming GitHub Actions is a remote mutation and needs approval. Use
the repository Actions UI, or:

```powershell
gh workflow disable deploy.yml
gh run list --workflow deploy.yml --limit 20 --json databaseId,status,headBranch
gh workflow enable deploy.yml
```

Do not enter a temporary administrator window while any run is queued, pending,
waiting, requested, or in progress. Wait for it to finish, or obtain approval
before cancelling that specific run.

For a bad successful release, inspect `git log --oneline origin/main` and the
GitHub deployment run, have the user confirm the known-good commit, then
deploy from a temporary worktree without moving the current branch:

```powershell
git fetch origin
git show --no-patch --decorate $KnownGoodSha
git worktree add ".worktrees/rollback-$($KnownGoodSha.Substring(0,7))" $KnownGoodSha
Set-Location ".worktrees/rollback-$($KnownGoodSha.Substring(0,7))"
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run synth
npm run cdk -- diff LocksAppStack
npm run deploy:infrastructure
npm run deploy:app
```

Require confirmation that `$KnownGoodSha` is the intended remote commit before
creating the worktree or deploying. The site bucket is not versioned, so
rebuild and republish that commit.

## GitHub Actions OIDC assume failures

Symptom: Deploy fails at `aws-actions/configure-aws-credentials` with

```text
Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

Later steps never run. `LocksGitHubDeployRole` `RoleLastUsed` stays empty.

### Confirmed root cause (2026-08)

This repository emits **id-qualified** OIDC subjects. Classic
`repo:owner/name:ref:refs/heads/main` trust never matches.

Working exact trust:

```text
token.actions.githubusercontent.com:aud = sts.amazonaws.com
token.actions.githubusercontent.com:sub =
  repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main
```

Source of truth in code: `GITHUB_SUBJECT` in
`infrastructure/lib/github-oidc-stack.ts` (unit-tested).

### Diagnose

1. Read the failed Actions step (assume vs later CDK/app failure).
2. Compare live role trust to code:

```bash
AWS_PROFILE=coding-agent aws iam get-role \
  --role-name LocksGitHubDeployRole \
  --query 'Role.AssumeRolePolicyDocument' --output json
gh api repos/kenneth-huebsch/locks/actions/oidc/customization/sub
```

3. If you must see the JWT claims, add a **temporary** debug step that decodes
   only the JWT payload (`sub`, `aud`, `iss`, `ref`, `repository_id`, …), push,
   then remove the step. Do not leave claim dumps or broad `repo:*` trust on
   `main`.

4. Remember: updating the CDK file and pushing does **not** change IAM until
   an approved local `AWS_PROFILE=coding-agent npm run deploy:oidc` succeeds.
   A Deploy run can still fail on the commit that only changed trust in git.

### Fix path

1. Set `GITHUB_SUBJECT` to the exact JWT `sub` for `main` pushes.
2. Prefer `StringEquals` on both `aud` and `sub` (not open-ended `StringLike`).
3. Update `infrastructure/test/github-oidc-stack.test.ts`.
4. Run OIDC unit tests + targeted `cdk diff LocksGitHubOidcStack`.
5. After explicit approval: `AWS_PROFILE=coding-agent npm run deploy:oidc`.
6. Confirm live trust, then confirm Deploy goes green end-to-end.
7. Never leave diagnostic `repo:*` (or other-repo) trust in production.

`coding-agent` cannot read CloudTrail `LookupEvents`; do not depend on
CloudTrail for this diagnosis.

## Post-deployment verification

- All three stacks are `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
- Bootstrap execution has only both Locks foundation policies.
- Site root and an SPA deep route return 200.
- `/api/week/current` returns 401 without a JWT.
- Cognito managed login loads.
- `runtime-config.json` contains the expected authority, client, domain, and same-origin API base.
- The seed command succeeds.
- Authenticated current-week loading succeeds when user credentials are available.

Basic probes:

```powershell
$Site = "https://d141pq884g4gai.cloudfront.net"
curl.exe -s -o NUL -w "%{http_code}" "$Site/"
curl.exe -s -o NUL -w "%{http_code}" "$Site/a/deep/route"
curl.exe -s -o NUL -w "%{http_code}" "$Site/api/week/current"
Invoke-RestMethod "$Site/runtime-config.json"
aws iam list-attached-role-policies `
  --role-name "cdk-hnb659fds-cfn-exec-role-580956784928-us-east-1" `
  --profile $Profile `
  --query "AttachedPolicies[].PolicyArn" `
  --output json
```

Expected HTTP statuses are 200, 200, and 401.
The bootstrap role must list only `LocksCdkExecutionPolicy` and
`LocksCdkIamExecutionPolicy`. Compare runtime configuration values with
`LocksAppStack` outputs. Build the Cognito `/login` URL from those outputs and
require HTTP 200. Authenticated verification remains a browser check: sign in,
complete any password challenge, and confirm the current-week game loads.

## Teardown

Teardown deletes application data and requires explicit confirmation:

```powershell
npm run destroy:app
npm run destroy:oidc
aws cloudformation delete-stack --stack-name CDKToolkit --region us-east-1 --profile $Profile
aws cloudformation wait stack-delete-complete --stack-name CDKToolkit --region us-east-1 --profile $Profile
aws iam delete-policy --policy-arn "arn:aws:iam::580956784928:policy/LocksCdkExecutionPolicy" --profile $Profile
aws iam delete-policy --policy-arn "arn:aws:iam::580956784928:policy/LocksCdkIamExecutionPolicy" --profile $Profile
```

Order is mandatory: application, foundation identities, bootstrap stack, retained policies. Never destroy deployment identities before the application stack.

## Container operations (Mira)

Mira's OpenClaw container has AWS CLI v2, the Node AWS SDK, and
repository-local CDK. It uses native shared credential and config files
selected by trusted `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE`
environment paths. AWS access keys are not stored in `.env`.

Profiles:

- `coding-agent`: read-only inspection and CDK. CDK assumes the exact
  application or bootstrap deployment role declared by the stack assembly.
- `locks-publish`: one-hour `LocksAppPublishRole` session for static publishing
  and DynamoDB seeding.

### Account guard (container)

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
account="$(AWS_PROFILE=coding-agent aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account: $account" >&2; exit 1; }
AWS_PROFILE=coding-agent aws sts get-caller-identity --query Arn --output text
```

### Read-only inspection (container)

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
AWS_PROFILE=coding-agent aws cloudformation describe-stacks \
  --stack-name LocksAppStack \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' \
  --output json
```

### Seeding (container)

Seeding is a mutation and requires fresh approval. Use the publishing role:

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
AWS_PROFILE=locks-publish npm run seed
AWS_PROFILE=locks-publish npx tsx scripts/seed-active-week.ts
AWS_PROFILE=locks-publish npx tsx scripts/seed-week.ts
```

All seed scripts are idempotent (PutItem with no condition). The account guard
in `aws-context.ts` runs automatically before any mutation.

### Post-deployment verification (container)

```bash
# Site and API probes (no AWS credentials needed)
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/api/week/current
# Expected: 200 and 401

# Stack outputs
AWS_PROFILE=coding-agent aws cloudformation describe-stacks \
  --stack-name LocksAppStack \
  --query 'Stacks[0].Outputs' \
  --output json
```

### Deploying from the container

Run all required checks and show a targeted diff before requesting deployment
approval:

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
AWS_PROFILE=coding-agent npm run lint
AWS_PROFILE=coding-agent npm run typecheck
AWS_PROFILE=coding-agent npm test
AWS_PROFILE=coding-agent npm run build
AWS_PROFILE=coding-agent npm run synth
AWS_PROFILE=coding-agent npm run cdk -- diff LocksGitHubOidcStack
AWS_PROFILE=coding-agent npm run cdk -- diff LocksAppStack
```

After fresh approval, use only the targeted command:

```bash
# Foundation, identity, or deployment-role changes
AWS_PROFILE=coding-agent npm run deploy:oidc

# Application infrastructure
AWS_PROFILE=coding-agent npm run deploy:infrastructure

# Static site and seed
AWS_PROFILE=locks-publish npm run deploy:app
```

Never use `cdk deploy --all`. Re-run the account guard immediately before each
mutation.
