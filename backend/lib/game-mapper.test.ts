import { mapOddsEventToGame } from './game-mapper.js';
import type { OddsApiSpreadEvent } from './odds-api-types.js';

const oddsUpdatedAt = '2026-08-01T12:00:00.000Z';

function buildEvent(
  overrides: Partial<OddsApiSpreadEvent> = {},
): OddsApiSpreadEvent {
  return {
    id: 'event-1',
    sport_key: 'americanfootball_nfl',
    sport_title: 'NFL',
    commence_time: '2026-09-10T00:20:00.000Z',
    home_team: 'Philadelphia Eagles',
    away_team: 'Dallas Cowboys',
    bookmakers: [
      {
        key: 'fanduel',
        title: 'FanDuel',
        markets: [
          {
            key: 'spreads',
            outcomes: [
              { name: 'Dallas Cowboys', price: -110, point: 3.5 },
              { name: 'Philadelphia Eagles', price: -110, point: -3.5 },
            ],
          },
        ],
      },
      {
        key: 'draftkings',
        title: 'DraftKings',
        markets: [
          {
            key: 'spreads',
            outcomes: [
              { name: 'Dallas Cowboys', price: -105, point: 4 },
              { name: 'Philadelphia Eagles', price: -115, point: -4 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('game-mapper', () => {
  it('prefers DraftKings spreads and maps team abbreviations', () => {
    const game = mapOddsEventToGame(buildEvent(), oddsUpdatedAt);

    expect(game).toEqual({
      id: 'event-1',
      awayTeam: 'Dallas Cowboys',
      homeTeam: 'Philadelphia Eagles',
      awayAbbr: 'DAL',
      homeAbbr: 'PHI',
      commenceTime: '2026-09-10T00:20:00.000Z',
      awaySpread: 4,
      homeSpread: -4,
      awayScore: null,
      homeScore: null,
      status: 'scheduled',
      bookmaker: 'draftkings',
      oddsUpdatedAt,
    });
  });

  it('falls back to the first available bookmaker', () => {
    const game = mapOddsEventToGame(
      buildEvent({
        bookmakers: [
          {
            key: 'fanduel',
            title: 'FanDuel',
            markets: [
              {
                key: 'spreads',
                outcomes: [
                  { name: 'Dallas Cowboys', price: -110, point: 2.5 },
                  { name: 'Philadelphia Eagles', price: -110, point: -2.5 },
                ],
              },
            ],
          },
        ],
      }),
      oddsUpdatedAt,
    );

    expect(game.bookmaker).toBe('fanduel');
    expect(game.awaySpread).toBe(2.5);
    expect(game.homeSpread).toBe(-2.5);
  });

  it('sets oddsUpdatedAt from the provided timestamp', () => {
    const game = mapOddsEventToGame(
      buildEvent(),
      '2026-08-02T15:30:00.000Z',
    );

    expect(game.oddsUpdatedAt).toBe('2026-08-02T15:30:00.000Z');
  });
});
