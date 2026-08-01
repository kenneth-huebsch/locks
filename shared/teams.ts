export interface NflTeam {
  fullName: string;
  abbreviation: string;
  city: string;
  nickname: string;
}

export const TEAMS: readonly NflTeam[] = [
  { fullName: 'Arizona Cardinals', abbreviation: 'ARI', city: 'Arizona', nickname: 'Cardinals' },
  { fullName: 'Atlanta Falcons', abbreviation: 'ATL', city: 'Atlanta', nickname: 'Falcons' },
  { fullName: 'Baltimore Ravens', abbreviation: 'BAL', city: 'Baltimore', nickname: 'Ravens' },
  { fullName: 'Buffalo Bills', abbreviation: 'BUF', city: 'Buffalo', nickname: 'Bills' },
  { fullName: 'Carolina Panthers', abbreviation: 'CAR', city: 'Carolina', nickname: 'Panthers' },
  { fullName: 'Chicago Bears', abbreviation: 'CHI', city: 'Chicago', nickname: 'Bears' },
  { fullName: 'Cincinnati Bengals', abbreviation: 'CIN', city: 'Cincinnati', nickname: 'Bengals' },
  { fullName: 'Cleveland Browns', abbreviation: 'CLE', city: 'Cleveland', nickname: 'Browns' },
  { fullName: 'Dallas Cowboys', abbreviation: 'DAL', city: 'Dallas', nickname: 'Cowboys' },
  { fullName: 'Denver Broncos', abbreviation: 'DEN', city: 'Denver', nickname: 'Broncos' },
  { fullName: 'Detroit Lions', abbreviation: 'DET', city: 'Detroit', nickname: 'Lions' },
  { fullName: 'Green Bay Packers', abbreviation: 'GB', city: 'Green Bay', nickname: 'Packers' },
  { fullName: 'Houston Texans', abbreviation: 'HOU', city: 'Houston', nickname: 'Texans' },
  { fullName: 'Indianapolis Colts', abbreviation: 'IND', city: 'Indianapolis', nickname: 'Colts' },
  { fullName: 'Jacksonville Jaguars', abbreviation: 'JAX', city: 'Jacksonville', nickname: 'Jaguars' },
  { fullName: 'Kansas City Chiefs', abbreviation: 'KC', city: 'Kansas City', nickname: 'Chiefs' },
  { fullName: 'Las Vegas Raiders', abbreviation: 'LV', city: 'Las Vegas', nickname: 'Raiders' },
  { fullName: 'Los Angeles Chargers', abbreviation: 'LAC', city: 'Los Angeles', nickname: 'Chargers' },
  { fullName: 'Los Angeles Rams', abbreviation: 'LAR', city: 'Los Angeles', nickname: 'Rams' },
  { fullName: 'Miami Dolphins', abbreviation: 'MIA', city: 'Miami', nickname: 'Dolphins' },
  { fullName: 'Minnesota Vikings', abbreviation: 'MIN', city: 'Minnesota', nickname: 'Vikings' },
  { fullName: 'New England Patriots', abbreviation: 'NE', city: 'New England', nickname: 'Patriots' },
  { fullName: 'New Orleans Saints', abbreviation: 'NO', city: 'New Orleans', nickname: 'Saints' },
  { fullName: 'New York Giants', abbreviation: 'NYG', city: 'New York', nickname: 'Giants' },
  { fullName: 'New York Jets', abbreviation: 'NYJ', city: 'New York', nickname: 'Jets' },
  { fullName: 'Philadelphia Eagles', abbreviation: 'PHI', city: 'Philadelphia', nickname: 'Eagles' },
  { fullName: 'Pittsburgh Steelers', abbreviation: 'PIT', city: 'Pittsburgh', nickname: 'Steelers' },
  { fullName: 'San Francisco 49ers', abbreviation: 'SF', city: 'San Francisco', nickname: '49ers' },
  { fullName: 'Seattle Seahawks', abbreviation: 'SEA', city: 'Seattle', nickname: 'Seahawks' },
  { fullName: 'Tampa Bay Buccaneers', abbreviation: 'TB', city: 'Tampa Bay', nickname: 'Buccaneers' },
  { fullName: 'Tennessee Titans', abbreviation: 'TEN', city: 'Tennessee', nickname: 'Titans' },
  { fullName: 'Washington Commanders', abbreviation: 'WAS', city: 'Washington', nickname: 'Commanders' },
] as const;

const byAbbreviation = new Map(TEAMS.map((team) => [team.abbreviation, team]));
const byFullName = new Map(TEAMS.map((team) => [team.fullName, team]));

export function getTeamByAbbr(abbreviation: string): NflTeam | undefined {
  return byAbbreviation.get(abbreviation);
}

export function getTeamByName(fullName: string): NflTeam | undefined {
  return byFullName.get(fullName);
}
