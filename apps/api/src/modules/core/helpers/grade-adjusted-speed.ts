import { runningGradeCostRatio } from '@openathlete/shared';

export { runningEnergyCost } from '@openathlete/shared';

/** Flat speed that costs the same energy as `speed` at `grade`. */
export function gradeAdjustedSpeed(speed: number, grade: number): number {
  return speed * runningGradeCostRatio(grade);
}
