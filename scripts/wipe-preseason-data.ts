/**
 * Wipe preseason competition data and reset SEASON#ACTIVE to regular-season Week 1.
 *
 * Deletes WEEK#2026#W01–W04 (META + GAME#) and matching player PICK# / COUNTER#
 * rows for the league roster. Does not touch Cognito, quota rows, or the table.
 *
 * Requires AWS_PROFILE=locks-publish and --confirm.
 *
 * Usage:
 *   AWS_PROFILE=locks-publish npx tsx scripts/wipe-preseason-data.ts
 *   AWS_PROFILE=locks-publish npx tsx scripts/wipe-preseason-data.ts --confirm
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  counterSortKey,
  playerPartitionKey,
  weekPartitionKey,
} from '../shared/dynamo.js';
import { LEAGUE_ROSTER } from '../shared/roster.js';
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';

const SEASON = 2026;
const PRESEASON_WEEKS = [1, 2, 3, 4] as const;
/** Tue 2026-09-08 02:00 America/New_York — opens regular-season Week 1 window. */
const WEEK_1_STARTS_AT = '2026-09-08T06:00:00.000Z';

const confirm = process.argv.includes('--confirm');

await assertTargetAccount();
const outputs = await getAppStackOutputs();
const tableName = requireOutput(outputs, 'TableName');
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: TARGET_REGION }),
);

type KeyPair = { PK: string; SK: string };

async function queryPartitionKeys(pk: string): Promise<KeyPair[]> {
  const keys: KeyPair[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression: 'PK, SK',
      }),
    );

    for (const item of page.Items ?? []) {
      if (typeof item.PK === 'string' && typeof item.SK === 'string') {
        keys.push({ PK: item.PK, SK: item.SK });
      }
    }
    exclusiveStartKey = page.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return keys;
}

function isPreseasonPlayerRow(sk: string): boolean {
  return PRESEASON_WEEKS.some((week) => {
    const token = `${SEASON}#W${String(week).padStart(2, '0')}`;
    return (
      sk.startsWith(`PICK#${token}#`) || sk === counterSortKey(SEASON, week)
    );
  });
}

const toDelete: KeyPair[] = [];

for (const week of PRESEASON_WEEKS) {
  toDelete.push(...(await queryPartitionKeys(weekPartitionKey(SEASON, week))));
}

for (const player of LEAGUE_ROSTER) {
  const playerKeys = await queryPartitionKeys(playerPartitionKey(player.sub));
  toDelete.push(...playerKeys.filter((key) => isPreseasonPlayerRow(key.SK)));
}

const unique = new Map(toDelete.map((key) => [`${key.PK}\0${key.SK}`, key]));
const keys = [...unique.values()].sort((a, b) =>
  a.PK === b.PK ? a.SK.localeCompare(b.SK) : a.PK.localeCompare(b.PK),
);

console.log(`Table: ${tableName}`);
console.log(`Items to delete: ${keys.length}`);
for (const key of keys) {
  console.log(`  ${key.PK} / ${key.SK}`);
}
console.log(
  `Would reset ${ACTIVE_SEASON_PARTITION_KEY}/${ACTIVE_SEASON_SORT_KEY}` +
    ` → season=${SEASON} week=1 weekStartsAt=${WEEK_1_STARTS_AT}`,
);

if (!confirm) {
  console.log('Dry run only. Pass --confirm to delete and reset.');
  process.exit(0);
}

for (const key of keys) {
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
      season: SEASON,
      week: 1,
      status: 'open',
      weekStartsAt: WEEK_1_STARTS_AT,
      updatedAt: new Date().toISOString(),
    },
  }),
);

console.log(`Deleted ${keys.length} items and reset active week to 2026#W01`);
