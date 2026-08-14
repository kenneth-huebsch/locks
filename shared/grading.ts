import type { Pick } from './types.js';

export type GradedPickResult = Exclude<Pick['result'], 'pending'>;

export interface GradeAgainstTheSpreadInput {
  pickedTeam: string;
  spreadAtPick: number;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
}

/**
 * ATS grading: adjusted = picked_team_score + locked spread S vs opponent score.
 * Win if adjusted > opponent; push (spread-tie) if equal; loss otherwise.
 */
export function gradeAgainstTheSpread(
  input: GradeAgainstTheSpreadInput,
): GradedPickResult {
  const { pickedTeam, spreadAtPick, awayTeam, homeTeam, awayScore, homeScore } =
    input;

  let pickedScore: number;
  let opponentScore: number;

  if (pickedTeam === awayTeam) {
    pickedScore = awayScore;
    opponentScore = homeScore;
  } else if (pickedTeam === homeTeam) {
    pickedScore = homeScore;
    opponentScore = awayScore;
  } else {
    throw new Error(
      `Picked team "${pickedTeam}" is neither away "${awayTeam}" nor home "${homeTeam}"`,
    );
  }

  const adjusted = pickedScore + spreadAtPick;
  if (adjusted > opponentScore) {
    return 'win';
  }
  if (adjusted === opponentScore) {
    return 'push';
  }
  return 'loss';
}
