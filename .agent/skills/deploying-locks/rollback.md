# Rollback Procedures

## CloudFormation Rollback

If a deployment introduced a problem, roll back the CloudFormation stack to its
previous known-good state:

```bash
cd /home/node/.openclaw/workspace/runtime/repos/kenneth-huebsch--locks

# Account guard
account="$(AWS_PROFILE=coding-agent aws sts get-caller-identity --query Account --output text)"
test "$account" = "580956784928" || { echo "Wrong account" >&2; exit 1; }

# Roll back the app stack to previous version
AWS_PROFILE=coding-agent npm run cdk -- rollback LocksAppStack

# Or roll back the OIDC stack
AWS_PROFILE=coding-agent npm run cdk -- rollback LocksGitHubOidcStack
```

**Caution:** CDK rollback rolls back to the previously deployed CloudFormation
template, which may not match any git commit. Only use this when the previous
state was known-good.

## Git Revert + Redeploy

The safer rollback path — revert the commit that caused the issue, then deploy:

```bash
# 1. Identify the bad commit
git log --oneline -10

# 2. Revert it (creates a new commit that undoes the changes)
git revert <bad-commit-sha>

# 3. Push (triggers GitHub Actions for LocksAppStack)
git push origin main

# 4. Or deploy manually from container
AWS_PROFILE=coding-agent npm run deploy:infrastructure
AWS_PROFILE=locks-publish npm run deploy:app
```

## SPA-Only Rollback

If only the frontend is broken (infrastructure is fine):

```bash
# 1. Revert the frontend commit
git revert <bad-commit-sha>
git push origin main

# 2. Or just redeploy the SPA from the previous good commit
git checkout <good-commit-sha> -- src/
AWS_PROFILE=locks-publish npm run deploy:app
git checkout main -- src/  # restore working tree
```

## Static Asset Rollback (S3)

If the SPA was published but needs immediate rollback without a full redeploy:

```bash
# S3 versioning is NOT enabled on the site bucket by default.
# The only rollback is to redeploy a known-good build.
# Use git revert + deploy:app as above.
```

## DynamoDB Data Issues

If a seed or migration corrupted data:

```bash
# DO NOT delete the table. The table has destroy removal policy.
# Use targeted deletes or re-seeds.

# Re-seed the foundation game (idempotent PutItem)
AWS_PROFILE=locks-publish npm run seed

# Re-seed active week (idempotent)
AWS_PROFILE=locks-publish npx tsx scripts/seed-active-week.ts
```

## When Rollback Doesn't Work

- **Irreversible IAM changes:** If `deploy:oidc` changed IAM roles or policies
  in a way that broke deployment access, you may need to manually fix IAM
  through the AWS console or CLI with an admin account.
- **DynamoDB data loss:** The table has destroy removal policy. If it was
  deleted, PITR backups are the only recovery path.
- **Cognito pool deletion:** The user pool has destroy removal policy. If
  deleted, it must be recreated and users re-invited.

## After Rollback

1. Verify the system is healthy (see `verification.md`)
2. Investigate the root cause before redeploying
3. Add a test or guard to prevent recurrence
4. Update relevant docs if the issue revealed a documentation gap
