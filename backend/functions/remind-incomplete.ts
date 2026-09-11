import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
  type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_SUBSCRIPTION_SORT_PREFIX,
  PUSH_VAPID_SORT_KEY,
  counterSortKey,
  playerPartitionKey,
} from '../../shared/dynamo.js';
import { formatIncompleteReminder } from '../../shared/push-copy.js';
import { LEAGUE_ROSTER } from '../../shared/roster.js';
import {
  createWebPushSender,
  parseStoredPushSubscription,
  type PushSender,
  type StoredPushSubscription,
} from '../lib/web-push-sender.js';

export interface DynamoRemindClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

interface RemindIncompleteDependencies {
  dynamoClient: DynamoRemindClient;
  tableName: string;
  pushSender: PushSender;
  roster?: typeof LEAGUE_ROSTER;
  logger?: Pick<Console, 'error' | 'warn'>;
}

const MAX_WEEKLY_PICKS = 3;

function toPickCount(item: Record<string, unknown> | undefined): number {
  const value = item?.pickCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function createRemindIncompleteHandler(
  dependencies: RemindIncompleteDependencies,
): () => Promise<void> {
  const logger = dependencies.logger ?? console;
  const roster = dependencies.roster ?? LEAGUE_ROSTER;

  return async () => {
    const [activeSeason, vapidResult] = await Promise.all([
      dependencies.dynamoClient.send(
        new GetCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: ACTIVE_SEASON_PARTITION_KEY,
            SK: ACTIVE_SEASON_SORT_KEY,
          },
        }),
      ),
      dependencies.dynamoClient.send(
        new GetCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: PUSH_CONFIG_PARTITION_KEY,
            SK: PUSH_VAPID_SORT_KEY,
          },
        }),
      ),
    ]);

    const season = activeSeason.Item?.season;
    const week = activeSeason.Item?.week;
    if (typeof season !== 'number' || typeof week !== 'number') {
      logger.warn('Skipping incomplete reminder; active season is not configured');
      return;
    }

    const publicKey = vapidResult.Item?.publicKey;
    const privateKey = vapidResult.Item?.privateKey;
    if (typeof publicKey !== 'string' || typeof privateKey !== 'string') {
      logger.warn('Skipping incomplete reminder; VAPID keys are missing');
      return;
    }

    const counters = await Promise.all(
      roster.map((player) =>
        dependencies.dynamoClient.send(
          new GetCommand({
            TableName: dependencies.tableName,
            Key: {
              PK: playerPartitionKey(player.sub),
              SK: counterSortKey(season, week),
            },
          }),
        ),
      ),
    );

    const incomplete = roster.flatMap((player, index) => {
      const pickCount = toPickCount(
        counters[index]?.Item as Record<string, unknown> | undefined,
      );
      if (pickCount >= MAX_WEEKLY_PICKS) {
        return [];
      }
      return [
        {
          player,
          remainingPicks: MAX_WEEKLY_PICKS - pickCount,
        },
      ];
    });

    const subscriptionBatches = await Promise.all(
      incomplete.map(async ({ player, remainingPicks }) => {
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
        const subscriptions = (result.Items ?? [])
          .map((item) => parseStoredPushSubscription(item, player.sub))
          .filter(
            (
              item,
            ): item is StoredPushSubscription & { sortKey: string } =>
              item !== null,
          );
        return {
          remainingPicks,
          subscriptions,
        };
      }),
    );

    for (const { remainingPicks, subscriptions } of subscriptionBatches) {
      const payload = formatIncompleteReminder(remainingPicks);
      for (const subscription of subscriptions) {
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
          logger.error('Failed to send incomplete-picks push notification', error);
        }
      }
    }
  };
}

let runtimeHandler: (() => Promise<void>) | undefined;

async function getRuntimeHandler(): Promise<() => Promise<void>> {
  if (runtimeHandler) {
    return runtimeHandler;
  }

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME is required');
  }

  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

  runtimeHandler = createRemindIncompleteHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName,
    pushSender: createWebPushSender(),
  });
  return runtimeHandler;
}

export async function handler(): Promise<void> {
  const run = await getRuntimeHandler();
  await run();
}
