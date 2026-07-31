# AGENTS.md

This repository is the AWS serverless NFL Locks application.

## Required context

- Read `README.md` and `PLAN.md` before changing architecture or infrastructure.
- For AWS, CDK, IAM, deployment, rollback, recovery, or teardown work, read and follow `.agent/skills/managing-locks-infrastructure/SKILL.md`.
- Treat `README.md` as the human operations guide and the CDK source under `infrastructure/` as the resource source of truth.
- `README.md` records user-approved operational decisions that override stale proposals in `PLAN.md`, including the decision not to create an AWS Budget.

## Hard constraints

- AWS account: `580956784928`.
- AWS region: `us-east-1`.
- Run the STS account guard before synthesis or any AWS mutation. Stop if it returns another account.
- Never deploy, bootstrap, destroy, change credentials, or mutate GitHub/AWS without explicit user approval.
- Never leave the CDK bootstrap execution role on `AdministratorAccess`.
- GitHub Actions may deploy only `LocksAppStack`; foundation/OIDC changes are local, explicitly approved operations.
- Do not let the GitHub OIDC role assume the generic CDK bootstrap deploy role.
- Preserve the dedicated app deploy role, app CloudFormation execution role, and runtime permissions boundary.
- Do not add long-lived AWS credentials to GitHub.

## Engineering workflow

- Keep application resources in `LocksAppStack`.
- Change `LocksGitHubOidcStack` only for identity, deployment, execution-policy, or permissions-boundary requirements.
- Use tests first for behavior and IAM invariants.
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and guarded `npm run synth` before completion.
- Inspect the CDK diff for replacements, deletions, public access, IAM broadening, and missing JWT authorization.
- Use the dedicated package scripts; do not deploy all CDK stacks with a broad command.
- Do not commit, push, merge, publish, or open a PR unless explicitly requested.

## Data and destructive operations

- The site bucket, Cognito pool, and DynamoDB table use destroy-oriented Phase 1 policies.
- Teardown is destructive and must follow the order documented in the infrastructure skill.
- Do not treat DynamoDB point-in-time recovery as permission to destroy production data.
- Do not create or change the Odds API parameter value until the user explicitly provides and approves that credential operation.
