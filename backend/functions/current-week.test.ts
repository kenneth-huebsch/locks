import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  WEEK_META_SORT_KEY,
  counterSortKey,
  pickGsi1PartitionKey,
  pickGsi1SortKey,
  pickSortKey,
  playerPartitionKey,
  seasonWeekToken,
  weekPartitionKey,
} from '../../shared/dynamo.js';
import {
  FOUNDATION_GAME,
  FOUNDATION_GAME_ITEM,
  FOUNDATION_WEEK,
} from '../../shared/foundation.js';
import {
  createCurrentWeekHandler,
  type ApiGatewayJwtEvent,
  type Clock,
  type DynamoCurrentWeekClient,
} from './current-week.js';

const TABLE_NAME = 'locks-table';
const PLAYER_SUB = 'cognito-sub-123';
const OTHER_PLAYER_SUB = 'cognito-sub-456';
const SEASON = 2026;
const WEEK = 1;
const WEEK_PK = weekPartitionKey(SEASON, WEEK);
const ODDS_UPDATED_AT = '2026-09-09T10:00:00.000Z';
const BEFORE_KICKOFF = new Date('2026-09-09T12:00:00.000Z');
const AT_KICKOFF = new Date('2026-09-10T00:20:00.000Z');
const AFTER_KICKOFF = new Date('2026-09-10T00:20:01.000Z');

const baseGame = {
  PK: WEEK_PK,
  SK: `GAME#seed-game-1`,
  id: 'seed-game-1',
  awayTeam: 'Dallas Cowboys',
  homeTeam: 'Philadelphia Eagles',
  awayAbbr: 'DAL',
  homeAbbr: 'PHI',
  commenceTime: '2026-09-10T00:20:00.000Z',
  awaySpread: 3.5,
  homeSpread: -3.5,
  status: 'scheduled',
  bookmaker: 'draftkings',
  oddsUpdatedAt: ODDS_UPDATED_AT,
};

const finalGame = {
  ...baseGame,
  status: 'final',
  awayScore: 17,
  homeScore: 24,
};

const basePick = {
  PK: playerPartitionKey(PLAYER_SUB),
  SK: pickSortKey(SEASON, WEEK, 'seed-game-1'),
  GSI1PK: pickGsi1PartitionKey(SEASON, WEEK),
  GSI1SK: pickGsi1SortKey(PLAYER_SUB, 'seed-game-1'),
  playerId: PLAYER_SUB,
  gameId: 'seed-game-1',
  seasonWeek: seasonWeekToken(SEASON, WEEK),
  pickedTeam: 'Dallas Cowboys',
  spreadAtPick: 3.5,
  submittedAt: '2026-09-09T11:00:00.000Z',
  result: 'pending',
};

const otherPlayerPick = {
  PK: playerPartitionKey(OTHER_PLAYER_SUB),
  SK: pickSortKey(SEASON, WEEK, 'seed-game-1'),
  GSI1PK: pickGsi1PartitionKey(SEASON, WEEK),
  GSI1SK: pickGsi1SortKey(OTHER_PLAYER_SUB, 'seed-game-1'),
  playerId: OTHER_PLAYER_SUB,
  gameId: 'seed-game-1',
  seasonWeek: seasonWeekToken(SEASON, WEEK),
  pickedTeam: 'Philadelphia Eagles',
  spreadAtPick: -3.5,
  submittedAt: '2026-09-09T11:30:00.000Z',
  result: 'pending',
};

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

function createHandler(
  send: ReturnType<typeof vi.fn>,
  clock: Clock = { now: () => BEFORE_KICKOFF },
) {
  const client = { send } as DynamoCurrentWeekClient;
  return createCurrentWeekHandler({
    dynamoClient: client,
    tableName: TABLE_NAME,
    clock,
    logger: { error: vi.fn() },
  });
}

function activeSeasonGet() {
  return {
    Item: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
      season: SEASON,
      week: WEEK,
      status: 'open',
    },
  };
}

function weekMetaGet(oddsUpdatedAt: string | null = ODDS_UPDATED_AT) {
  return {
    Item: {
      PK: WEEK_PK,
      SK: WEEK_META_SORT_KEY,
      season: SEASON,
      week: WEEK,
      status: 'open',
      seasonWeek: seasonWeekToken(SEASON, WEEK),
      oddsUpdatedAt,
    },
  };
}

