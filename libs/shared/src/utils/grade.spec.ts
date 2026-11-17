import { describe, expect, it } from 'vitest';

import {
  MAX_RUNNING_GRADE,
  runningEnergyCost,
  runningGradeCostRatio,
} from './grade';

describe('running grade cost', () => {
  it('matches hand-calculated published values and the flat baseline', () => {
    expect(runningEnergyCost(0)).toBe(3.6);
    expect(runningEnergyCost(0.1)).toBeCloseTo(5.968214, 6);
    expect(runningGradeCostRatio(0)).toBe(1);
  });

  it('clamps the ratio at the supported grade limits', () => {
    expect(runningGradeCostRatio(2)).toBe(
      runningGradeCostRatio(MAX_RUNNING_GRADE),
    );
    expect(runningGradeCostRatio(-2)).toBe(
      runningGradeCostRatio(-MAX_RUNNING_GRADE),
    );
  });
});
