import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  WEEK_META_SORT_KEY,
  seasonWeekToken,
  weekPartitionKey,
} from '../shared/dynamo.js';
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';
import { seedWeek } from './seed-week.js';

const SEASON = 2026;
const WEEK = 1;

await assertTargetAccount();
const outputs = await getAppStackOutputs();
const tableName = requireOutput(outputs, 'TableName');
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: TARGET_REGION }),
);

await seedWeek({ tableName, client });

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
      season: SEASON,
      week: WEEK,
      status: 'open',
    },
  }),
);

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      PK: weekPartitionKey(SEASON, WEEK),
      SK: WEEK_META_SORT_KEY,
      season: SEASON,
      week: WEEK,
      status: 'open',
      seasonWeek: seasonWeekToken(SEASON, WEEK),
      oddsUpdatedAt: null,
    },
  }),
);

console.log(
  `Seeded active week ${seasonWeekToken(SEASON, WEEK)} and game slate in ${tableName}`,
);
