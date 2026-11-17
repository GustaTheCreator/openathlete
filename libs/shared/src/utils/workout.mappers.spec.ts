import { describe, expect, it } from 'vitest';

import { normalizeWorkoutForCreate } from './workout.mappers';

describe('normalizeWorkoutForCreate', () => {
  it('keeps strength fields and defaults older repeats to plain repetitions', () => {
    const result = normalizeWorkoutForCreate({
      steps: [
        {
          stepType: 'REPEAT',
          repeatBlock: {
            repetitions: 3,
            childSteps: [
              {
                stepType: 'INTERVAL_ACTIVE',
                durationType: 'REPS',
                durationValue: 8,
                exerciseRef: 'c:barbell-full-squat',
                tempo: '3-1-1-0',
                targets: [{ targetType: 'WEIGHT', targetValue: 80 }],
              },
            ],
          },
        },
      ],
    });

    expect(result.steps[0].repeatBlock).toMatchObject({
      kind: 'REPEAT',
      childSteps: [
        {
          exerciseRef: 'c:barbell-full-squat',
          tempo: '3-1-1-0',
          durationType: 'REPS',
          durationValue: 8,
          targets: [{ targetType: 'WEIGHT', targetValue: 80 }],
        },
      ],
    });
  });
});
