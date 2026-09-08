/**
 * Reset SEASON#ACTIVE to a target week and delete higher week partitions.
 *
 * Use when a premature Tuesday advance created a duplicate slate (e.g. W02
 * cloned from Week 1). Does not delete the target week or player picks for it.
 *
 * Requires AWS_PROFILE=locks-publish and --confirm.
 *
 * Usage:
 *   AWS_PROFILE=locks-publish npx tsx scripts/reset-active-week.ts --week 1
 *   AWS_PROFILE=locks-publish npx tsx scripts/reset-active-week.ts --week 1 --confirm
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  weekPartitionKey,
} from '../shared/dynamo.js';
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';

const MAX_SEASON_WEEK = 18;
const confirm = process.argv.includes('--confirm');

function readWeekArg(): number {
  const idx = process.argv.indexOf('--week');
  const raw = idx >= 0 ? process.argv[idx + 1] : undefined;
  const week = raw ? Number(raw) : NaN;
  if (!Number.isInteger(week) || week < 1 || week > MAX_SEASON_WEEK) {
    throw new Error('Pass --week N where N is an integer from 1 to 18');
  }
  return week;
}

const targetWeek = readWeekArg();

await assertTargetAccount();
const outputs = await getAppStackOutputs();
const tableName = requireOutput(outputs, 'TableName');
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: TARGET_REGION }),
);

const activeResult = await client.send(
  new GetCommand({
    TableName: tableName,
    Key: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
    },
  }),
);

const season =
  typeof activeResult.Item?.season === 'number'
    ? activeResult.Item.season
    : 2026;
const currentWeek =
  typeof activeResult.Item?.week === 'number' ? activeResult.Item.week : null;
const weekStartsAt =
  typeof activeResult.Item?.weekStartsAt === 'string'
    ? activeResult.Item.weekStartsAt
    : undefined;

if (!weekStartsAt) {
  throw new Error(
    'SEASON#ACTIVE.weekStartsAt is required so lastAdvanceToken can match the opening window',
  );
}

const lastAdvanceToken = new Date(Date.parse(weekStartsAt)).toISOString().replace(
  /\.000Z$/,
  'Z',
);

type KeyPair = { PK: string; SK: string };
const toDelete: KeyPair[] = [];

for (let week = targetWeek + 1; week <= MAX_SEASON_WEEK; week += 1) {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': weekPartitionKey(season, week),
        },
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression: 'PK, SK',
      }),
    );
    for (const item of page.Items ?? []) {
      if (typeof item.PK === 'string' && typeof item.SK === 'string') {
        toDelete.push({ PK: item.PK, SK: item.SK });
      }
    }
    exclusiveStartKey = page.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);
}

console.log(`Table: ${tableName}`);
console.log(`Active season: ${season}, current week: ${currentWeek ?? 'missing'}`);
console.log(`Reset to week ${targetWeek}`);
console.log(`Items to delete (weeks > ${targetWeek}): ${toDelete.length}`);
for (const key of toDelete) {
  console.log(`  ${key.PK} / ${key.SK}`);
}
console.log(
  `Would put ${ACTIVE_SEASON_PARTITION_KEY}/${ACTIVE_SEASON_SORT_KEY}` +
    ` week=${targetWeek} weekStartsAt=${weekStartsAt}` +
    ` lastAdvanceToken=${lastAdvanceToken}`,
);

if (!confirm) {
  console.log('Dry run only. Pass --confirm to apply.');
  process.exit(0);
}

for (const key of toDelete) {
  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: key.PK, SK: key.SK },
    }),
  );
}

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
      season,
      week: targetWeek,
      status: 'open',
      weekStartsAt,
      lastAdvanceToken,
      updatedAt: new Date().toISOString(),
    },
  }),
);

console.log(
  `Deleted ${toDelete.length} items and reset active week to ${season}#W${String(targetWeek).padStart(2, '0')}`,
);
