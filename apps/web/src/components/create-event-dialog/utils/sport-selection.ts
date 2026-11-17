import { SPORT_TYPE } from '@openathlete/shared';

export const DEFAULT_SPORT = SPORT_TYPE.CYCLING;

export const SELECTABLE_SPORTS: SPORT_TYPE[] = [
  SPORT_TYPE.CYCLING,
  SPORT_TYPE.RUNNING,
  SPORT_TYPE.STRENGTH,
  SPORT_TYPE.WALK,
  SPORT_TYPE.SWIMMING,
  SPORT_TYPE.MOBILITY,
];

export function getSelectableSports(currentSport?: SPORT_TYPE | null) {
  return currentSport && !SELECTABLE_SPORTS.includes(currentSport)
    ? [...SELECTABLE_SPORTS, currentSport]
    : SELECTABLE_SPORTS;
}
