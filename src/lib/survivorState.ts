import type { SurvivorWeekState } from '../../shared/types';

export function emptySurvivorWeekState(
  overrides: Partial<SurvivorWeekState> = {},
): SurvivorWeekState {
  return {
    challengeStatus: 'active',
    winners: [],
    myStatus: 'alive',
    usedTeams: [],
    canPick: true,
    picks: [],
    ...overrides,
  };
}
