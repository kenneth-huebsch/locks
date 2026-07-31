# Locks

Phase 1 is a serverless foundation for the NFL Locks app. It provides an
invite-only Cognito login, a JWT-protected current-week API, and one
idempotently seeded game. Picks, odds, grading, and standings are intentionally
out of scope.

## Architecture

- React, Vite, TypeScript, and Tailwind CSS
- Private S3 origin behind CloudFront
- Cognito managed login using Authorization Code and PKCE
- API Gateway HTTP API with a Cognito JWT authorizer
- Lambda and encrypted DynamoDB
- EventBridge Scheduler group and a future Lambda execution role
- GitHub Actions deployment using repository- and branch-restricted OIDC

All AWS resources are defined in `LocksGitHubOidcStack` and `LocksAppStack`.
The target is fixed to account `580956784928` in `us-east-1`.

## Local verification

Use Node.js 22 or newer.

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

CDK synthesis resolves the current AWS identity. Set the approved profile and
run the account guard first:

```powershell
$Profile = "kenneth.huebsch@gmail.com"
$ExpectedAccount = "580956784928"
$Account = aws sts get-caller-identity --profile $Profile --query Account --output text
if ($Account -ne $ExpectedAccount) { throw "Expected AWS account $ExpectedAccount, received $Account" }
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = "us-east-1"
$env:AWS_DEFAULT_REGION = "us-east-1"
npm run synth
```

Never continue with bootstrap, deployment, publishing, seeding, or teardown if
that guard fails.

## One-time bootstrap and GitHub OIDC

These commands are intentionally local. The deployment workflow cannot assume
its role until this setup exists.

```powershell
$Profile = "kenneth.huebsch@gmail.com"
$ExpectedAccount = "580956784928"
$Account = aws sts get-caller-identity --profile $Profile --query Account --output text
if ($Account -ne $ExpectedAccount) { throw "Expected AWS account $ExpectedAccount, received $Account" }
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = "us-east-1"
$env:AWS_DEFAULT_REGION = "us-east-1"

npx cdk bootstrap "aws://580956784928/us-east-1" --profile $Profile
npm run deploy:oidc
npx cdk bootstrap "aws://580956784928/us-east-1" `
  --profile $Profile `
  --cloudformation-execution-policies "arn:aws:iam::580956784928:policy/LocksCdkExecutionPolicy" `
  --cloudformation-execution-policies "arn:aws:iam::580956784928:policy/LocksCdkIamExecutionPolicy"
```

The initial bootstrap uses its default `AdministratorAccess` policy so the
OIDC stack can create both scoped policies. The second bootstrap update
replaces that default with both action-scoped policies created by the OIDC
stack. Repeating the policy option is the current CDK CLI syntax for attaching
multiple policies. The GitHub role trusts only
`repo:kenneth-huebsch/locks:ref:refs/heads/main`.

## Deployment

For a local deployment, repeat the account guard above, then run:

```powershell
npm run deploy:infrastructure
npm run deploy:app
```

`deploy:app` reads CloudFormation outputs, creates the same-origin runtime
configuration, builds and synchronizes the SPA, idempotently writes the
canonical game fixture, and invalidates CloudFront.

After the one-time OIDC setup, a push to `main` runs the same checks and deploys
only `LocksAppStack`. The workflow asserts the STS account before any
deployment and contains no long-lived AWS credentials.

## Login

The app creates only `kenneth.huebsch@gmail.com`. Cognito emails that address a
temporary password. Open the `DistributionDomainName` output, choose **Sign
in**, and complete Cognito’s required password-change flow. The authenticated
page then loads the seeded Week 1 game through `/api/week/current`.

## Teardown

Run the account guard first, then destroy the application before the OIDC
bootstrap resources:

```powershell
npm run cdk -- destroy LocksAppStack --force
npm run cdk -- destroy LocksGitHubOidcStack --force
aws cloudformation delete-stack `
  --stack-name CDKToolkit `
  --region us-east-1 `
  --profile "kenneth.huebsch@gmail.com"
aws cloudformation wait stack-delete-complete `
  --stack-name CDKToolkit `
  --region us-east-1 `
  --profile "kenneth.huebsch@gmail.com"
aws iam delete-policy `
  --policy-arn "arn:aws:iam::580956784928:policy/LocksCdkExecutionPolicy" `
  --profile "kenneth.huebsch@gmail.com"
aws iam delete-policy `
  --policy-arn "arn:aws:iam::580956784928:policy/LocksCdkIamExecutionPolicy" `
  --profile "kenneth.huebsch@gmail.com"
```

The app bucket and DynamoDB table use destroy policies for this foundation.
The CDK execution policies are retained during OIDC stack deletion so they
remain available to finish teardown, then removed explicitly above. No SSM
parameter or AWS Budget is created.
