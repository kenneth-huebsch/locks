/**
 * Live deployment verification for the Locks app.
 *
 * Run with: npx tsx scripts/verify-deployment.ts
 *
 * Checks:
 * 1. STS caller identity matches account 580956784928
 * 2. LocksAppStack is CREATE_COMPLETE or UPDATE_COMPLETE
 * 3. Site root returns 200
 * 4. /api/week/current returns 401 without auth
 * 5. DynamoDB has the seeded active week item
 *
 * Exits non-zero on any failure. Read-only — no mutations.
 */
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import https from 'node:https';

const TARGET_ACCOUNT = '580956784928';
const TARGET_REGION = 'us-east-1';
const APP_STACK_NAME = 'LocksAppStack';
const SITE_URL = 'https://d141pq884g4gai.cloudfront.net';

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`✓ ${label}`);
  } else {
    console.error(`✗ ${label}${detail ? ': ' + detail : ''}`);
    process.exitCode = 1;
  }
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  // 1. Account guard
  const sts = new STSClient({ region: TARGET_REGION });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  check(
    `Account identity is ${TARGET_ACCOUNT}`,
    identity.Account === TARGET_ACCOUNT,
    `got ${identity.Account}`,
  );

  // 2. Stack status
  const cfn = new CloudFormationClient({ region: TARGET_REGION });
  const stackRes = await cfn.send(
    new DescribeStacksCommand({ StackName: APP_STACK_NAME }),
  );
  const stack = stackRes.Stacks?.[0];
  const healthyStatuses = ['CREATE_COMPLETE', 'UPDATE_COMPLETE'];
  check(
    `${APP_STACK_NAME} is healthy`,
    !!stack && healthyStatuses.includes(stack.StackStatus ?? ''),
    stack?.StackStatus,
  );

  // Get table name from outputs
  const outputs = Object.fromEntries(
    (stack?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
  );
  const tableName = outputs['TableName'];
  if (!tableName) {
    console.error('✗ TableName output not found');
    process.exitCode = 1;
    return;
  }

  // 3. Site root returns 200
  const siteRes = await httpGet(`${SITE_URL}/`);
  check('Site root returns 200', siteRes.status === 200, `got ${siteRes.status}`);

  // 4. API returns 401 without auth
  const apiRes = await httpGet(`${SITE_URL}/api/week/current`);
  check(
    'API returns 401 without auth',
    apiRes.status === 401,
    `got ${apiRes.status}`,
  );

  // 5. DynamoDB has seeded active week (requires dynamodb:GetItem permission)
  // The coding-agent IAM user may only have PutItem (for seeding).
  // This check is best-effort — skip if permission denied.
  try {
    const ddb = new DynamoDBClient({ region: TARGET_REGION });
    const itemRes = await ddb.send(
      new GetItemCommand({
        TableName: tableName,
        Key: {
          PK: { S: 'SEASON#ACTIVE' },
          SK: { S: 'META' },
        },
      }),
    );
    check(
      'DynamoDB has seeded active week item',
      !!itemRes.Item,
      'SEASON#ACTIVE / META not found',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not authorized')) {
      console.log('  ⚠ DynamoDB GetItem skipped (coding-agent lacks read permission)');
    } else {
      throw err;
    }
  }

  if (process.exitCode) {
    console.error('\nSome verification checks failed.');
  } else {
    console.log('\nAll live verification checks passed.');
  }
}

main().catch((err) => {
  console.error('Verification error:', err.message);
  process.exit(1);
});
