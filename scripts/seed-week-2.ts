/**
 * Seed competition Week 2 (2026#W02) from ESPN 2026 preseason Week 3 matchups
 * with invented DraftKings-style spreads.
 *
 * Does not change SEASON#ACTIVE; refuses unless active week is already 2.
 *
 * Usage:
 *   AWS_PROFILE=locks-publish npx tsx scripts/seed-week-2.ts
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
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
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';

const SEASON = 2026;
const WEEK = 2;

function team(fullName: string) {
  const match = TEAMS.find((entry) => entry.fullName === fullName);
  if (!match) {
    throw new Error(`Unknown team: ${fullName}`);
  }
  return match;
}

/** ESPN kickoffs (UTC) + invented away spreads. */
const matchups: Array<[string, string, string, number]> = [
  ['2026-08-21T00:00:00.000Z', 'Las Vegas Raiders', 'Houston Texans', 3.5],
  ['2026-08-21T02:00:00.000Z', 'San Francisco 49ers', 'Los Angeles Chargers', -1.5],
  ['2026-08-21T23:00:00.000Z', 'New York Jets', 'Pittsburgh Steelers', 2.5],
  ['2026-08-21T23:30:00.000Z', 'Carolina Panthers', 'Jacksonville Jaguars', 1.5],
  ['2026-08-22T01:00:00.000Z', 'Green Bay Packers', 'Denver Broncos', 3],
  ['2026-08-22T16:00:00.000Z', 'Washington Commanders', 'Detroit Lions', 4.5],
  ['2026-08-22T17:00:00.000Z', 'Buffalo Bills', 'Cleveland Browns', -2.5],
  ['2026-08-22T17:00:00.000Z', 'Atlanta Falcons', 'Indianapolis Colts', 1.5],
  ['2026-08-22T17:00:00.000Z', 'Baltimore Ravens', 'Minnesota Vikings', -3],
  ['2026-08-22T20:00:00.000Z', 'New Orleans Saints', 'Los Angeles Rams', 6.5],
  ['2026-08-22T20:00:00.000Z', 'New York Giants', 'Miami Dolphins', 2],
  ['2026-08-22T23:00:00.000Z', 'Chicago Bears', 'Cincinnati Bengals', 3.5],
  ['2026-08-22T23:00:00.000Z', 'Philadelphia Eagles', 'New England Patriots', -2.5],
  ['2026-08-22T23:30:00.000Z', 'Kansas City Chiefs', 'Tampa Bay Buccaneers', -3.5],
  ['2026-08-23T02:00:00.000Z', 'Dallas Cowboys', 'Arizona Cardinals', -1.5],
  ['2026-08-24T00:00:00.000Z', 'Seattle Seahawks', 'Tennessee Titans', -2],
];

await assertTargetAccount();

const outputs = await getAppStackOutputs();
const tableName = requireOutput(outputs, 'TableName');
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: TARGET_REGION }),
);

const active = await client.send(
  new GetCommand({
    TableName: tableName,
    Key: {
      PK: ACTIVE_SEASON_PARTITION_KEY,
      SK: ACTIVE_SEASON_SORT_KEY,
    },
  }),
);

if (active.Item?.season !== SEASON || active.Item?.week !== WEEK) {
  throw new Error(
    `Refusing seed: expected active ${SEASON} week ${WEEK}, got season=${String(active.Item?.season)} week=${String(active.Item?.week)}`,
  );
}

const oddsUpdatedAt = new Date().toISOString();
const pk = weekPartitionKey(SEASON, WEEK);

for (const [index, [commenceTime, awayName, homeName, awaySpread]] of matchups.entries()) {
  const away = team(awayName);
  const home = team(homeName);
  const id = `seed-2026-w02-game-${index + 1}`;

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: pk,
        SK: gameSortKey(id),
        id,
        awayTeam: away.fullName,
        homeTeam: home.fullName,
        awayAbbr: away.abbreviation,
        homeAbbr: home.abbreviation,
        commenceTime,
        awaySpread,
        homeSpread: -awaySpread,
        awayScore: null,
        homeScore: null,
        status: 'scheduled',
        bookmaker: 'draftkings',
        oddsUpdatedAt,
      },
    }),
  );
}

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      PK: pk,
      SK: WEEK_META_SORT_KEY,
      season: SEASON,
      week: WEEK,
      status: 'open',
      seasonWeek: seasonWeekToken(SEASON, WEEK),
      oddsUpdatedAt,
    },
  }),
);

console.log(
  `Seeded ${matchups.length} games into ${seasonWeekToken(SEASON, WEEK)} in ${tableName}`,
);
