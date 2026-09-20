import { describe, expect, it, vi } from 'vitest';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACTIVE_SEASON_PARTITION_KEY,
  ACTIVE_SEASON_SORT_KEY,
  SURVIVOR_META_SORT_KEY,
  survivorChallengePartitionKey,
  survivorPlayerSortKey,
  weekPartitionKey,
  gameSortKey,
} from '../../shared/dynamo.js';
import { createSubmitSurvivorPickHandler } from './submit-survivor-pick.js';

const TABLE = 'locks';
const SUB = 'player-sub';
const SEASON = 2026;
const WEEK = 3;

describe('submit-survivor-pick handler', () => {
  it('rejects when the player is eliminated', async () => {
    const send = vi.fn(async (command: { input?: { Key?: { PK?: string; SK?: string } } }) => {
      const key = command.input?.Key;
      if (
        key?.PK === ACTIVE_SEASON_PARTITION_KEY &&
        key.SK === ACTIVE_SEASON_SORT_KEY
      ) {
        return { Item: { season: SEASON, week: WEEK } };
      }
      if (
        key?.PK === survivorChallengePartitionKey(SEASON) &&
        key.SK === SURVIVOR_META_SORT_KEY
      ) {
        return { Item: { status: 'active', winners: [] } };
      }
      if (
        key?.PK === survivorChallengePartitionKey(SEASON) &&
        key.SK === survivorPlayerSortKey(SUB)
      ) {
        return { Item: { status: 'eliminated', usedTeams: [] } };
      }
      if (
        key?.PK === weekPartitionKey(SEASON, WEEK) &&
        key.SK === gameSortKey('g1')
      ) {
        return {
          Item: {
            id: 'g1',
            awayTeam: 'Dallas Cowboys',
            homeTeam: 'Philadelphia Eagles',
            commenceTime: '2099-09-20T17:00:00.000Z',
          },
        };
      }
      return {};
    });

    const handler = createSubmitSurvivorPickHandler({
      dynamoClient: { send } as never,
      clock: { now: () => new Date('2026-09-19T12:00:00.000Z') },
      tableName: TABLE,
    });

    const response = await handler({
      body: JSON.stringify({
        gameId: 'g1',
        pickedTeam: 'Dallas Cowboys',
      }),
      requestContext: {
        authorizer: { jwt: { claims: { sub: SUB } } },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('SURVIVOR_ELIMINATED');
    expect(
      send.mock.calls.some(
        ([command]) => command instanceof TransactWriteCommand,
      ),
    ).toBe(false);
  });

  it('writes a survivor pick when the player is alive', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof TransactWriteCommand) {
        return {};
      }
      const key = (command as { input?: { Key?: { PK?: string; SK?: string } } })
        .input?.Key;
      if (
        key?.PK === ACTIVE_SEASON_PARTITION_KEY &&
        key.SK === ACTIVE_SEASON_SORT_KEY
      ) {
        return { Item: { season: SEASON, week: WEEK } };
      }
      if (
        key?.PK === survivorChallengePartitionKey(SEASON) &&
        key.SK === SURVIVOR_META_SORT_KEY
      ) {
        return { Item: { status: 'active', winners: [] } };
      }
      if (
        key?.PK === survivorChallengePartitionKey(SEASON) &&
        key.SK === survivorPlayerSortKey(SUB)
      ) {
        return { Item: { status: 'alive', usedTeams: [] } };
      }
      if (
        key?.PK === weekPartitionKey(SEASON, WEEK) &&
        key.SK === gameSortKey('g1')
      ) {
        return {
          Item: {
            id: 'g1',
            awayTeam: 'Dallas Cowboys',
            homeTeam: 'Philadelphia Eagles',
            commenceTime: '2099-09-20T17:00:00.000Z',
          },
        };
      }
      return {};
    });

    const notifySurvivorPick = vi.fn().mockResolvedValue(undefined);
    const handler = createSubmitSurvivorPickHandler({
      dynamoClient: { send } as never,
      clock: { now: () => new Date('2026-09-19T12:00:00.000Z') },
      tableName: TABLE,
      notifySurvivorPick,
    });

    const response = await handler({
      body: JSON.stringify({
        gameId: 'g1',
        pickedTeam: 'Dallas Cowboys',
      }),
      requestContext: {
        authorizer: { jwt: { claims: { sub: SUB } } },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).pick.pickedTeam).toBe('Dallas Cowboys');
    expect(notifySurvivorPick).toHaveBeenCalledOnce();

    const transact = send.mock.calls.find(
      ([command]) => command instanceof TransactWriteCommand,
    )?.[0] as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    const keys = items.map((item) => {
      if (item.ConditionCheck?.Key) {
        return `${item.ConditionCheck.Key.PK}#${item.ConditionCheck.Key.SK}`;
      }
      if (item.Update?.Key) {
        return `${item.Update.Key.PK}#${item.Update.Key.SK}`;
      }
      if (item.Put?.Item) {
        return `${item.Put.Item.PK}#${item.Put.Item.SK}`;
      }
      return 'unknown';
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});
