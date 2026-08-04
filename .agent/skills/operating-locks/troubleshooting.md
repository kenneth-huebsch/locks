# Troubleshooting Locks

## Common Issues

### SPA returns 200 but page is blank

**Cause:** Runtime config not loading, or JS bundle failed.

**Diagnosis:**
```bash
# Check if runtime-config.json exists in S3
AWS_PROFILE=locks-publish aws s3 ls s3://locks-580956784928-us-east-1-site/runtime-config.json

# Check CloudFront is serving it
curl -s https://d141pq884g4gai.cloudfront.net/runtime-config.json

# Check JS assets are present
curl -s https://d141pq884g4gai.cloudfront.net/ | grep -o '/assets/[^"]*'
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/assets/index-ljXytRbw.js
```

**Fix:** If runtime-config.json is missing, redeploy: `AWS_PROFILE=locks-publish npm run deploy:app`
If assets are missing, the build may have changed — redeploy app.

### API returns 404

**Cause:** Wrong path, or route not deployed.

**Diagnosis:**
```bash
# Correct paths:
# GET  /api/week/current   — current week games + picks
# POST /api/picks          — submit picks

# Test directly against API Gateway
curl -s https://0blz753no0.execute-api.us-east-1.amazonaws.com/api/week/current
# Expect: {"message":"Unauthorized"} (401 = route exists)

# If you get {"message":"Not Found"} (404), the route isn't deployed
# Check the stack:
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksAppStack --query 'Stacks[0].StackStatus' --output text
```

**Fix:** If routes are missing, redeploy infrastructure: `AWS_PROFILE=coding-agent npm run deploy:infrastructure`

### API returns 401 Unauthorized

**This is expected without a valid Cognito JWT.** The JWT authorizer is on all
routes. If getting 401 with a valid token:

- Check Cognito user pool is active
- Check token hasn't expired
- Check the `aud` claim matches the client ID (`7vojip3hod4ioile2vi4n4mkmj`)

### CloudFront serving stale content

**Cause:** Invalidation didn't complete or wasn't created.

**Fix:**
```bash
# Manual invalidation
AWS_PROFILE=locks-publish aws cloudfront create-invalidation \
  --distribution-id E1RDEBR71G95WX \
  --paths "/*"

# Check invalidation status
AWS_PROFILE=coding-agent aws cloudfront list-invalidations \
  --distribution-id E1RDEBR71G95WX --output json
```

### Lambda errors

**Diagnosis:**
```bash
# List CloudWatch log groups for Locks Lambdas
AWS_PROFILE=coding-agent aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/locks --output json

# Get recent log events
AWS_PROFILE=coding-agent aws logs filter-log-events \
  --log-group-name /aws/lambda/locks-CurrentWeekFunction-* \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --limit 20 --output json
```

**Common causes:**
- DynamoDB throttling (unlikely at 3 users)
- Missing environment variable (check CDK config)
- SSM parameter not set (Odds API key — sync-odds only)
- Permission error (check Lambda role policies)

### Odds sync not running

**Diagnosis:**
```bash
# Check if the EventBridge schedule exists and is enabled
AWS_PROFILE=coding-agent aws scheduler list-schedules \
  --group-name locks-scheduled-functions --output json

# Check sync-odds Lambda logs
AWS_PROFILE=coding-agent aws logs filter-log-events \
  --log-group-name /aws/lambda/locks-SyncOddsFunction-* \
  --start-time $(date -d '1 day ago' +%s)000 \
  --limit 20 --output json
```

**Common causes:**
- Odds API key not set in SSM (`/locks/odds-api-key`)
- `ODDS_API_ENABLED=false` on the Lambda
- Quota exhausted (check DynamoDB quota records)
- Schedule is disabled

### DynamoDB issues

**Diagnosis:**
```bash
# Table status
AWS_PROFILE=coding-agent aws dynamodb describe-table \
  --table-name locks --output json

# Check for throttling
AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ThrottledRequests \
  --dimensions Name=TableName,Value=locks \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --period 300 --statistics Sum --output json
```

### GitHub Actions deployment fails

**Diagnosis:**
- Check workflow run logs in GitHub Actions tab
- Common causes:
  - OIDC role trust mismatch — must be id-qualified
    `repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main`
    (classic `repo:kenneth-huebsch/locks:...` will not match). See
    `managing-locks-infrastructure/runbooks.md` → "GitHub Actions OIDC assume failures".
  - Trust updated in git but not yet applied via local `deploy:oidc`
  - Test/lint/typecheck/build failure in the commit
  - CDK synth error
  - CloudFormation drift

### SPA build fails locally

**Diagnosis:**
```bash
npm run build 2>&1
```

**Common causes:**
- TypeScript errors: run `npm run typecheck`
- Import errors: check that all imports resolve
- Vite config issues: check `vite.config.ts`

## Getting Help

If stuck after trying the above:
1. Check the relevant skill guide for more detail
2. Check `README.md` for operational context
3. Check `docs/` for data model and handoff docs
4. Ask Kenny for guidance or credentials
