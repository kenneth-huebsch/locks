export interface OddsApiOutcome {
  name: string;
  price: number;
  point: number;
}

export interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

export interface OddsApiSpreadEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export type OddsApiSpreadsResponse = OddsApiSpreadEvent[];

export type OddsApiEventsResponse = OddsApiEvent[];

export interface OddsApiQuotaHeaders {
  creditsUsed: number;
  creditsRemaining: number;
}

export interface OddsApiSpreadsResult {
  data: OddsApiSpreadsResponse;
  quota: OddsApiQuotaHeaders;
}

export interface OddsApiEventsResult {
  data: OddsApiEventsResponse;
  quota: OddsApiQuotaHeaders;
}
