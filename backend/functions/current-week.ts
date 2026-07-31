import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  FOUNDATION_WEEK,
  FOUNDATION_WEEK_KEY,
  type ApiErrorResponse,
  type CurrentWeekResponse,
  type FoundationGame,
} from '../../shared/foundation.js';

interface DynamoQueryClient {
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

function toGame(item: Record<string, unknown>): FoundationGame {
  return {
    id: item.id as string,
    awayTeam: item.awayTeam as string,
    homeTeam: item.homeTeam as string,
    commenceTime: item.commenceTime as string,
    status: item.status as FoundationGame['status'],
  };
}

export function createCurrentWeekHandler(
  client: DynamoQueryClient,
  tableName: string,
  logger: Pick<Console, 'error'> = console,
): () => Promise<LambdaResponse> {
  return async () => {
    try {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :game)',
          ExpressionAttributeValues: {
            ':pk': FOUNDATION_WEEK_KEY,
            ':game': 'GAME#',
          },
        }),
      );

      const response: CurrentWeekResponse = {
        ...FOUNDATION_WEEK,
        games: (result.Items ?? []).map(toGame),
      };

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(response),
      };
    } catch (error) {
      logger.error('Failed to load the current week', error);
      const response: ApiErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to load the current week',
        },
      };

      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify(response),
      };
    }
  };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(): Promise<LambdaResponse> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME is required');
  }

  return createCurrentWeekHandler(documentClient, tableName)();
}