function counterGet(pickCount: number) {
  return {
    Item: {
      PK: playerPartitionKey(PLAYER_SUB),
      SK: counterSortKey(SEASON, WEEK),
      pickCount,
      seasonWeek: seasonWeekToken(SEASON, WEEK),
      updatedAt: '2026-09-09T11:00:00.000Z',
    },
  };
}

function expectedPick(pick: typeof basePick) {
  return {
    playerId: pick.playerId,
    gameId: pick.gameId,
    seasonWeek: pick.seasonWeek,
    pickedTeam: pick.pickedTeam,
    spreadAtPick: pick.spreadAtPick,
    submittedAt: pick.submittedAt,
    result: pick.result,
  };
}

describe('current-week handler', () => {
  it('returns games, picks, remainingPicks, and oddsUpdatedAt when active week is seeded', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(activeSeasonGet())
      .mockResolvedValueOnce(weekMetaGet())
      .mockResolvedValueOnce({ Items: [baseGame] })
      .mockResolvedValueOnce({ Items: [basePick] })
      .mockResolvedValueOnce(counterGet(1));
    const handler = createHandler(send);

    const response = await handler(createEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      week: {
        season: SEASON,
        week: WEEK,
        status: 'open',
        seasonWeek: seasonWeekToken(SEASON, WEEK),
      },
      games: [
        {
          id: baseGame.id,
          awayTeam: baseGame.awayTeam,
          homeTeam: baseGame.homeTeam,
          awayAbbr: baseGame.awayAbbr,
          homeAbbr: baseGame.homeAbbr,
          commenceTime: baseGame.commenceTime,
          awaySpread: baseGame.awaySpread,
          homeSpread: baseGame.homeSpread,
          awayScore: null,
          homeScore: null,
          status: baseGame.status,
          bookmaker: baseGame.bookmaker,
          oddsUpdatedAt: baseGame.oddsUpdatedAt,
        },
      ],
      picks: [expectedPick(basePick)],
      remainingPicks: 2,
      oddsUpdatedAt: ODDS_UPDATED_AT,
    });

    const gsiQuery = send.mock.calls.find(
      ([command]) =>
        command instanceof QueryCommand &&
        command.input.IndexName === 'GSI1',
    );
    expect(gsiQuery).toBeDefined();
    expect(gsiQuery![0].input).toMatchObject({
      KeyConditionExpression: 'GSI1PK = :weekPk',
      FilterExpression: 'begins_with(SK, :pickPrefix)',
      ExpressionAttributeValues: {
        ':weekPk': WEEK_PK,
        ':pickPrefix': 'PICK#',
      },
    });
  });

  it('includes final scores when a game has been scored', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(activeSeasonGet())
      .mockResolvedValueOnce(weekMetaGet())
      .mockResolvedValueOnce({ Items: [finalGame] })
      .mockResolvedValueOnce({ Items: [basePick] })
      .mockResolvedValueOnce(counterGet(1));
    const handler = createHandler(send, { now: () => AFTER_KICKOFF });

    const response = await handler(createEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).games[0]).toMatchObject({
      id: finalGame.id,
      status: 'final',
      awayScore: 17,
      homeScore: 24,
    });
  });

  it('always returns the caller pick before kickoff and hides other players', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(activeSeasonGet())
      .mockResolvedValueOnce(weekMetaGet())
      .mockResolvedValueOnce({ Items: [baseGame] })
      .mockResolvedValueOnce({ Items: [basePick, otherPlayerPick] })
      .mockResolvedValueOnce(counterGet(1));
    const handler = createHandler(send, { now: () => BEFORE_KICKOFF });

    const response = await handler(createEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).picks).toEqual([expectedPick(basePick)]);
  });

  it.each([
    ['at kickoff', AT_KICKOFF],
    ['after kickoff', AFTER_KICKOFF],
  ])(
    'reveals other players picks %s',
    async (_label, now) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce(activeSeasonGet())
        .mockResolvedValueOnce(weekMetaGet())
        .mockResolvedValueOnce({ Items: [baseGame] })
        .mockResolvedValueOnce({ Items: [basePick, otherPlayerPick] })
        .mockResolvedValueOnce(counterGet(1));
      const handler = createHandler(send, { now: () => now });

      const response = await handler(createEvent());

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).picks).toEqual([
        expectedPick(basePick),
        expectedPick(otherPlayerPick),
      ]);
    },
  );

  it('lists current and past weeks in descending order', async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Item: {
        PK: ACTIVE_SEASON_PARTITION_KEY,
        SK: ACTIVE_SEASON_SORT_KEY,
        season: SEASON,
        week: 3,
      },
    });
    const handler = createHandler(send);

    const response = await handler({
      ...createEvent(),
      routeKey: 'GET /api/weeks',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      { season: SEASON, week: 3, isCurrent: true },
      { season: SEASON, week: 2, isCurrent: false },
      { season: SEASON, week: 1, isCurrent: false },
    ]);
    expect(send).toHaveBeenCalledOnce();
  });

  it('loads a selected past week with revealed picks', async () => {
    const completedPastGame = {
      ...finalGame,
      commenceTime: '2026-09-01T00:20:00.000Z',
    };
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: ACTIVE_SEASON_PARTITION_KEY,
          SK: ACTIVE_SEASON_SORT_KEY,
          season: SEASON,
          week: 2,
        },
      })
      .mockResolvedValueOnce(weekMetaGet())
      .mockResolvedValueOnce({ Items: [completedPastGame] })
      .mockResolvedValueOnce({ Items: [basePick, otherPlayerPick] })
      .mockResolvedValueOnce(counterGet(1));
    const handler = createHandler(send, { now: () => AFTER_KICKOFF });

    const response = await handler({
      ...createEvent(),
      routeKey: 'GET /api/week/{seasonWeek}',
      pathParameters: { seasonWeek: '2026#W01' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      week: { season: SEASON, week: 1, seasonWeek: '2026#W01' },
      picks: [expectedPick(basePick), expectedPick(otherPlayerPick)],
    });
  });

  it('rejects malformed selected-week tokens', async () => {
    const send = vi.fn().mockResolvedValueOnce(activeSeasonGet());
    const handler = createHandler(send);

    const response = await handler({
      ...createEvent(),
      routeKey: 'GET /api/week/{seasonWeek}',
      pathParameters: { seasonWeek: 'week-one' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('INVALID_WEEK');
  });

  it('returns not found when a past week has no metadata', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: ACTIVE_SEASON_PARTITION_KEY,
          SK: ACTIVE_SEASON_SORT_KEY,
          season: SEASON,
          week: 2,
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const handler = createHandler(send);

    const response = await handler({
      ...createEvent(),
      routeKey: 'GET /api/week/{seasonWeek}',
      pathParameters: { seasonWeek: '2026#W01' },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe('WEEK_NOT_FOUND');
  });

  it('falls back to foundation behavior when no active week item exists', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [FOUNDATION_GAME_ITEM] });
    const handler = createHandler(send);

    const response = await handler(createEvent());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      week: {
        season: FOUNDATION_WEEK.season,
        week: FOUNDATION_WEEK.week,
        status: 'open',
        seasonWeek: seasonWeekToken(
          FOUNDATION_WEEK.season,
          FOUNDATION_WEEK.week,
        ),
      },
      games: [
        {
          ...FOUNDATION_GAME,
          awayAbbr: '',
          homeAbbr: '',
          awaySpread: 0,
          homeSpread: 0,
          awayScore: null,
          homeScore: null,
          bookmaker: '',
          oddsUpdatedAt: '',
        },
      ],
      picks: [],
      remainingPicks: 3,
      oddsUpdatedAt: null,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0, 3],
    [2, 1],
    [3, 0],
  ])(
    'with pickCount %i returns remainingPicks %i',
    async (pickCount, expectedRemaining) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce(activeSeasonGet())
        .mockResolvedValueOnce(weekMetaGet(null))
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce(
          pickCount === 0 ? {} : counterGet(pickCount),
        );
      const handler = createHandler(send);

      const response = await handler(createEvent());

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).remainingPicks).toBe(
        expectedRemaining,
      );
      expect(JSON.parse(response.body).oddsUpdatedAt).toBeNull();
    },
  );

  it('returns a structured error without exposing the database failure', async () => {
    const send = vi.fn().mockRejectedValue(new Error('private database detail'));
    const handler = createHandler(send);

    const response = await handler(createEvent());

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to load the current week',
      },
    });
    expect(response.body).not.toContain('private database detail');
  });

  it('returns an error when the authenticated player identity is missing', async () => {
    const send = vi.fn();
    const handler = createHandler(send);

    const response = await handler({
      requestContext: {},
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authenticated player identity is missing',
      },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
