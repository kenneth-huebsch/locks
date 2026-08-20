import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  counterSortKey,
  playerPartitionKey,
} from '../../shared/dynamo.js';
import {
  createIncompletePicksHandler,
  type ApiGatewayApiKeyEvent,
  type DynamoIncompletePicksClient,
  type SsmClient,
} from './incomplete-picks.js';

const TABLE_NAME = 'locks-table';
const API_KEY = 'test-reminder-api-key';
const SEASON = 2026;
const WEEK = 3;

const ROSTER = [
  {
    sub: 'sub-kenny',
    displayName: 'Kenny',
    portraitUrl: '/players/kenny.jpg',
  },
  {
    sub: 'sub-jack',
    displayName: 'Jack',
    portraitUrl: '/players/jack.jpg',
  },
  {
    sub: 'sub-eric',
    displayName: 'Eric',
    portraitUrl: '/players/eric.jpg',
  },
] as const;

function createEvent(apiKey?: string): ApiGatewayApiKeyEvent {
  return {
    headers: apiKey === undefined ? {} : { 'x-api-key': apiKey },
  };
}

function createHandler(options?: {
  dynamoSend?: ReturnType<typeof vi.fn>;
  ssmSend?: ReturnType<typeof vi.fn>;
}) {
  const dynamoSend =
    options?.dynamoSend ??
    vi.fn(async () => ({
      Item: {
        PK: ACTIVE_SEASON_PARTITION_KEY,
        SK: ACTIVE_SEASON_SORT_KEY,
        season: SEASON,
        week: WEEK,
      },
    }));
  const ssmSend =
    options?.ssmSend ??
    vi.fn(async () => ({
      Parameter: { Value: API_KEY },
    }));

  return createIncompletePicksHandler({
    dynamoClient: { send: dynamoSend } as DynamoIncompletePicksClient,
    ssmClient: { send: ssmSend } as SsmClient,
    tableName: TABLE_NAME,
    roster: ROSTER,
    logger: { error: vi.fn(), warn: vi.fn() },
  });
}

describe('incomplete-picks handler', () => {
  it('returns 401 when the API key header is missing', async () => {
    const handler = createHandler();
    const response = await handler(createEvent());

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.message).toBe('Missing API key');
  });

  it('returns 401 when the API key does not match', async () => {
    const handler = createHandler();
    const response = await handler(createEvent('wrong-key'));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.message).toBe('Invalid API key');
  });

  it('returns 401 when the SSM parameter is missing', async () => {
    const ssmSend = vi.fn(async () => {
      const error = new Error('ParameterNotFound');
      error.name = 'ParameterNotFound';
      throw error;
    });
    const handler = createHandler({ ssmSend });
    const response = await handler(createEvent(API_KEY));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.message).toBe('Invalid API key');
    expect(ssmSend).toHaveBeenCalledWith(expect.any(GetParameterCommand));
  });

  it('returns only players under the weekly pick limit', async () => {
    const dynamoSend = vi.fn(async (command: GetCommand) => {
      const key = command.input.Key as { PK: string; SK: string };
      if (
        key.PK === ACTIVE_SEASON_PARTITION_KEY &&
        key.SK === ACTIVE_SEASON_SORT_KEY
      ) {
        return {
          Item: {
            PK: ACTIVE_SEASON_PARTITION_KEY,
            SK: ACTIVE_SEASON_SORT_KEY,
            season: SEASON,
            week: WEEK,
          },
        };
      }
      if (key.PK === playerPartitionKey('sub-kenny')) {
        return {
          Item: {
            PK: key.PK,
            SK: counterSortKey(SEASON, WEEK),
            pickCount: 1,
          },
        };
      }
      if (key.PK === playerPartitionKey('sub-jack')) {
        return {
          Item: {
            PK: key.PK,
            SK: counterSortKey(SEASON, WEEK),
            pickCount: 3,
          },
        };
      }
      return {};
    });

    const handler = createHandler({ dynamoSend });
    const response = await handler(createEvent(API_KEY));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      seasonWeek: '2026#W03',
      maxPicks: 3,
      incomplete: [
        {
          displayName: 'Kenny',
          sub: 'sub-kenny',
          pickCount: 1,
          remainingPicks: 2,
        },
        {
          displayName: 'Eric',
          sub: 'sub-eric',
          pickCount: 0,
          remainingPicks: 3,
        },
      ],
    });
  });

  it('returns an empty incomplete list when everyone has three picks', async () => {
    const dynamoSend = vi.fn(async (command: GetCommand) => {
      const key = command.input.Key as { PK: string; SK: string };
      if (
        key.PK === ACTIVE_SEASON_PARTITION_KEY &&
        key.SK === ACTIVE_SEASON_SORT_KEY
      ) {
        return {
          Item: {
            PK: ACTIVE_SEASON_PARTITION_KEY,
            SK: ACTIVE_SEASON_SORT_KEY,
            season: SEASON,
            week: WEEK,
          },
        };
      }
      return {
        Item: {
          PK: key.PK,
          SK: key.SK,
          pickCount: 3,
        },
      };
    });

    const handler = createHandler({ dynamoSend });
    const response = await handler(createEvent(API_KEY));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      seasonWeek: '2026#W03',
      maxPicks: 3,
      incomplete: [],
    });
  });
});
