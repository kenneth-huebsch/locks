import { createHash } from 'node:crypto';
import {
  GetCommand,
  PutCommand,
  type GetCommandOutput,
  type PutCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  PUSH_CONFIG_PARTITION_KEY,
  PUSH_VAPID_SORT_KEY,
  playerPartitionKey,
  pushSubscriptionSortKey,
} from '../../shared/dynamo.js';
import {
  ErrorCodes,
  type ApiErrorResponse,
  type PushSubscriptionRequest,
  type PushVapidResponse,
} from '../../shared/types.js';

export interface ApiGatewayJwtEvent {
  routeKey?: string;
  body?: string;
  requestContext: {
    authorizer?: {
      jwt?: {
        claims: Record<string, string>;
      };
    };
  };
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface DynamoPushClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
}

interface PushSubscriptionDependencies {
  dynamoClient: DynamoPushClient;
  tableName: string;
  generateVapidKeys: () => VapidKeyPair;
  logger?: Pick<Console, 'error'>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

function jsonResponse(statusCode: number, body: unknown): LambdaResponse {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function apiError(
  statusCode: number,
  message: string,
  code: ApiErrorResponse['error']['code'] = ErrorCodes.INTERNAL_ERROR,
): LambdaResponse {
  return jsonResponse(statusCode, {
    error: { code, message },
  } satisfies ApiErrorResponse);
}

function getPlayerSub(event: ApiGatewayJwtEvent): string | null {
  const sub = event.requestContext.authorizer?.jwt?.claims.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function parseSubscription(
  body: string | undefined,
): PushSubscriptionRequest | null {
  if (!body) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as PushSubscriptionRequest;
  if (
    typeof candidate.endpoint !== 'string' ||
    candidate.endpoint.length === 0 ||
    typeof candidate.keys !== 'object' ||
    candidate.keys === null ||
    typeof candidate.keys.p256dh !== 'string' ||
    candidate.keys.p256dh.length === 0 ||
    typeof candidate.keys.auth !== 'string' ||
    candidate.keys.auth.length === 0
  ) {
    return null;
  }

  return {
    endpoint: candidate.endpoint,
    expirationTime:
      typeof candidate.expirationTime === 'number'
        ? candidate.expirationTime
        : null,
    keys: {
      p256dh: candidate.keys.p256dh,
      auth: candidate.keys.auth,
    },
  };
}

async function loadOrCreateVapidKeys(
  dependencies: PushSubscriptionDependencies,
): Promise<VapidKeyPair> {
  const existing = await dependencies.dynamoClient.send(
    new GetCommand({
      TableName: dependencies.tableName,
      Key: {
        PK: PUSH_CONFIG_PARTITION_KEY,
        SK: PUSH_VAPID_SORT_KEY,
      },
    }),
  );
  const publicKey = existing.Item?.publicKey;
  const privateKey = existing.Item?.privateKey;
  if (typeof publicKey === 'string' && typeof privateKey === 'string') {
    return { publicKey, privateKey };
  }

  const generated = dependencies.generateVapidKeys();
  try {
    await dependencies.dynamoClient.send(
      new PutCommand({
        TableName: dependencies.tableName,
        Item: {
          PK: PUSH_CONFIG_PARTITION_KEY,
          SK: PUSH_VAPID_SORT_KEY,
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return generated;
  } catch {
    const raced = await dependencies.dynamoClient.send(
      new GetCommand({
        TableName: dependencies.tableName,
        Key: {
          PK: PUSH_CONFIG_PARTITION_KEY,
          SK: PUSH_VAPID_SORT_KEY,
        },
      }),
    );
    if (
      typeof raced.Item?.publicKey === 'string' &&
      typeof raced.Item.privateKey === 'string'
    ) {
      return {
        publicKey: raced.Item.publicKey,
        privateKey: raced.Item.privateKey,
      };
    }
    throw new Error('Unable to load VAPID keys');
  }
}

export function createPushSubscriptionHandler(
  dependencies: PushSubscriptionDependencies,
): (event: ApiGatewayJwtEvent) => Promise<LambdaResponse> {
  const logger = dependencies.logger ?? console;

  return async (event) => {
    const playerSub = getPlayerSub(event);
    if (!playerSub) {
      return apiError(500, 'Authenticated player identity is missing');
    }

    try {
      if (event.routeKey === 'GET /api/push/vapid') {
        const keys = await loadOrCreateVapidKeys(dependencies);
        return jsonResponse(200, {
          publicKey: keys.publicKey,
        } satisfies PushVapidResponse);
      }

      if (event.routeKey === 'PUT /api/push/subscription') {
        const subscription = parseSubscription(event.body);
        if (!subscription) {
          return apiError(400, 'Invalid push subscription');
        }

        await dependencies.dynamoClient.send(
          new PutCommand({
            TableName: dependencies.tableName,
            Item: {
              PK: playerPartitionKey(playerSub),
              SK: pushSubscriptionSortKey(endpointHash(subscription.endpoint)),
              endpoint: subscription.endpoint,
              expirationTime: subscription.expirationTime,
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
              invalid: false,
            },
          }),
        );
        return {
          statusCode: 204,
          headers: JSON_HEADERS,
          body: '',
        };
      }

      return apiError(400, 'Unsupported route');
    } catch (error) {
      logger.error('Failed to handle push subscription request', error);
      return apiError(500, 'Unable to save push subscription');
    }
  };
}

let runtimeHandler:
  | ((event: ApiGatewayJwtEvent) => Promise<LambdaResponse>)
  | undefined;

async function getRuntimeHandler(): Promise<
  (event: ApiGatewayJwtEvent) => Promise<LambdaResponse>
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
  const webPush = await import('web-push');

  runtimeHandler = createPushSubscriptionHandler({
    dynamoClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName,
    generateVapidKeys: () => webPush.generateVAPIDKeys(),
  });
  return runtimeHandler;
}

export async function handler(
  event: ApiGatewayJwtEvent,
): Promise<LambdaResponse> {
  const run = await getRuntimeHandler();
  return run(event);
}
