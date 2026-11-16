import { z } from 'zod';

import {
  WORKOUT_DURATION_TYPE,
  WORKOUT_STEP_TYPE,
  WORKOUT_TARGET_TYPE,
} from './misc';
import { SPORT_TYPE } from './misc/core/sport-type.enum';

// Normalized structure for provider exports (repeat blocks are flattened)

export const normalizedWorkoutStepTargetSchema = z.object({
  targetType: z.enum(WORKOUT_TARGET_TYPE),
  targetMin: z.number().nullable().optional(),
  targetMax: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  metricType: z.string().nullable().optional(),
});

export type NormalizedWorkoutStepTarget = Omit<
  z.infer<typeof normalizedWorkoutStepTargetSchema>,
  'targetType'
> & { targetType: `${WORKOUT_TARGET_TYPE}` };

export const normalizedWorkoutStepSchema = z.object({
  orderIndex: z.number(),
  stepType: z.enum(WORKOUT_STEP_TYPE),
  name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  durationType: z.enum(WORKOUT_DURATION_TYPE),
  durationValue: z.number().nullable().optional(),
  durationTarget: z.number().nullable().optional(),
  targets: z.array(normalizedWorkoutStepTargetSchema).default([]),
});

export type NormalizedWorkoutStep = Omit<
  z.infer<typeof normalizedWorkoutStepSchema>,
  'stepType' | 'durationType' | 'targets'
> & {
  stepType: `${WORKOUT_STEP_TYPE}`;
  durationType: `${WORKOUT_DURATION_TYPE}`;
  targets: NormalizedWorkoutStepTarget[];
};

export const normalizedWorkoutSchema = z.object({
  sport: z.enum(SPORT_TYPE),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  steps: z.array(normalizedWorkoutStepSchema).default([]),
});

export type NormalizedWorkout = Omit<
  z.infer<typeof normalizedWorkoutSchema>,
  'steps'
> & { steps: NormalizedWorkoutStep[] };
