import { SportType } from '@openathlete/database';
import type { WorkoutDto, WorkoutStepDto } from '@openathlete/shared';
import {
  WORKOUT_DURATION_TYPE,
  WORKOUT_STEP_TYPE,
  WORKOUT_TARGET_TYPE,
} from '@openathlete/shared';

import type { SuuntoGuideContext } from './suunto-guide.mapper';
import { mapTargetToSuunto } from './suunto-guide.mapper';

export interface WahooPlanTarget {
  type: 'watts' | 'hr' | 'rpm' | 'speed';
  low: number;
  high: number;
}

export interface WahooPlanInterval {
  name?: string;
  exit_trigger_type: 'time' | 'distance' | 'repeat';
  exit_trigger_value: number;
  intensity_type: 'wu' | 'cd' | 'active' | 'recover';
  targets?: WahooPlanTarget[];
  intervals?: WahooPlanInterval[];
}

export interface WahooPlan {
  header: {
    name: string;
    version: '1.0.0';
    workout_type_family: 0;
    workout_type_location: 0 | 1;
  };
  intervals: WahooPlanInterval[];
}

const byOrder = (a: WorkoutStepDto, b: WorkoutStepDto) =>
  a.orderIndex - b.orderIndex;
const positive = (value: number | null | undefined) =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0;

function intensityType(
  step: WorkoutStepDto,
): WahooPlanInterval['intensity_type'] {
  switch (step.stepType) {
    case WORKOUT_STEP_TYPE.WARMUP:
      return 'wu';
    case WORKOUT_STEP_TYPE.COOLDOWN:
      return 'cd';
    case WORKOUT_STEP_TYPE.INTERVAL_REST:
      return 'recover';
    default:
      return 'active';
  }
}

function mapTarget(
  step: WorkoutStepDto,
  sport: SportType,
  context: SuuntoGuideContext,
): WahooPlanTarget[] {
  const source = step.targets?.[0];
  if (!source || source.targetType === WORKOUT_TARGET_TYPE.OPEN) return [];
  const mapped = mapTargetToSuunto(source, sport, context).field;
  if (!mapped) {
    throw new Error(
      `Wahoo cannot represent workout target ${source.targetType}${source.metricType ? ` (${source.metricType})` : ''}`,
    );
  }
  const values = mapped as { value?: number; min?: number; max?: number };
  const low = values.min ?? values.value ?? values.max;
  const high = values.max ?? values.value ?? values.min;
  if (
    low === undefined ||
    high === undefined ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low < 0 ||
    high < low
  ) {
    throw new Error(`Wahoo target ${mapped.type} has no valid absolute range`);
  }
  switch (mapped.type) {
    case 'targetPower':
      return [{ type: 'watts', low: Math.round(low), high: Math.round(high) }];
    case 'targetHeartRate':
      return [{ type: 'hr', low: Math.round(low), high: Math.round(high) }];
    case 'targetCadence':
      return [
        { type: 'rpm', low: Math.round(low * 60), high: Math.round(high * 60) },
      ];
    case 'targetSpeed':
      return [{ type: 'speed', low, high }];
    default:
      throw new Error(
        `Wahoo cannot represent ${mapped.type} targets on a cycling workout`,
      );
  }
}

function mapStep(
  step: WorkoutStepDto,
  sport: SportType,
  context: SuuntoGuideContext,
): WahooPlanInterval {
  const value = step.durationValue;
  if (!positive(value))
    throw new Error(
      `Wahoo requires a positive duration for step ${step.orderIndex + 1}`,
    );
  let exit_trigger_type: 'time' | 'distance';
  if (step.durationType === WORKOUT_DURATION_TYPE.TIME)
    exit_trigger_type = 'time';
  else if (step.durationType === WORKOUT_DURATION_TYPE.DISTANCE)
    exit_trigger_type = 'distance';
  else
    throw new Error(
      `Wahoo cannot represent ${step.durationType} duration on step ${step.orderIndex + 1}`,
    );

  const duration = Math.round(value);
  if (duration <= 0)
    throw new Error(
      `Wahoo step ${step.orderIndex + 1} duration rounds to zero`,
    );
  const description = [step.name?.trim(), step.notes?.trim()]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 64);
  return {
    ...(description && { name: description }),
    exit_trigger_type,
    exit_trigger_value: duration,
    intensity_type: intensityType(step),
    targets: mapTarget(step, sport, context),
  };
}

/** Convert an OpenAthlete structured workout to Wahoo's plan JSON. */
export function mapWorkoutDtoToWahooPlan(
  workout: WorkoutDto,
  sport: SportType,
  title: string | null,
  indoor: boolean,
  context: SuuntoGuideContext = {},
): WahooPlan {
  const intervals: WahooPlanInterval[] = [];
  for (const step of [...(workout.steps ?? [])].sort(byOrder)) {
    if (step.stepType !== WORKOUT_STEP_TYPE.REPEAT) {
      intervals.push(mapStep(step, sport, context));
      continue;
    }
    const children = [...(step.repeatBlock?.childSteps ?? [])].sort(byOrder);
    const repetitions = step.repeatBlock?.repetitions;
    if (
      !children.length ||
      !Number.isInteger(repetitions) ||
      !repetitions ||
      repetitions < 1
    ) {
      throw new Error(
        `Wahoo repeat step ${step.orderIndex + 1} has no valid repetitions or child steps`,
      );
    }
    intervals.push({
      exit_trigger_type: 'repeat',
      // Wahoo's repeat value means additional iterations after the first.
      exit_trigger_value: repetitions - 1,
      intensity_type: 'active',
      intervals: children.map((child) => mapStep(child, sport, context)),
    });
  }
  if (!intervals.length)
    throw new Error('Wahoo cannot export an empty workout');
  return {
    header: {
      name: (title?.trim() || 'OpenAthlete workout').slice(0, 100),
      version: '1.0.0',
      workout_type_family: 0,
      workout_type_location: indoor ? 0 : 1,
    },
    intervals,
  };
}
