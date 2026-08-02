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

- GitHub still trusts only `kenneth-huebsch/locks` on `main`.
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
`UPDATE_ROLLBACK_FAILED`. Delete and recreate a `ROLLBACK_COMPLETE` initial
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

Mira's OpenClaw container has no `aws` CLI but can use the Node AWS SDK
directly. The host wrappers load `~/.openclaw/.env` and pass the required AWS
variables into the container. Do not source or print that file from a runbook
command. The dedicated IAM user is `coding-agent` in account `580956784928`.

### Account guard (container)

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
node -e "
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const sts = new STSClient({ region: 'us-east-1' });
sts.send(new GetCallerIdentityCommand({})).then(r => {
  if (r.Account !== '580956784928') { console.error('Wrong account:', r.Account); process.exit(1); }
  console.log('Account verified:', r.Account, r.Arn);
}).catch(e => { console.error(e.message); process.exit(1); });
"
```

### Read-only inspection (container)

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
node -e "
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const cfn = new CloudFormationClient({ region: 'us-east-1' });
cfn.send(new DescribeStacksCommand({ StackName: 'LocksAppStack' })).then(res => {
  const stack = res.Stacks[0];
  console.log('Status:', stack.StackStatus);
  (stack.Outputs || []).forEach(o => console.log(o.OutputKey + ': ' + o.OutputValue));
}).catch(e => { console.error(e.message); process.exit(1); });
"
```

### Seeding (container)

The seed scripts use `tsx` with the AWS SDK and can run directly from the
container:

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks
npm run seed                    # foundation game item
npx tsx scripts/seed-active-week.ts   # active week + fake game slate
npx tsx scripts/seed-week.ts          # fake game slate only
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
node -e "
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const cfn = new CloudFormationClient({ region: 'us-east-1' });
cfn.send(new DescribeStacksCommand({ StackName: 'LocksAppStack' })).then(res => {
  (res.Stacks[0].Outputs || []).forEach(o => console.log(o.OutputKey + ': ' + o.OutputValue));
}).catch(e => { console.error(e.message); });
"
```

### Deploying from the container

CDK deployment is not yet supported from the container (no `cdk` CLI).
Infrastructure and app deployment still run from the host with the approved
PowerShell profile. The container can seed, inspect stacks, verify the
deployment, and run any Node AWS SDK script. When `cdk` is added to the
container, the host runbook commands can be mirrored here using
`npx cdk` with env vars instead of `--profile`.
