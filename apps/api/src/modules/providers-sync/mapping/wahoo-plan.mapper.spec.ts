import { SportType } from '@openathlete/database';
import {
  WORKOUT_DURATION_TYPE,
  WORKOUT_STEP_TYPE,
  WORKOUT_TARGET_TYPE,
} from '@openathlete/shared';
import type { WorkoutDto } from '@openathlete/shared';

import { mapWorkoutDtoToWahooPlan } from './wahoo-plan.mapper';

const step = (orderIndex: number, extra: object = {}) => ({
  orderIndex,
  stepType: WORKOUT_STEP_TYPE.STEADY,
  durationType: WORKOUT_DURATION_TYPE.TIME,
  durationValue: 60,
  targets: [
    {
      targetType: WORKOUT_TARGET_TYPE.POWER,
      targetMin: 100,
      targetMax: 100,
    },
  ],
  ...extra,
});

describe('mapWorkoutDtoToWahooPlan', () => {
  it('uses Wahoo repeat count as iterations after the first', () => {
    const dto = {
      eventTrainingId: 1,
      steps: [
        {
          ...step(0, {
            stepType: WORKOUT_STEP_TYPE.REPEAT,
            durationType: WORKOUT_DURATION_TYPE.OPEN,
            durationValue: null,
          }),
          repeatBlock: {
            repetitions: 4,
            childSteps: [
              step(0),
              step(1, { stepType: WORKOUT_STEP_TYPE.INTERVAL_REST }),
            ],
          },
        },
      ],
    } as WorkoutDto;
    const plan = mapWorkoutDtoToWahooPlan(
      dto,
      SportType.CYCLING,
      'Intervals',
      false,
    );
    expect(plan.intervals[0]).toMatchObject({
      exit_trigger_type: 'repeat',
      exit_trigger_value: 3,
      intervals: [
        { exit_trigger_type: 'time', exit_trigger_value: 60 },
        { intensity_type: 'recover' },
      ],
    });
  });

  it('always supplies a nonempty description and preserves trimmed instructions', () => {
    const dto = { eventTrainingId: 1, steps: [step(0)] } as WorkoutDto;
    expect(
      mapWorkoutDtoToWahooPlan(dto, SportType.CYCLING, ' Ride ', false).header
        .description,
    ).toBe('Ride');
    expect(
      mapWorkoutDtoToWahooPlan(dto, SportType.CYCLING, null, false).header
        .description,
    ).toBe('OpenAthlete workout');
    expect(
      mapWorkoutDtoToWahooPlan(
        dto,
        SportType.CYCLING,
        null,
        false,
        {},
        '  Coach notes  ',
      ).header.description,
    ).toBe('Coach notes');
    expect(
      mapWorkoutDtoToWahooPlan(
        dto,
        SportType.CYCLING,
        null,
        false,
        {},
        'x'.repeat(5001),
      ).header.description,
    ).toHaveLength(5000);
  });

  it('resolves percentage power against the athlete FTP', () => {
    const dto = {
      eventTrainingId: 1,
      steps: [
        step(0, {
          targets: [
            {
              targetType: WORKOUT_TARGET_TYPE.POWER,
              targetMin: 0.8,
              targetMax: 0.9,
              metricType: 'FTP_CYCLING',
            },
          ],
        }),
      ],
    } as WorkoutDto;
    const plan = mapWorkoutDtoToWahooPlan(dto, SportType.CYCLING, null, false, {
      metrics: { FTP_CYCLING: { value: 250 } },
    });
    expect(plan.intervals[0].targets).toEqual([
      { type: 'watts', low: 200, high: 225 },
    ]);
  });

  it('rejects durations Wahoo cannot trigger on', () => {
    const dto = {
      eventTrainingId: 1,
      steps: [
        step(0, {
          durationType: WORKOUT_DURATION_TYPE.CALORIES,
          durationValue: 30,
        }),
      ],
    } as WorkoutDto;
    expect(() =>
      mapWorkoutDtoToWahooPlan(dto, SportType.CYCLING, null, false),
    ).toThrow(/cannot represent CALORIES duration/);
  });

  it('rejects unresolved zones instead of silently dropping the target', () => {
    const dto = {
      eventTrainingId: 1,
      steps: [
        step(0, {
          targets: [{ targetType: WORKOUT_TARGET_TYPE.ZONE, targetValue: 99 }],
        }),
      ],
    } as WorkoutDto;
    expect(() =>
      mapWorkoutDtoToWahooPlan(dto, SportType.CYCLING, null, false),
    ).toThrow(/cannot represent workout target ZONE/);
  });

  it('rejects open intervals without explicit targets, including repeat children', () => {
    const dto = {
      eventTrainingId: 1,
      steps: [step(0, { targets: [{ targetType: WORKOUT_TARGET_TYPE.OPEN }] })],
    } as WorkoutDto;
    expect(() =>
      mapWorkoutDtoToWahooPlan(dto, SportType.CYCLING, null, false),
    ).toThrow(/requires an explicit .* target for each interval/);

    const repeated = {
      eventTrainingId: 1,
      steps: [
        {
          ...step(0, {
            stepType: WORKOUT_STEP_TYPE.REPEAT,
            durationType: WORKOUT_DURATION_TYPE.OPEN,
            durationValue: null,
          }),
          repeatBlock: {
            repetitions: 2,
            childSteps: [
              step(0, { targets: [{ targetType: WORKOUT_TARGET_TYPE.OPEN }] }),
            ],
          },
        },
      ],
    } as WorkoutDto;
    expect(() =>
      mapWorkoutDtoToWahooPlan(repeated, SportType.CYCLING, null, false),
    ).toThrow(/requires an explicit .* target for each interval/);
  });
});
