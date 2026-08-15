import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  counterSortKey,
  gameSortKey,
  pickSortKey,
  playerPartitionKey,
  seasonWeekToken,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import { ErrorCodes } from '../../shared/types.js';
import {
  createSubmitPickHandler,
  type ApiGatewayJwtEvent,
  type Clock,
  type DynamoSubmitPickClient,
} from './submit-pick.js';

const TABLE_NAME = 'locks';
const PLAYER_SUB = 'cognito-sub-123';
const SEASON = 2026;
const WEEK = 1;
const GAME_ID = 'event-abc';
const NOW = new Date('2026-09-09T12:00:00.000Z');

const baseGame = {
  PK: weekPartitionKey(SEASON, WEEK),
  SK: gameSortKey(GAME_ID),
  id: GAME_ID,
  awayTeam: 'Dallas Cowboys',
  homeTeam: 'Philadelphia Eagles',
  awayAbbr: 'DAL',
  homeAbbr: 'PHI',
  commenceTime: '2026-09-10T00:20:00.000Z',
  awaySpread: 3.5,
  homeSpread: -3.5,
  status: 'scheduled',
  bookmaker: 'draftkings',
  oddsUpdatedAt: '2026-09-09T10:00:00.000Z',
};

const validRequest = {
  gameId: GAME_ID,
  pickedTeam: 'Dallas Cowboys',
  spreadAtPick: 3.5,
};

function createEvent(body: unknown): ApiGatewayJwtEvent {
  return {
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: PLAYER_SUB,
          },
        },
      },
    },
  };
}

function createHandler(
  send: ReturnType<typeof vi.fn>,
  clock: Clock = { now: () => NOW },
) {
  const client = { send } as DynamoSubmitPickClient;
  return createSubmitPickHandler({
    dynamoClient: client,
    clock,
    tableName: TABLE_NAME,
    fallbackSeason: SEASON,
    fallbackWeek: WEEK,
    logger: { error: vi.fn() },
  });
}

function transactionCanceled(
  reasonCodes: Array<string | undefined>,
): Error & { CancellationReasons: Array<{ Code?: string }> } {
  const error = new Error('Transaction cancelled') as Error & {
    CancellationReasons: Array<{ Code?: string }>;
  };
  error.name = 'TransactionCanceledException';
  error.CancellationReasons = reasonCodes.map((code) => ({ Code: code }));
  return error;
}

describe('submit-pick handler', () => {
  it('inserts a valid pick and increments the weekly counter', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON } })
      .mockResolvedValueOnce({});
    const handler = createHandler(send);

    const response = await handler(createEvent(validRequest));

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.pick).toEqual({
      playerId: PLAYER_SUB,
      gameId: GAME_ID,
      seasonWeek: seasonWeekToken(SEASON, WEEK),
      pickedTeam: 'Dallas Cowboys',
      spreadAtPick: 3.5,
      submittedAt: NOW.toISOString(),
      result: 'pending',
    });

    const transactCall = send.mock.calls.find(
      ([command]) => command instanceof TransactWriteCommand,
    );
    expect(transactCall).toBeDefined();
    const transactInput = transactCall![0].input;
    expect(transactInput.TransactItems).toHaveLength(3);
    expect(transactInput.TransactItems[1].Put?.Item).toMatchObject({
      PK: playerPartitionKey(PLAYER_SUB),
      SK: pickSortKey(SEASON, WEEK, GAME_ID),
    });
    expect(transactInput.TransactItems[2].Update?.UpdateExpression).toContain(
      'ADD pickCount :one',
    );
  });

  it('uses SEASON#ACTIVE week as the pick source of truth', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON, week: 2 } })
      .mockResolvedValueOnce({});
    const handler = createHandler(send);

    const response = await handler(createEvent(validRequest));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).pick.seasonWeek).toBe('2026#W02');
    const transactCall = send.mock.calls.find(
      ([command]) => command instanceof TransactWriteCommand,
    );
    expect(transactCall?.[0].input.TransactItems?.[0].ConditionCheck?.Key).toEqual(
      {
        PK: 'WEEK#2026#W02',
        SK: `GAME#${GAME_ID}`,
      },
    );
  });

  it('returns GAME_STARTED when commence_time is in the past', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON } })
      .mockRejectedValueOnce(
        transactionCanceled(['ConditionalCheckFailed', undefined, undefined]),
      )
      .mockResolvedValueOnce({
        Item: {
          ...baseGame,
          commenceTime: '2026-09-09T00:00:00.000Z',
        },
      });
    const handler = createHandler(send);

    const response = await handler(createEvent(validRequest));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: ErrorCodes.GAME_STARTED,
        message: 'This game has already started',
      },
    });
  });

  it('returns STALE_LINES when the spread does not match the cached game', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON } })
      .mockRejectedValueOnce(
        transactionCanceled(['ConditionalCheckFailed', undefined, undefined]),
      )
      .mockResolvedValueOnce({ Item: baseGame });
    const handler = createHandler(send);

    const response = await handler(
      createEvent({
        ...validRequest,
        spreadAtPick: 7,
      }),
    );

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: ErrorCodes.STALE_LINES,
        message:
          'The submitted team or spread no longer matches the cached game',
      },
    });
  });

  it('returns DUPLICATE_PICK when the player already picked the game', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON } })
      .mockRejectedValueOnce(
        transactionCanceled([undefined, 'ConditionalCheckFailed', undefined]),
      );
    const handler = createHandler(send);

    const response = await handler(createEvent(validRequest));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: ErrorCodes.DUPLICATE_PICK,
        message: 'You have already submitted a pick for this game',
      },
    });
  });

  it('returns WEEKLY_LIMIT when the player already has three picks', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON } })
      .mockRejectedValueOnce(
        transactionCanceled([undefined, undefined, 'ConditionalCheckFailed']),
      );
    const handler = createHandler(send);

    const response = await handler(createEvent(validRequest));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: ErrorCodes.WEEKLY_LIMIT,
        message: 'You have already submitted three picks this week',
      },
    });
  });

  it('returns GAME_NOT_FOUND when the game item is missing', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: SEASON } })
      .mockRejectedValueOnce(
        transactionCanceled(['ConditionalCheckFailed', undefined, undefined]),
      )
      .mockResolvedValueOnce({ Item: undefined });
    const handler = createHandler(send);

    const response = await handler(createEvent(validRequest));

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: ErrorCodes.GAME_NOT_FOUND,
        message: 'Game not found',
      },
    });
    expect(send).toHaveBeenCalledWith(expect.any(GetCommand));
  });

  it('returns 400 for a malformed request body', async () => {
    const send = vi.fn();
    const handler = createHandler(send);

    const response = await handler({
      body: JSON.stringify({ gameId: GAME_ID }),
      requestContext: {
        authorizer: {
          jwt: {
            claims: { sub: PLAYER_SUB },
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { message: 'Invalid request body' },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('reads the active season pointer before submitting', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { season: 2027 } })
      .mockResolvedValueOnce({});
    const handler = createHandler(send);

    await handler(createEvent(validRequest));

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input.Key).toEqual({
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
    });

    const transactInput = send.mock.calls[1][0].input;
    expect(transactInput.TransactItems[1].Put?.Item?.SK).toBe(
      pickSortKey(2027, WEEK, GAME_ID),
    );
    expect(transactInput.TransactItems[2].Update?.Key?.SK).toBe(
      counterSortKey(2027, WEEK),
    );
  });
});
