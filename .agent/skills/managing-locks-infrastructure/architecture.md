# Infrastructure Architecture

## Sources of truth

- CDK entry point: `infrastructure/bin/locks.ts`
- Foundation and deployment identities: `infrastructure/lib/github-oidc-stack.ts`
- Application resources: `infrastructure/lib/locks-app-stack.ts`
- Deployment workflow: `.github/workflows/deploy.yml`
- Runtime publishing: `scripts/deploy-app.ts`
- AWS context guard and outputs: `scripts/aws-context.ts`

## Fixed environment

- Account: `580956784928`
- Region: `us-east-1`
- Repository: `kenneth-huebsch/locks`
- GitHub deployment ref: `refs/heads/main`
- GitHub OIDC `sub` (exact, id-qualified):
  `repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main`
- Site: `https://d141pq884g4gai.cloudfront.net`

The CDK entry point rejects any other account or region.

## Trust boundaries

### Foundation path

The local `coding-agent` identity manages `LocksGitHubOidcStack` through the standard bootstrap roles. The bootstrap CloudFormation execution role has only:

- `LocksCdkExecutionPolicy`
- `LocksCdkIamExecutionPolicy`

These policies are foundation-only. Never leave `AdministratorAccess` attached after bootstrap or migration.

The user's durable policy may assume only the exact Locks application,
publishing, and CDK bootstrap roles. Long-lived user credentials do not receive
direct deployment-write permissions.

The fixed names, paths, logical IDs, and legacy descriptions of these two managed policies are migration-sensitive. Changing replacement-sensitive properties can fail because IAM cannot replace a fixed-name policy while the old policy exists.

### Application path

```text
GitHub OIDC or coding-agent
  -> LocksAppDeployRole
  -> CloudFormation for LocksAppStack only
  -> LocksAppCloudFormationExecutionRole
  -> scoped application service and IAM policies
```

GitHub may also assume CDK file, image, and lookup roles. It must not assume the generic bootstrap deploy role.

### GitHub Actions OIDC subject

`LocksGitHubDeployRole` is assumed by `.github/workflows/deploy.yml` via
`aws-actions/configure-aws-credentials` with `id-token: write`.

This repo's Actions OIDC tokens use **id-qualified** subjects:

```text
sub = repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main
aud = sts.amazonaws.com
iss = https://token.actions.githubusercontent.com
```

Do **not** write trust as the classic `repo:kenneth-huebsch/locks:ref:refs/heads/main`
form. That never matches the JWT `sub` for this repository and produces:

`Not authorized to perform sts:AssumeRoleWithWebIdentity`

Confirm the live claim shape before changing trust:

```bash
gh api repos/kenneth-huebsch/locks/actions/oidc/customization/sub
```

`sub_claim_prefix` showing `repo:kenneth-huebsch@25780362/locks@1317783805`
means trust must use that prefix. Owner id `25780362` and repo id `1317783805`
are stable for this GitHub repository; if the repo is transferred or recreated,
re-read the JWT/`sub_claim_prefix` and update `GITHUB_SUBJECT` in
`infrastructure/lib/github-oidc-stack.ts` plus its unit test.

Foundation/OIDC trust changes are local-only (`npm run deploy:oidc`). Pushing
the CDK change to `main` does not update live IAM until `deploy:oidc` runs.

Static publishing and seeding from Mira use a separate path:

```text
coding-agent
  -> LocksAppPublishRole
  -> Locks site bucket, CloudFront invalidation, table seed, and Cognito user ops
```

`LocksAppPublishRole` Cognito permissions live in the role inline policy
(`CognitoUserOps`). Keep the role Description string stable in CDK: the
foundation CloudFormation execution policy does not grant
`iam:UpdateRoleDescription`, so Description changes fail OIDC stack updates.

`LocksAppCloudFormationExecutionRole` cannot mutate foundation, GitHub, deployment, or execution identities. It may manage only `LocksAppStack-*` runtime roles.

Every runtime role receives `LocksAppRuntimeBoundary`. Role creation requires that exact boundary; boundary removal is not allowed; managed-policy attachments and `iam:PassRole` are allowlisted.

The boundary includes scoped `lambda:InvokeFunction` on `LocksAppStack-*` so EventBridge Scheduler invoke roles (for example `SyncOddsSchedulerInvokeRole`) can actually invoke sync-odds and grade-games targets. Identity policies from `grantInvoke` alone are ineffective under a boundary that omits invoke. Operator invoke via `LocksAppPublishRole` is outside this boundary.

## Application resources

`LocksAppStack` owns:

- Private S3 site bucket and CloudFront distribution
- CloudFront SPA rewrite on the S3 behavior only
- Same-origin `/api/*` behavior without caching
- Invite-only Cognito user pool, managed-login domain, and web client
- JWT-authorized API Gateway HTTP API
- Current-week Lambda
- Encrypted, point-in-time-recoverable DynamoDB table
- EventBridge Scheduler group
- Future scheduled-function role with exact SSM read for `/locks/odds-api-key`

The SSM parameter value is not created in Phase 1.

## Security invariants

- S3 remains private behind origin access control.
- Every user API route has a JWT authorizer.
- The browser never receives AWS credentials or direct DynamoDB access.
- Runtime roles cannot access unrelated account data.
- GitHub uses short-lived OIDC credentials and immutable action SHAs.
- Infrastructure publishing uploads immutable assets, then mutable entrypoints, then removes stale objects.
- Foundation changes never run from the normal GitHub deployment workflow.

## Destructive properties

Phase 1 uses destroy policies for the site bucket, Cognito pool, and DynamoDB table. DynamoDB PITR reduces recovery risk but does not make teardown reversible. Treat replacements and stack destruction as data-loss operations.
