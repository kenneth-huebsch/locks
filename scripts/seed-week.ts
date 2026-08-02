import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  WEEK_META_SORT_KEY,
  gameSortKey,
  seasonWeekToken,
  weekPartitionKey,
} from '../shared/dynamo.js';
import { TEAMS } from '../shared/teams.js';

const SEASON = 2026;
const WEEK = 1;

export interface SeedWeekGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  awayAbbr: string;
  homeAbbr: string;
  commenceTime: string;
  awaySpread: number;
  homeSpread: number;
  status: 'scheduled';
  bookmaker: string;
  oddsUpdatedAt: string;
}

export interface SeedWeekItem extends SeedWeekGame {
  PK: string;
  SK: string;
}

function team(fullName: string) {
  const match = TEAMS.find((entry) => entry.fullName === fullName);
  if (!match) {
    throw new Error(`Unknown team: ${fullName}`);
  }
  return match;
}

const kickoffTimes = [
  '2026-09-10T00:20:00.000Z',
  '2026-09-13T17:00:00.000Z',
  '2026-09-13T17:00:00.000Z',
  '2026-09-13T17:00:00.000Z',
  '2026-09-13T20:25:00.000Z',
  '2026-09-13T20:25:00.000Z',
  '2026-09-14T00:20:00.000Z',
  '2026-09-15T00:15:00.000Z',
  '2026-09-11T00:15:00.000Z',
];

const matchups: Array<[string, string, number]> = [
  ['Dallas Cowboys', 'Philadelphia Eagles', 3.5],
  ['Kansas City Chiefs', 'Los Angeles Chargers', -3],
  ['Buffalo Bills', 'Miami Dolphins', -2.5],
  ['Baltimore Ravens', 'Cincinnati Bengals', -1.5],
  ['Detroit Lions', 'Green Bay Packers', -4.5],
  ['San Francisco 49ers', 'Seattle Seahawks', -6],
  ['Denver Broncos', 'Las Vegas Raiders', 2.5],
  ['Minnesota Vikings', 'Chicago Bears', -3.5],
  ['New York Giants', 'Washington Commanders', 4],
];

export function buildSeedWeekGames(
  oddsUpdatedAt: string,
): SeedWeekGame[] {
  return matchups.map(([awayTeam, homeTeam, awaySpread], index) => {
    const away = team(awayTeam);
    const home = team(homeTeam);

    return {
      id: `seed-2026-w01-game-${index + 1}`,
      awayTeam: away.fullName,
      homeTeam: home.fullName,
      awayAbbr: away.abbreviation,
      homeAbbr: home.abbreviation,
      commenceTime: kickoffTimes[index] ?? kickoffTimes[0],
      awaySpread,
      homeSpread: -awaySpread,
      status: 'scheduled',
      bookmaker: 'draftkings',
      oddsUpdatedAt,
    };
  });
}

export function buildSeedWeekItems(
  oddsUpdatedAt: string,
): SeedWeekItem[] {
  const pk = weekPartitionKey(SEASON, WEEK);
  return buildSeedWeekGames(oddsUpdatedAt).map((game) => ({
    PK: pk,
    SK: gameSortKey(game.id),
    ...game,
  }));
}

export interface SeedWeekOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
  oddsUpdatedAt?: string;
}

export async function seedWeek({
  tableName,
  client,
  oddsUpdatedAt = new Date().toISOString(),
}: SeedWeekOptions): Promise<number> {
  const documentClient =
    client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const items = buildSeedWeekItems(oddsUpdatedAt);
  for (const item of items) {
    await documentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      }),
    );
  }

  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: ACTIVE_SEASON_PARTITION_KEY,
        SK: ACTIVE_SEASON_SORT_KEY,
        season: SEASON,
        updatedAt: oddsUpdatedAt,
      },
    }),
  );

  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: weekPartitionKey(SEASON, WEEK),
        SK: WEEK_META_SORT_KEY,
        season: SEASON,
        week: WEEK,
        status: 'open',
        seasonWeek: seasonWeekToken(SEASON, WEEK),
        oddsUpdatedAt,
      },
    }),
  );

  return items.length;
}
