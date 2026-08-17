# Odds API Management

## Overview

The Locks app uses [The Odds API](https://the-odds-api.com/) for NFL **spreads
only**. Final scores for grading come from ESPN’s free scoreboard API (0 Odds
credits). The Odds API key lives in SSM Parameter Store at
`/locks/odds-api-key`. Only the `sync-odds` Lambda role can read it.

## Current State

- Preferred sportsbook: **DraftKings** (`draftkings`).
- **Scores source:** ESPN site API scoreboard (`grade-games`). Match Dynamo
  games by `awayTeam` + `homeTeam` full names; no Odds `/scores` calls.
- **API key:** Set as SecureString at `/locks/odds-api-key` by an approved
  operator via `locks-publish` (`ssm:PutParameter` on that parameter only).
- **Scheduler:** EventBridge schedules in group `locks` are ENABLED for both
  odds sync and grade-games (preseason dry run).
- **Kill switches:**
  - `ODDS_API_ENABLED=false` on SyncOdds — disables spreads sync only.
  - `GRADE_GAMES_ENABLED=false` on GradeGames — disables grading (independent
    of Odds). Default is `true`.

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
- **Estimated usage:** approximately 28–35 credits/month (spreads sync only)
- **Reserve threshold:** Stop sync when fewer than 50 credits remain
- **Cost per call:** 1 credit (odds/spreads). Do **not** call `/scores`
  (2 credits) — grading uses ESPN.

### Sync Schedule (Defined in CDK)
All expressions use timezone `America/New_York`.

| Schedule name | Cron | Local meaning |
|---|---|---|
| `sync-odds-tuesday-advance` | `cron(0 2 ? * TUE *)` | Advance week and sync Tue 2am |
| `sync-odds-thursday` | `cron(0 17 ? * THU *)` | Thu 5pm |
| `sync-odds-sunday-morning` | `cron(0 8 ? * SUN *)` | Sun 8am |
| `sync-odds-sunday-midday` | `cron(30 12 ? * SUN *)` | Sun 12:30pm |
| `sync-odds-sunday-afternoon` | `cron(30 15 ? * SUN *)` | Sun 3:30pm |
| `sync-odds-sunday-evening` | `cron(30 19 ? * SUN *)` | Sun 7:30pm |
| `sync-odds-monday` | `cron(0 17 ? * MON *)` | Mon 5pm |

### Score Schedule (Defined in CDK, timezone `America/New_York`)

Scores are fetched from ESPN for the competition week’s kickoff dates (not ESPN
week numbers). Schedules only trigger the Lambda:

| Schedule name | Cron | Local meaning |
|---|---|---|
| `grade-games-friday` | `cron(0 1 ? * FRI *)` | Fri 1am after Thursday games |
| `grade-games-saturday` | `cron(0 1 ? * SAT *)` | Sat 1am after Friday/holiday games |
| `grade-games-sunday-early` | `cron(0 17 ? * SUN *)` | Sun 5pm after early games |
| `grade-games-sunday-late` | `cron(30 21 ? * SUN *)` | Sun 9:30pm after late games |
| `grade-games-monday` | `cron(0 1 ? * MON *)` | Mon 1am after Sunday night |
| `grade-games-tuesday` | `cron(0 1 ? * TUE *)` | Tue 1am after Monday night |

Scheduler retries each target up to twice. Scheduled handlers throw operational
failures after logging so Scheduler can apply that retry policy; disabled
integrations return an intentional skip without retry.

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

## Disabling Grading

Set `GRADE_GAMES_ENABLED=false` on GradeGames in CDK (or update the Lambda
environment) and redeploy. This does not affect Odds sync or the SSM key.

## Quota Tracking

The `sync-odds` Lambda records quota usage in DynamoDB under the
`QUOTA_PARTITION_KEY` partition. Each run logs:
- Timestamp
- Endpoint called
- Credits used
- Credits remaining

`grade-games` does **not** write Odds quota records (ESPN is unmetered for us).

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

Manual week advance uses the same idempotent sync path as Tuesday Scheduler:

```bash
AWS_PROFILE=locks-publish npx tsx scripts/invoke-advance-week.ts --confirm
```

The script asserts the target account, advances once with a unique token, and
immediately syncs odds into the newly active week.

## Preseason vs regular season

`SyncOddsFunction` reads `ODDS_API_SPORT` (CDK default during preseason testing:
`americanfootball_nfl_preseason`). Set to `americanfootball_nfl` for the regular
season and redeploy `LocksAppStack`. Active week comes from `SEASON#ACTIVE.week`
for sync, grading, current-week reads, and pick submission.
