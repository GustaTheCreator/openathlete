import { describe, expect, it } from 'vitest';

import { convertSpeed } from './numeric-stats.converter';

describe('convertSpeed', () => {
  it('converts 1000 m in 300 s to 5 min/km and 8.0467 min/mi', () => {
    expect(convertSpeed(1000, 300, 'min/km')).toBe(5);
    expect(convertSpeed(1000, 300, 'min/mi')).toBeCloseTo(
      (300 / 1000 / 60) * 1609.34,
      4,
    );
  });
});
