import type { Game } from '../../shared/types.js';
import { getTeamByName } from '../../shared/teams.js';
import type { OddsApiSpreadEvent } from './odds-api-types.js';

const PREFERRED_BOOKMAKER = 'draftkings';

export class GameMapperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameMapperError';
  }
}

function selectBookmaker(event: OddsApiSpreadEvent) {
  const draftKings = event.bookmakers.find(
    (bookmaker) => bookmaker.key === PREFERRED_BOOKMAKER,
  );
  if (draftKings) {
    return draftKings;
  }

  const first = event.bookmakers[0];
  if (!first) {
    throw new GameMapperError(
      `No bookmaker spreads available for event ${event.id}`,
    );
  }

  return first;
}

function spreadForTeam(
  event: OddsApiSpreadEvent,
  teamName: string,
): number {
  const bookmaker = selectBookmaker(event);
  const spreadsMarket = bookmaker.markets.find(
    (market) => market.key === 'spreads',
  );
  if (!spreadsMarket) {
    throw new GameMapperError(
      `No spreads market for event ${event.id} from ${bookmaker.key}`,
    );
  }

  const outcome = spreadsMarket.outcomes.find(
    (entry) => entry.name === teamName,
  );
  if (!outcome) {
    throw new GameMapperError(
      `Spread outcome missing for ${teamName} in event ${event.id}`,
    );
  }

  return outcome.point;
}

function teamAbbreviation(teamName: string): string {
  const team = getTeamByName(teamName);
  if (!team) {
    throw new GameMapperError(`Unknown NFL team name: ${teamName}`);
  }

  return team.abbreviation;
}

export function mapOddsEventToGame(
  event: OddsApiSpreadEvent,
  oddsUpdatedAt: string,
): Game {
  return {
    id: event.id,
    awayTeam: event.away_team,
    homeTeam: event.home_team,
    awayAbbr: teamAbbreviation(event.away_team),
    homeAbbr: teamAbbreviation(event.home_team),
    commenceTime: event.commence_time,
    awaySpread: spreadForTeam(event, event.away_team),
    homeSpread: spreadForTeam(event, event.home_team),
    status: 'scheduled',
    bookmaker: selectBookmaker(event).key,
    oddsUpdatedAt,
  };
}

export function mapOddsEventsToGames(
  events: OddsApiSpreadEvent[],
  oddsUpdatedAt: string,
): Game[] {
  return events.map((event) => mapOddsEventToGame(event, oddsUpdatedAt));
}
