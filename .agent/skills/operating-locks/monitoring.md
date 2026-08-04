# Monitoring Locks

## AWS Billing

No AWS Budget is configured (by Kenny's choice). Monitor manually:

```bash
# Current month's estimated charges
AWS_PROFILE=coding-agent aws ce get-cost-and-usage \
  --time-period Start=$(date -d "$(date +%Y-%m-01)" +%Y-%m-%d),End=$(date -d "tomorrow" +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=SERVICE \
  --output json
```

**Expected cost:** $0-1/month at 3 users (serverless free tier covers most usage).

## CloudWatch Metrics

### Lambda

```bash
# Invocations and errors for all Locks Lambdas
AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=locks-CurrentWeekFunction \
  --start-time $(date -d '1 day ago' +%s) \
  --end-time $(date +%s) \
  --period 3600 --statistics Sum --output json

AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=locks-CurrentWeekFunction \
  --start-time $(date -d '1 day ago' +%s) \
  --end-time $(date +%s) \
  --period 3600 --statistics Sum --output json
```

### API Gateway

```bash
# Total requests
AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiId,Value=0blz753no0 \
  --start-time $(date -d '1 day ago' +%s) \
  --end-time $(date +%s) \
  --period 3600 --statistics Sum --output json
```

### DynamoDB

```bash
# Read/Write capacity usage
AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=locks \
  --start-time $(date -d '1 day ago' +%s) \
  --end-time $(date +%s) \
  --period 3600 --statistics Sum --output json
```

## CloudWatch Logs

```bash
# List log groups
AWS_PROFILE=coding-agent aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/locks --output json

# Get recent errors from a Lambda
AWS_PROFILE=coding-agent aws logs filter-log-events \
  --log-group-name /aws/lambda/locks-CurrentWeekFunction-* \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 day ago' +%s)000 \
  --limit 20 --output json

# Tail logs (last 10 minutes)
AWS_PROFILE=coding-agent aws logs filter-log-events \
  --log-group-name /aws/lambda/locks-SyncOddsFunction-* \
  --start-time $(date -d '10 minutes ago' +%s)000 \
  --limit 50 --output json
```

## CloudFront Metrics

```bash
# Request count
AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=E1RDEBR71G95WX \
  --start-time $(date -d '1 day ago' +%s) \
  --end-time $(date +%s) \
  --period 3600 --statistics Sum --output json

# Error rate
AWS_PROFILE=coding-agent aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name TotalErrorRate \
  --dimensions Name=DistributionId,Value=E1RDEBR71G95WX \
  --start-time $(date -d '1 day ago' +%s) \
  --end-time $(date +%s) \
  --period 3600 --statistics Average --output json
```

## Odds API Quota

```bash
# Check recent quota usage in DynamoDB
AWS_PROFILE=coding-agent aws dynamodb query \
  --table-name locks \
  --key-condition-expression 'pk = :pk' \
  --expression-attribute-values '{":pk":{"S":"ODDS_API_QUOTA"}}' \
  --scan-index-forward false \
  --max-items 10 --output json
```

## Health Check Summary

Quick read-only health check script:

```bash
echo "=== SPA ==="
curl -s -o /dev/null -w "HTTP %{http_code}" https://d141pq884g4gai.cloudfront.net/
echo ""

echo "=== API ==="
curl -s -o /dev/null -w "HTTP %{http_code}" https://d141pq884g4gai.cloudfront.net/api/week/current
echo ""

echo "=== Stack ==="
AWS_PROFILE=locks-publish aws cloudformation describe-stacks \
  --stack-name LocksAppStack --query 'Stacks[0].StackStatus' --output text

echo "=== Table ==="
AWS_PROFILE=coding-agent aws dynamodb describe-table \
  --table-name locks --query 'Table.TableStatus' --output text
```
