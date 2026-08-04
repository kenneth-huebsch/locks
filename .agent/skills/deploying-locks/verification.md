# Post-Deploy Verification

## Quick Health Checks

```bash
# SPA serving
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/
# Expect: 200

# API route exists (401 = route + JWT authorizer active)
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/api/week/current
# Expect: 401

# Pick submission route (404 on GET = correct, it's POST-only)
curl -s -o /dev/null -w "%{http_code}" https://d141pq884g4gai.cloudfront.net/api/picks
# Expect: 404 (GET not allowed)
```

## Stack Status

```bash
# App stack
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksAppStack \
  --query 'Stacks[0].{Status:StackStatus,LastUpdated:LastUpdatedTime}' \
  --output json

# OIDC stack (coding-agent can't describe this; use locks-publish or host)
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksGitHubOidcStack \
  --query 'Stacks[0].{Status:StackStatus,LastUpdated:LastUpdatedTime}' \
  --output json
```

## Stack Outputs

```bash
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksAppStack \
  --query 'Stacks[0].Outputs' --output json
```

Key outputs to verify:
- `ApiEndpoint` — API Gateway URL
- `DistributionDomainName` — CloudFront URL (the app URL)
- `DistributionId` — CloudFront distribution ID
- `TableName` — DynamoDB table name (`locks`)
- `UserPoolId` — Cognito user pool
- `CognitoDomain` — Cognito hosted UI domain

## DynamoDB Health

```bash
# Table exists and is active
AWS_PROFILE=coding-agent aws dynamodb describe-table \
  --table-name locks --query 'Table.{Status:TableStatus,Items:ItemCount}' --output json

# Scan a few items
AWS_PROFILE=coding-agent aws dynamodb scan \
  --table-name locks --max-items 5 --output json
```

## Lambda Health

```bash
# List functions
AWS_PROFILE=coding-agent aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `locks`)].{Name:FunctionName,Runtime:Runtime,LastModified:LastModified}' \
  --output json

# Check recent invocations (CloudWatch logs)
AWS_PROFILE=coding-agent aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/locks --output json
```

## Full Verification Script

```bash
npx tsx scripts/verify-deployment.ts
```

This script checks:
- SPA responds with 200
- API returns expected status codes
- Stack outputs are present
- DynamoDB table is accessible

## CloudFront Invalidation

After `deploy:app`, the script creates an invalidation automatically. To
manually invalidate:

```bash
AWS_PROFILE=locks-publish aws cloudfront create-invalidation \
  --distribution-id E1RDEBR71G95WX \
  --paths "/*"
```
