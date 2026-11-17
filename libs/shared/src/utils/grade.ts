/** Grades beyond this are GPS or altitude noise, not terrain. */
export const MAX_RUNNING_GRADE = 0.3;

/**
 * Minetti et al. 2002 running energy cost, in J/kg/m, for grade as a fraction.
 * Measured on a treadmill between −45% and +45%; this does not model technical terrain.
 * doi:10.1152/japplphysiol.01177.2001.
 */
export function runningEnergyCost(grade: number): number {
  const i = grade;
  return (
    155.4 * i ** 5 -
    30.4 * i ** 4 -
    43.3 * i ** 3 +
    46.3 * i ** 2 +
    19.5 * i +
    3.6
  );
}

/** Cost at a grade relative to running on the flat. */
export function runningGradeCostRatio(grade: number): number {
  const clamped = Math.max(
    -MAX_RUNNING_GRADE,
    Math.min(MAX_RUNNING_GRADE, grade),
  );
  return runningEnergyCost(clamped) / runningEnergyCost(0);
}
