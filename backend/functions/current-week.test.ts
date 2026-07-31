import {
  FOUNDATION_GAME,
  FOUNDATION_GAME_ITEM,
  FOUNDATION_WEEK,
} from '../../shared/foundation.js';
import { createCurrentWeekHandler } from './current-week.js';

describe('current-week handler', () => {
  it('returns the typed current-week game response from DynamoDB', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [FOUNDATION_GAME_ITEM] });
    const handler = createCurrentWeekHandler(
      { send },
      'locks-table',
      { error: vi.fn() },
    );

    const response = await handler();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      season: FOUNDATION_WEEK.season,
      week: FOUNDATION_WEEK.week,
      games: [FOUNDATION_GAME],
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('returns a structured error without exposing the database failure', async () => {
    const send = vi.fn().mockRejectedValue(new Error('private database detail'));
    const handler = createCurrentWeekHandler(
      { send },
      'locks-table',
      { error: vi.fn() },
    );

    const response = await handler();

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to load the current week',
      },
    });
    expect(response.body).not.toContain('private database detail');
  });
});
