# Odds API Management

## Overview

The Locks app uses [The Odds API](https://the-odds-api.com/) for NFL spreads
and scores. The API key lives in SSM Parameter Store at
`/locks/odds-api-key`. Only the `sync-odds` Lambda role can read it.

## Current State

- **API key:** NOT SET. The SSM parameter does not have a value yet. Kenny
  must provide a free-tier Odds API key before odds sync can run.
- **Scheduler:** The EventBridge schedule for `sync-odds` exists but the
  `ODDS_API_ENABLED` env var on the Lambda is set to `true`. Once the key is
  set, the scheduler will start calling the API.
- **Kill switch:** Set `ODDS_API_ENABLED=false` on the Lambda to disable
  sync without removing the key or schedule.

## Setting the Odds API Key

**Requires explicit approval from Kenny.** Never set this without approval.

```bash
# From the host (coding-agent doesn't have SSM PutParameter permission)
# The key must be provided by Kenny directly

aws ssm put-parameter \
  --name /locks/odds-api-key \
  --value "<KEY_VALUE>" \
  --type SecureString \
  --region us-east-1
```

## Checking the Key (Read-Only)

```bash
# coding-agent can't read SSM. Check from the host or verify via Lambda logs.
# If the Lambda is running successfully, the key is set.
AWS_PROFILE=coding-agent aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/locks --output json
```

## Free-Tier Quota Strategy

- **Monthly limit:** 500 credits
- **Estimated usage:** 80-90 credits/month
- **Reserve threshold:** Stop sync when fewer than 50 credits remain
- **Cost per call:** 1 credit (odds/spreads), 2 credits (scores)

### Sync Schedule (Defined in CDK)
- Tuesday-Wednesday: once daily
- Thursday-Monday: twice daily (morning + ~2h before first kickoff)

### Score Schedule (Phase 3 — not yet implemented)
- Sunday: after early games, late games, SNF
- Monday: after MNF
- Thursday: after TNF

## Disabling Odds Sync

```bash
# Emergency kill switch — update the Lambda env var
# This requires a stack redeploy or Lambda update
# Simplest: set ODDS_API_ENABLED=false in the CDK and redeploy

# Or disable the EventBridge schedule
AWS_PROFILE=coding-agent aws scheduler update-schedule \
  --group-name locks-scheduled-functions \
  --name locks-sync-odds \
  --state DISABLED \
  --schedule-expression "rate(1day)" \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target-arn "<sync-odds-function-arn>" \
  --role-arn "<scheduler-invoke-role-arn>"
```

## Quota Tracking

The `sync-odds` Lambda records quota usage in DynamoDB under the
`QUOTA_PARTITION_KEY` partition. Each run logs:
- Timestamp
- Endpoint called
- Credits used
- Credits remaining

```bash
# Check recent quota usage
AWS_PROFILE=coding-agent aws dynamodb query \
  --table-name locks \
  --key-condition-expression 'pk = :pk' \
  --expression-attribute-values '{":pk":{"S":"ODDS_API_QUOTA"}}' \
  --scan-index-forward false \
  --max-items 10 --output json
```
