---
name: managing-locks-infrastructure
description: Use when changing, deploying, debugging, recovering, or tearing down AWS CDK infrastructure, IAM, GitHub OIDC, CloudFront, Cognito, API Gateway, Lambda, DynamoDB, EventBridge Scheduler, or SSM resources for Locks.
---

# Managing Locks Infrastructure

## Core rule

Fail closed on account identity and deployment authority. Application and foundation deployments use separate trust paths; do not bypass them for convenience.

Read:

- `architecture.md` before changing CDK, IAM, trust, or resource boundaries.
- `runbooks.md` before bootstrap, deployment, recovery, rollback, or teardown.

## Before any AWS operation

1. Determine whether the task is read-only or mutating.
2. Obtain explicit user approval for every mutation.
3. Verify account `580956784928` and region `us-east-1`:

```powershell
$Profile = "kenneth.huebsch@gmail.com"
$Account = aws sts get-caller-identity --profile $Profile --query Account --output text
if ($Account -ne "580956784928") { throw "Wrong AWS account: $Account" }
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = "us-east-1"
$env:AWS_DEFAULT_REGION = "us-east-1"
```

Stop if the guard fails.



## Container operations (Mira)

Mira can operate on Locks AWS infrastructure from her OpenClaw container using
the Node AWS SDK, AWS CLI v2, and repository-local CDK. AWS uses native named
profiles from the persistent OpenClaw credential store; access keys must not be
copied into `.env`. See the "Container operations (Mira)" section in
`runbooks.md` for account guards and exact profile selection.

Container capabilities:
- Account identity verification (STS)
- CloudFormation stack inspection
- DynamoDB seeding (all seed scripts)
- Post-deployment verification (curl probes, stack outputs)
- Foundation and application CDK deployment after targeted diff approval
- Static-site publishing through the `locks-publish` role profile
- Any Node AWS SDK script

Use `coding-agent` for read-only checks and CDK. Use `locks-publish` only for
an approved static publish or seed. The container uses bash/sh, not PowerShell.

## Choose the path

| Change | Stack/path |
|---|---|
| App AWS resources | `LocksAppStack` via `LocksAppDeployRole` |
| Static app or seed | `LocksAppPublishRole` via `AWS_PROFILE=locks-publish` |
| OIDC, deploy roles, execution policies, boundary | `LocksGitHubOidcStack` via `AWS_PROFILE=coding-agent`, explicit approval only |
| Bootstrap | One-time or recovery operation only |
| Destruction | Follow the exact teardown order in `runbooks.md` |

## Required checks

Run lint, typecheck, tests, build, guarded synth, and a targeted CDK diff. Review replacements, deletions, IAM scope, role boundaries, S3 public access, JWT authorizers, and data loss before deployment.

The targeted diff is an operator/reviewer gate before a local deployment or
merge. The `main` workflow verifies and deploys an already reviewed commit; do
not broaden that workflow to deploy the foundation stack.

After deployment, verify stack status, site 200, unauthenticated API 401, managed login, runtime config, seed result, and authenticated current-week flow when credentials are available.
