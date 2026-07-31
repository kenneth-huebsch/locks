import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { FOUNDATION_GAME_ITEM } from '../shared/foundation.js';
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

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: FOUNDATION_GAME_ITEM,
  }),
);

console.log(`Seeded ${FOUNDATION_GAME_ITEM.SK} in ${tableName}`);
