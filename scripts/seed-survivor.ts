import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  SURVIVOR_META_SORT_KEY,
  survivorChallengePartitionKey,
  survivorPlayerSortKey,
} from '../shared/dynamo.js';
import { LEAGUE_ROSTER } from '../shared/roster.js';
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';

await assertTargetAccount();
const outputs = await getAppStackOutputs();
const tableName = requireOutput(outputs, 'TableName');
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: TARGET_REGION }),
);

const active = await client.send(
  new GetCommand({
    TableName: tableName,
    Key: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
    },
  }),
);

const season =
  typeof active.Item?.season === 'number' ? active.Item.season : 2026;
const now = new Date().toISOString();
const challengePk = survivorChallengePartitionKey(season);

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      PK: challengePk,
      SK: SURVIVOR_META_SORT_KEY,
      status: 'active',
      winners: [],
      season,
      updatedAt: now,
    },
  }),
);

for (const player of LEAGUE_ROSTER) {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: challengePk,
        SK: survivorPlayerSortKey(player.sub),
        playerId: player.sub,
        status: 'alive',
        usedTeams: [],
        updatedAt: now,
      },
    }),
  );
}

console.log(
  `Seeded survivor challenge ${challengePk} with ${LEAGUE_ROSTER.length} alive players in ${tableName}`,
);
