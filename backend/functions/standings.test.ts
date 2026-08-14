import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  pickGsi1PartitionKey,
  pickGsi1SortKey,
  pickSortKey,
  playerPartitionKey,
  seasonWeekToken,
} from '../../shared/dynamo.js';
import { FOUNDATION_WEEK } from '../../shared/foundation.js';
import {
  createStandingsHandler,
  type ApiGatewayJwtEvent,
  type DynamoStandingsClient,
} from './standings.js';

const TABLE_NAME = 'locks-table';
const PLAYER_SUB = 'cognito-sub-123';
const SEASON = 2026;
const WEEK = 2;
const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';

function createEvent(sub: string = PLAYER_SUB): ApiGatewayJwtEvent {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: { sub },
        },
      },
    },
  };
}

function createHandler(send: ReturnType<typeof vi.fn>) {
  const client = { send } as DynamoStandingsClient;
  return createStandingsHandler({
    dynamoClient: client,
    tableName: TABLE_NAME,
    logger: { error: vi.fn() },
  });
}

function activeSeasonGet(week = WEEK) {
  return {
    Item: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
      season: SEASON,
      week,
    },
  };
}

function pickItem(
  playerId: string,
  week: number,
  gameId: string,
  result: 'win' | 'loss' | 'push' | 'pending',
) {
  return {
    PK: playerPartitionKey(playerId),
    SK: pickSortKey(SEASON, week, gameId),
    GSI1PK: pickGsi1PartitionKey(SEASON, week),
    GSI1SK: pickGsi1SortKey(playerId, gameId),
    playerId,
    gameId,
    seasonWeek: seasonWeekToken(SEASON, week),
    pickedTeam: 'Team',
    spreadAtPick: -3,
    submittedAt: '2026-09-09T11:00:00.000Z',
    result,
  };
}

describe('standings handler', () => {
  it('returns 500 when the JWT sub is missing', async () => {
    const handler = createHandler(vi.fn());
    const response = await handler({
      requestContext: { authorizer: { jwt: { claims: {} } } },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authenticated player identity is missing',
      },
    });
  });

  it('returns empty standings when there are no picks', async () => {
    const send = vi.fn(async (command) => {
      if (command instanceof GetCommand) {
        return activeSeasonGet(1);
      }
      if (command instanceof QueryCommand) {
        return { Items: [] };
      }
      throw new Error('unexpected command');
    });

    const handler = createHandler(send);
    const response = await handler(createEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      season: SEASON,
      currentWeek: 1,
      players: [],
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns foundation empty standings when active season metadata is missing', async () => {
    const send = vi.fn(async (command) => {
      if (command instanceof GetCommand) {
        return {};
      }
      throw new Error('unexpected command');
    });

    const handler = createHandler(send);
    const response = await handler(createEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      season: FOUNDATION_WEEK.season,
      currentWeek: FOUNDATION_WEEK.week,
      players: [],
    });
  });

  it('computes mixed season and weekly records from GSI week queries', async () => {
    const send = vi.fn(async (command) => {
      if (command instanceof GetCommand) {
        return activeSeasonGet();
      }
      if (command instanceof QueryCommand) {
        const weekPk = command.input.ExpressionAttributeValues?.[':weekPk'];
        if (weekPk === pickGsi1PartitionKey(SEASON, 1)) {
          return {
            Items: [
              pickItem(PLAYER_A, 1, 'g1', 'win'),
              pickItem(PLAYER_A, 1, 'g2', 'loss'),
              pickItem(PLAYER_B, 1, 'g1', 'push'),
            ],
          };
        }
        if (weekPk === pickGsi1PartitionKey(SEASON, 2)) {
          return {
            Items: [
              pickItem(PLAYER_A, 2, 'g3', 'win'),
              pickItem(PLAYER_B, 2, 'g2', 'loss'),
            ],
          };
        }
        return { Items: [] };
      }
      throw new Error('unexpected command');
    });

    const handler = createHandler(send);
    const response = await handler(createEvent());
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.season).toBe(SEASON);
    expect(body.currentWeek).toBe(WEEK);
    expect(body.players).toEqual([
      {
        playerId: PLAYER_A,
        season: { wins: 2, losses: 1, pushes: 0 },
        weeks: [
          {
            season: SEASON,
            week: 1,
            seasonWeek: '2026#W01',
            isCurrent: false,
            record: { wins: 1, losses: 1, pushes: 0 },
          },
          {
            season: SEASON,
            week: 2,
            seasonWeek: '2026#W02',
            isCurrent: true,
            record: { wins: 1, losses: 0, pushes: 0 },
          },
        ],
      },
      {
        playerId: PLAYER_B,
        season: { wins: 0, losses: 1, pushes: 1 },
        weeks: [
          {
            season: SEASON,
            week: 1,
            seasonWeek: '2026#W01',
            isCurrent: false,
            record: { wins: 0, losses: 0, pushes: 1 },
          },
          {
            season: SEASON,
            week: 2,
            seasonWeek: '2026#W02',
            isCurrent: true,
            record: { wins: 0, losses: 1, pushes: 0 },
          },
        ],
      },
    ]);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
