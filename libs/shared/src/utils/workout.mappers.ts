import {
  type CreateWorkoutDto,
  type CreateWorkoutStepDto,
  type WorkoutDto,
  type WorkoutStepDto,
  type WorkoutStepTargetDto,
} from '../types/dtos/core/workout.dto';
import {
  SPORT_TYPE,
  WORKOUT_DURATION_TYPE,
  WORKOUT_REPEAT_KIND,
  WORKOUT_STEP_TYPE,
} from '../types/misc';
import type {
  NormalizedWorkout,
  NormalizedWorkoutStep,
  NormalizedWorkoutStepTarget,
} from '../types/workout-normalized';

// ----------------------------------------------------------------------------
// Normalization helpers (camelCase DTOs → clean Create DTOs)
// ----------------------------------------------------------------------------

export type WorkoutStepInputDto = Omit<
  Partial<WorkoutStepDto>,
  'childSteps' | 'repeatBlock' | 'durationType'
> & {
  durationType?: WorkoutStepDto['durationType'] | null;
  childSteps?: WorkoutStepInputDto[];
  repeatTimes?: number | null;
  repeatBlock?:
    | (Omit<NonNullable<WorkoutStepDto['repeatBlock']>, 'childSteps'> & {
        childSteps?: WorkoutStepInputDto[];
      })
    | null;
};

function normalizeTarget(
  target: Partial<WorkoutStepTargetDto>,
): WorkoutStepTargetDto {
  return {
    workoutStepTargetId: target.workoutStepTargetId,
    targetType: target.targetType!,
    targetMin: target.targetMin ?? null,
    targetMax: target.targetMax ?? null,
    targetValue: target.targetValue ?? null,
    metricType: target.metricType ?? null,
    stepId: target.stepId,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

function normalizeStepForCreate(
  step: WorkoutStepInputDto,
): CreateWorkoutStepDto {
  const base: CreateWorkoutStepDto = {
    stepType: step.stepType || WORKOUT_STEP_TYPE.STEADY,
    name: step.name ?? null,
    durationType: step.durationType || WORKOUT_DURATION_TYPE.OPEN,
    durationValue: step.durationValue ?? null,
    repeatTimes: null,
    restTime: null,
    notes: step.notes ?? null,
    exerciseRef: step.exerciseRef ?? null,
    tempo: step.tempo ?? null,
    side: step.side ?? null,
    targets: (step.targets || []).map((t: Partial<WorkoutStepTargetDto>) =>
      normalizeTarget(t),
    ),
    childSteps: undefined,
    repeatBlock: undefined,
  };

  // Prefer repeatBlock shape if present
  if (step.repeatBlock) {
    base.repeatBlock = {
      repetitions: step.repeatBlock.repetitions,
      kind: step.repeatBlock.kind ?? WORKOUT_REPEAT_KIND.REPEAT,
      intervalSeconds: step.repeatBlock.intervalSeconds ?? null,
      timeCapSeconds: step.repeatBlock.timeCapSeconds ?? null,
      childSteps: (step.repeatBlock.childSteps || []).map(
        (c: WorkoutStepInputDto) => normalizeStepForCreate(c),
      ),
    };
  }

  // Legacy childSteps (without repeatBlock wrapper)
  if (!base.repeatBlock && step.childSteps) {
    base.repeatBlock = {
      repetitions: step.repeatTimes || 1,
      childSteps: (step.childSteps || []).map((c: WorkoutStepInputDto) =>
        normalizeStepForCreate(c),
      ),
    };
  }

  return base;
}

export function normalizeWorkoutForCreate(dto: {
  steps: WorkoutStepInputDto[];
}): CreateWorkoutDto {
  return {
    steps: (dto.steps || []).map((s) => normalizeStepForCreate(s)),
  };
}

// ----------------------------------------------------------------------------
// Normalization for provider export (flatten repeats)
// ----------------------------------------------------------------------------

function flattenStep(
  step: WorkoutStepDto,
  accumulator: NormalizedWorkoutStep[],
): void {
  if (step.stepType === WORKOUT_STEP_TYPE.REPEAT && step.repeatBlock) {
    const reps = step.repeatBlock.repetitions || 1;
    // Sort child steps by their orderIndex to ensure correct order within repeat block
    const sortedChildren = [...(step.repeatBlock.childSteps || [])].sort(
      (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
    );
    for (let i = 0; i < reps; i += 1) {
      for (const child of sortedChildren) {
        flattenStep(child as WorkoutStepDto, accumulator);
      }
    }
    return;
  }

  const targets: NormalizedWorkoutStepTarget[] = (step.targets || []).map(
    (t: WorkoutStepTargetDto) => ({
      targetType: t.targetType,
      targetMin: t.targetMin ?? null,
      targetMax: t.targetMax ?? null,
      targetValue: t.targetValue ?? null,
      metricType: t.metricType ?? null,
    }),
  );

  const normalized: NormalizedWorkoutStep = {
    orderIndex: step.orderIndex ?? 0,
    stepType: step.stepType ?? WORKOUT_STEP_TYPE.STEADY,
    name: step.name ?? null,
    notes: step.notes ?? null,
    durationType: step.durationType ?? WORKOUT_DURATION_TYPE.OPEN,
    durationValue: step.durationValue ?? null,
    durationTarget: step.durationTarget ?? null,
    targets,
  };

  accumulator.push(normalized);
}

export function normalizeWorkoutForExport(input: {
  sport: SPORT_TYPE;
  title?: string | null;
  description?: string | null;
  workout: WorkoutDto;
}): NormalizedWorkout {
  const flatSteps: NormalizedWorkoutStep[] = [];

  // Sort top-level steps by orderIndex before flattening
  const sortedSteps = [...(input.workout.steps || [])].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  );

  for (const step of sortedSteps) {
    flattenStep(step as WorkoutStepDto, flatSteps);
  }

  // Assign new sequential orderIndex values (do NOT sort - flatten order is correct)
  // The flattenStep function already pushes steps in the correct execution order
  flatSteps.forEach((s, idx) => {
    s.orderIndex = idx;
  });

  return {
    sport: input.sport,
    title: input.title ?? null,
    description: input.description ?? null,
    steps: flatSteps,
  };
}
