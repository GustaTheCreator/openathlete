import {
  type MetricType,
  Prisma,
  type Workout,
  type WorkoutRepeat,
  type WorkoutStep,
  type WorkoutStepTarget,
} from '@openathlete/database';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  WORKOUT_DURATION_TYPE,
  WORKOUT_REPEAT_KIND,
  WorkoutDto,
  WorkoutStepDto,
  WorkoutStepTargetDto,
  normalizeWorkoutForCreate,
} from '@openathlete/shared';
import type { WorkoutStepInputDto } from '@openathlete/shared';

const SUPPORTED_TARGET_TYPES = new Set([
  'OPEN',
  'PACE',
  'HEARTRATE',
  'POWER',
  'CADENCE',
  'RPE',
  'WEIGHT',
  'ZONE',
]);

function mapTargetToPrismaCreate(
  target: WorkoutStepTargetDto,
): Prisma.WorkoutStepTargetCreateWithoutStepInput | null {
  if (!SUPPORTED_TARGET_TYPES.has(target.targetType)) return null;
  const toNum = (value: number | null | undefined | string): number | null =>
    value === null ||
    value === undefined ||
    value === '' ||
    Number.isNaN(Number(value))
      ? null
      : Number(value);
  return {
    targetType: target.targetType,
    targetMin: toNum(target.targetMin),
    targetMax: toNum(target.targetMax),
    targetValue: toNum(target.targetValue),
    metricType: target.metricType as MetricType | null,
  };
}

function mapStepToPrismaCreate(
  step: import('@openathlete/shared').CreateWorkoutStepDto,
  index: number,
): Prisma.WorkoutStepCreateWithoutWorkoutInput {
  const result: Prisma.WorkoutStepCreateWithoutWorkoutInput = {
    orderIndex: index,
    stepType: step.stepType,
    name: step.name ?? null,
    durationType: step.durationType ?? WORKOUT_DURATION_TYPE.OPEN,
    durationValue: step.durationValue ?? null,
    notes: step.notes ?? null,
    exerciseRef: step.exerciseRef ?? null,
    tempo: step.tempo ?? null,
    side: step.side,
    targets: {
      create: (step.targets ?? [])
        .map(mapTargetToPrismaCreate)
        .filter(
          (target): target is Prisma.WorkoutStepTargetCreateWithoutStepInput =>
            target !== null,
        ),
    },
  };

  if (step.repeatBlock && step.repeatBlock.childSteps.length > 0) {
    result.repeatBlock = {
      create: {
        repetitions: step.repeatBlock.repetitions,
        kind: step.repeatBlock.kind ?? WORKOUT_REPEAT_KIND.REPEAT,
        intervalSeconds: step.repeatBlock.intervalSeconds ?? null,
        timeCapSeconds: step.repeatBlock.timeCapSeconds ?? null,
        childSteps: {
          create: step.repeatBlock.childSteps.map(mapStepToPrismaCreate),
        },
      },
    };
  }

  return result;
}

export function mapWorkoutDtoToPrisma(
  data: CreateWorkoutDto | UpdateWorkoutDto | { steps: WorkoutStepInputDto[] },
): Pick<Prisma.WorkoutCreateWithoutEventTrainingInput, 'steps'> {
  if (!('steps' in data) || !data.steps) return {};
  const normalized = normalizeWorkoutForCreate({ steps: data.steps });
  return {
    steps: { create: normalized.steps.map(mapStepToPrismaCreate) },
  };
}

type StoredWorkoutStep = WorkoutStep & {
  targets?: WorkoutStepTarget[];
  repeatBlock?: (WorkoutRepeat & { childSteps: StoredWorkoutStep[] }) | null;
};

type StoredWorkout = Workout & { steps?: StoredWorkoutStep[] };

function mapPrismaStepToDto(step: StoredWorkoutStep): WorkoutStepDto {
  return {
    workoutStepId: step.workoutStepId,
    orderIndex: step.orderIndex,
    stepType: step.stepType,
    name: step.name ?? null,
    notes: step.notes ?? null,
    durationType: step.durationType,
    durationValue: step.durationValue ?? null,
    durationTarget: step.durationTarget ?? null,
    exerciseRef: step.exerciseRef,
    tempo: step.tempo,
    side: step.side,
    workoutId: step.workoutId ?? undefined,
    repeatParentId: step.repeatParentId ?? undefined,
    targets: (step.targets || []).map(mapPrismaTargetToDto),
    repeatBlock: step.repeatBlock
      ? {
          workoutRepeatId: step.repeatBlock.workoutRepeatId,
          repetitions: step.repeatBlock.repetitions,
          kind: step.repeatBlock.kind,
          intervalSeconds: step.repeatBlock.intervalSeconds,
          timeCapSeconds: step.repeatBlock.timeCapSeconds,
          stepId: step.repeatBlock.stepId,
          childSteps: (step.repeatBlock.childSteps || []).map(
            mapPrismaStepToDto,
          ),
          createdAt: step.repeatBlock.createdAt
            ? new Date(step.repeatBlock.createdAt)
            : undefined,
          updatedAt: step.repeatBlock.updatedAt
            ? new Date(step.repeatBlock.updatedAt)
            : undefined,
        }
      : null,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
  };
}

function mapPrismaTargetToDto(target: WorkoutStepTarget): WorkoutStepTargetDto {
  return {
    workoutStepTargetId: target.workoutStepTargetId,
    targetType: target.targetType,
    targetMin: target.targetMin ?? null,
    targetMax: target.targetMax ?? null,
    targetValue: target.targetValue ?? null,
    metricType: target.metricType ?? null,
    stepId: target.stepId,
    createdAt: target.createdAt ? new Date(target.createdAt) : undefined,
    updatedAt: target.updatedAt ? new Date(target.updatedAt) : undefined,
  } as WorkoutStepTargetDto;
}

export function mapPrismaWorkoutToDto(
  prismaWorkout: StoredWorkout,
): WorkoutDto {
  return {
    workoutId: prismaWorkout.workoutId,
    eventTrainingId: prismaWorkout.eventTrainingId,
    steps: (prismaWorkout.steps || []).map((step) => mapPrismaStepToDto(step)),
    createdAt: prismaWorkout.createdAt
      ? new Date(prismaWorkout.createdAt)
      : undefined,
    updatedAt: prismaWorkout.updatedAt
      ? new Date(prismaWorkout.updatedAt)
      : undefined,
  } as WorkoutDto;
}
