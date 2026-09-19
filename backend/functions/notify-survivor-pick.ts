import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
  type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_SUBSCRIPTION_SORT_PREFIX,
  PUSH_VAPID_SORT_KEY,
  playerPartitionKey,
} from '../../shared/dynamo.js';
import { formatSurvivorPickNotification } from '../../shared/push-copy.js';
import { LEAGUE_ROSTER } from '../../shared/roster.js';
import type { NotifySurvivorPickEvent } from '../../shared/types.js';
import {
  createWebPushSender,
  parseStoredPushSubscription,
  type PushSender,
  type StoredPushSubscription,
} from '../lib/web-push-sender.js';

export interface DynamoNotifySurvivorClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

interface NotifySurvivorDependencies {
  dynamoClient: DynamoNotifySurvivorClient;
  tableName: string;
  pushSender: PushSender;
  roster?: typeof LEAGUE_ROSTER;
  logger?: Pick<Console, 'error' | 'warn'>;
}

function isNotifySurvivorPickEvent(
  value: unknown,
): value is NotifySurvivorPickEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const event = value as NotifySurvivorPickEvent;
  return (
    typeof event.pickerSub === 'string' &&
    event.pickerSub.length > 0 &&
    typeof event.gameId === 'string' &&
    event.gameId.length > 0 &&
    typeof event.pickedTeam === 'string' &&
    event.pickedTeam.length > 0 &&
    typeof event.season === 'number' &&
    typeof event.week === 'number'
  );
}

export function createNotifySurvivorPickHandler(
  dependencies: NotifySurvivorDependencies,
): (event: NotifySurvivorPickEvent) => Promise<void> {
  const logger = dependencies.logger ?? console;
  const roster = dependencies.roster ?? LEAGUE_ROSTER;

  return async (event) => {
    if (!isNotifySurvivorPickEvent(event)) {
      logger.warn('Ignoring malformed notify-survivor-pick event');
      return;
    }

    const vapidResult = await dependencies.dynamoClient.send(
      new GetCommand({
        TableName: dependencies.tableName,
        Key: {
          PK: PUSH_CONFIG_PARTITION_KEY,
          SK: PUSH_VAPID_SORT_KEY,
        },
      }),
    );

    const publicKey = vapidResult.Item?.publicKey;
    const privateKey = vapidResult.Item?.privateKey;
    if (typeof publicKey !== 'string' || typeof privateKey !== 'string') {
      logger.warn('Skipping survivor pick notification; VAPID keys are missing');
      return;
    }

    const displayName =
      roster.find((player) => player.sub === event.pickerSub)?.displayName ??
      'Someone';
    const payload = formatSurvivorPickNotification({
      displayName,
      pickedTeam: event.pickedTeam,
    });

    const recipients = roster.filter((player) => player.sub !== event.pickerSub);
    const subscriptionBatches = await Promise.all(
      recipients.map(async (player) => {
        const result = await dependencies.dynamoClient.send(
          new QueryCommand({
            TableName: dependencies.tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            FilterExpression: 'attribute_not_exists(invalid) OR invalid = :false',
            ExpressionAttributeValues: {
              ':pk': playerPartitionKey(player.sub),
              ':prefix': PUSH_SUBSCRIPTION_SORT_PREFIX,
              ':false': false,
            },
          }),
        );
        return (result.Items ?? [])
          .map((item) => parseStoredPushSubscription(item, player.sub))
          .filter(
            (
              item,
            ): item is StoredPushSubscription & { sortKey: string } =>
              item !== null,
          );
      }),
    );

    for (const subscription of subscriptionBatches.flat()) {
      try {
        const result = await dependencies.pushSender.send(
          subscription,
          payload,
          { publicKey, privateKey },
        );
        if (result === 'gone') {
          await dependencies.dynamoClient.send(
            new UpdateCommand({
              TableName: dependencies.tableName,
              Key: {
                PK: playerPartitionKey(subscription.playerId),
                SK: subscription.sortKey,
              },
              UpdateExpression: 'SET invalid = :true',
              ExpressionAttributeValues: { ':true': true },
            }),
          );
        }
      } catch (error) {
        logger.error('Failed to send survivor pick push notification', error);
      }
    }
  };
}

let runtimeHandler:
  | ((event: NotifySurvivorPickEvent) => Promise<void>)
  | undefined;

async function getRuntimeHandler(): Promise<
  (event: NotifySurvivorPickEvent) => Promise<void>
> {
  if (runtimeHandler) {
    return runtimeHandler;
  }

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME is required');
  }

  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

  runtimeHandler = createNotifySurvivorPickHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName,
    pushSender: createWebPushSender(),
  });
  return runtimeHandler;
}

export async function handler(event: NotifySurvivorPickEvent): Promise<void> {
  const run = await getRuntimeHandler();
  await run(event);
}
