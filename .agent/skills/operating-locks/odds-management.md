# Odds API Management

## Overview

The Locks app uses [The Odds API](https://the-odds-api.com/) for NFL spreads
and scores. The API key lives in SSM Parameter Store at
`/locks/odds-api-key`. The `sync-odds` and `grade-games` Lambda roles can
read it.

## Current State

- Preferred sportsbook: **DraftKings** (`draftkings`).


- **API key:** Set as SecureString at `/locks/odds-api-key` by an approved
  operator via `locks-publish` (`ssm:PutParameter` on that parameter only).
- **Scheduler:** EventBridge schedules in group `locks` are ENABLED for both
  odds sync and grade-games (preseason dry run). `ODDS_API_ENABLED` on both
  Lambdas is `true`.
- **Kill switch:** Set `ODDS_API_ENABLED=false` on the Lambda to disable
  sync/grading without removing the key or schedule.

## Setting the Odds API Key

**Requires explicit approval from Kenny.** Never set this without approval.

```bash
# locks-publish may write only this parameter (never commit the key)
AWS_PROFILE=locks-publish aws ssm put-parameter \
  --name /locks/odds-api-key \
  --value "<KEY_VALUE>" \
  --type SecureString \
  --overwrite \
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
- Expressions use timezone `UTC` (see `locks-app-stack.ts` comments for ET)

### Score Schedule (Defined in CDK, timezone `America/New_York`)

| Schedule name | Cron | Local meaning |
|---|---|---|
| `grade-games-thursday-tnf` | `cron(45 23 ? * THU *)` | Thu 11:45pm ET after TNF |
| `grade-games-sunday-early` | `cron(15 16 ? * SUN *)` | Sun 4:15pm ET after early games |
| `grade-games-sunday-late` | `cron(0 20 ? * SUN *)` | Sun 8:00pm ET after late games |
| `grade-games-sunday-snf` | `cron(45 23 ? * SUN *)` | Sun 11:45pm ET after SNF |
| `grade-games-monday-mnf` | `cron(45 23 ? * MON *)` | Mon 11:45pm ET after MNF |

Schedules are ENABLED to match odds sync for the preseason dry run. Disable
both schedule families in the offseason.

Both schedule families target Lambdas through the shared
`SyncOddsSchedulerInvokeRole` (Description stays
`Allows EventBridge Scheduler to invoke sync-odds` — do not change it;
`AppIamExecutionPolicy` lacks `iam:UpdateRoleDescription`). `grantInvoke`
covers sync-odds and grade-games. Effective invoke also requires
`LocksAppRuntimeBoundary` to allow `lambda:InvokeFunction` on
`LocksAppStack-*` (deploy foundation/OIDC before relying on ENABLED schedules).

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


## Manual sync (operator)

With `AWS_PROFILE=locks-publish` after OIDC deploy grants `OperatorLambdaInvoke`:

```bash
FN=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'LocksAppStack-SyncOddsFunction')].FunctionName | [0]" --output text)
# or use the known physical name from CloudFormation
aws lambda invoke \
  --function-name LocksAppStack-SyncOddsFunctionB9942AD9-DTa4gv4jXaLm \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  /tmp/sync-odds-out.json
cat /tmp/sync-odds-out.json
```

`coding-agent` remains read-only and cannot invoke.

## Manual grade (operator)

After `LocksAppStack` exposes `GradeGamesFunctionName` and OIDC publish role
includes `LocksAppStack-GradeGamesFunction*`:

```bash
# Active week from SEASON#ACTIVE
AWS_PROFILE=locks-publish npx tsx scripts/invoke-grade-games.ts

# Optional season-week override (same payload as Lambda event)
AWS_PROFILE=locks-publish npx tsx scripts/invoke-grade-games.ts 2026#W01
```

The script asserts account `580956784928`, resolves the function from stack
outputs, and invokes Lambda only — it does not run CDK synth/deploy.


## Preseason vs regular season

`SyncOddsFunction` reads `ODDS_API_SPORT` (CDK default during preseason testing:
`americanfootball_nfl_preseason`). Set to `americanfootball_nfl` for the regular
season and redeploy `LocksAppStack`. Active week comes from `SEASON#ACTIVE.week`
(and optional `ACTIVE_WEEK` on the Lambda).
