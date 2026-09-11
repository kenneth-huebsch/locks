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
  gameSortKey,
  playerPartitionKey,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import {
  formatPickNotification,
  isSwingAgainstPeers,
} from '../../shared/push-copy.js';
import { LEAGUE_ROSTER } from '../../shared/roster.js';
import type { Game, NotifyPickEvent, Pick as PickRecord } from '../../shared/types.js';

export interface DynamoNotifyClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  playerId: string;
}

export interface PushSender {
  send(
    subscription: StoredPushSubscription,
    payload: string,
    vapid: { publicKey: string; privateKey: string },
  ): Promise<'ok' | 'gone'>;
}

interface NotifyPickDependencies {
  dynamoClient: DynamoNotifyClient;
  tableName: string;
  pushSender: PushSender;
  roster?: typeof LEAGUE_ROSTER;
  logger?: Pick<Console, 'error' | 'warn'>;
}

const GSI1_INDEX_NAME = 'GSI1';
const VAPID_SUBJECT = 'mailto:kenneth.huebsch@gmail.com';

function toGame(item: Record<string, unknown>): Game | null {
  if (
    typeof item.id !== 'string' ||
    typeof item.awayTeam !== 'string' ||
    typeof item.homeTeam !== 'string'
  ) {
    return null;
  }

  return {
    id: item.id,
    awayTeam: item.awayTeam,
    homeTeam: item.homeTeam,
    awayAbbr: typeof item.awayAbbr === 'string' ? item.awayAbbr : '',
    homeAbbr: typeof item.homeAbbr === 'string' ? item.homeAbbr : '',
    commenceTime: typeof item.commenceTime === 'string' ? item.commenceTime : '',
    awaySpread: typeof item.awaySpread === 'number' ? item.awaySpread : 0,
    homeSpread: typeof item.homeSpread === 'number' ? item.homeSpread : 0,
    awayScore: null,
    homeScore: null,
    status: 'scheduled',
    bookmaker: '',
    oddsUpdatedAt: '',
  };
}

function toPick(item: Record<string, unknown>): PickRecord | null {
  if (
    typeof item.playerId !== 'string' ||
    typeof item.gameId !== 'string' ||
    typeof item.pickedTeam !== 'string'
  ) {
    return null;
  }

  return {
    playerId: item.playerId,
    gameId: item.gameId,
    seasonWeek: typeof item.seasonWeek === 'string' ? item.seasonWeek : '',
    pickedTeam: item.pickedTeam,
    spreadAtPick: typeof item.spreadAtPick === 'number' ? item.spreadAtPick : 0,
    submittedAt: typeof item.submittedAt === 'string' ? item.submittedAt : '',
    result: 'pending',
  };
}

function isNotifyPickEvent(value: unknown): value is NotifyPickEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as NotifyPickEvent;
  return (
    typeof event.pickerSub === 'string' &&
    event.pickerSub.length > 0 &&
    typeof event.gameId === 'string' &&
    event.gameId.length > 0 &&
    typeof event.pickedTeam === 'string' &&
    event.pickedTeam.length > 0 &&
    typeof event.spreadAtPick === 'number' &&
    typeof event.season === 'number' &&
    typeof event.week === 'number'
  );
}

export function createNotifyPickHandler(
  dependencies: NotifyPickDependencies,
): (event: NotifyPickEvent) => Promise<void> {
  const logger = dependencies.logger ?? console;
  const roster = dependencies.roster ?? LEAGUE_ROSTER;

  return async (event) => {
    if (!isNotifyPickEvent(event)) {
      logger.warn('Ignoring malformed notify-pick event');
      return;
    }

    const weekPk = weekPartitionKey(event.season, event.week);
    const [gameResult, picksResult, vapidResult] = await Promise.all([
      dependencies.dynamoClient.send(
        new GetCommand({
          TableName: dependencies.tableName,
          Key: {
            PK: weekPk,
            SK: gameSortKey(event.gameId),
          },
        }),
      ),
      dependencies.dynamoClient.send(
        new QueryCommand({
          TableName: dependencies.tableName,
          IndexName: GSI1_INDEX_NAME,
          KeyConditionExpression: 'GSI1PK = :weekPk',
          FilterExpression: 'begins_with(SK, :pickPrefix)',
          ExpressionAttributeValues: {
            ':weekPk': weekPk,
            ':pickPrefix': 'PICK#',
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

    const game = gameResult.Item ? toGame(gameResult.Item) : null;
    if (!game) {
      logger.warn('Skipping pick notification; game was not found', {
        gameId: event.gameId,
      });
      return;
    }

    const publicKey = vapidResult.Item?.publicKey;
    const privateKey = vapidResult.Item?.privateKey;
    if (typeof publicKey !== 'string' || typeof privateKey !== 'string') {
      logger.warn('Skipping pick notification; VAPID keys are missing');
      return;
    }

    const picks = (picksResult.Items ?? [])
      .map((item) => toPick(item))
      .filter((item): item is PickRecord => item !== null);
    const displayName =
      roster.find((player) => player.sub === event.pickerSub)?.displayName ??
      'Someone';
    const payload = formatPickNotification({
      displayName,
      pickedTeam: event.pickedTeam,
      spreadAtPick: event.spreadAtPick,
      isSwing: isSwingAgainstPeers(
        event.pickerSub,
        event.pickedTeam,
        event.gameId,
        picks,
        game,
      ),
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
          .map((item) => {
            if (
              typeof item.endpoint !== 'string' ||
              typeof item.p256dh !== 'string' ||
              typeof item.auth !== 'string' ||
              typeof item.SK !== 'string'
            ) {
              return null;
            }

            return {
              endpoint: item.endpoint,
              p256dh: item.p256dh,
              auth: item.auth,
              playerId: player.sub,
              sortKey: item.SK,
            };
          })
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
        logger.error('Failed to send pick push notification', error);
      }
    }
  };
}

export function createWebPushSender(): PushSender {
  return {
    async send(subscription, payload, vapid) {
      const webPush = await import('web-push');
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          {
            vapidDetails: {
              subject: VAPID_SUBJECT,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
          },
        );
        return 'ok';
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          return 'gone';
        }
        throw error;
      }
    },
  };
}

let runtimeHandler: ((event: NotifyPickEvent) => Promise<void>) | undefined;

async function getRuntimeHandler(): Promise<
  (event: NotifyPickEvent) => Promise<void>
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

  runtimeHandler = createNotifyPickHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName,
    pushSender: createWebPushSender(),
  });
  return runtimeHandler;
}

export async function handler(event: NotifyPickEvent): Promise<void> {
  const run = await getRuntimeHandler();
  await run(event);
}
