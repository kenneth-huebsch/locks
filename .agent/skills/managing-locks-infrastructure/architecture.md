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
- Site: `https://d141pq884g4gai.cloudfront.net`

The CDK entry point rejects any other account or region.

## Trust boundaries

### Foundation path

The local `coding-agent` identity manages `LocksGitHubOidcStack` through the standard bootstrap roles. The bootstrap CloudFormation execution role has only:

- `LocksCdkExecutionPolicy`
- `LocksCdkIamExecutionPolicy`

These policies are foundation-only. Never leave `AdministratorAccess` attached after bootstrap or migration.

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

`LocksAppCloudFormationExecutionRole` cannot mutate foundation, GitHub, deployment, or execution identities. It may manage only `LocksAppStack-*` runtime roles.

Every runtime role receives `LocksAppRuntimeBoundary`. Role creation requires that exact boundary; boundary removal is not allowed; managed-policy attachments and `iam:PassRole` are allowlisted.

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
