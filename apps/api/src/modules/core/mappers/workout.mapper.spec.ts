import { mapPrismaWorkoutToDto, mapWorkoutDtoToPrisma } from './workout.mapper';

const stored: Parameters<typeof mapPrismaWorkoutToDto>[0] = {
  workoutId: 1,
  eventTrainingId: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  steps: [
    {
      workoutStepId: 10,
      orderIndex: 0,
      stepType: 'REPEAT',
      name: 'Bloc A',
      notes: null,
      durationType: 'OPEN',
      durationValue: null,
      durationTarget: null,
      exerciseRef: null,
      tempo: null,
      side: null,
      workoutId: 1,
      repeatParentId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      targets: [],
      repeatBlock: {
        workoutRepeatId: 5,
        repetitions: 4,
        kind: 'SUPERSET',
        intervalSeconds: null,
        timeCapSeconds: null,
        stepId: 10,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        childSteps: [
          {
            workoutStepId: 11,
            orderIndex: 0,
            stepType: 'INTERVAL_ACTIVE',
            name: 'Squat',
            notes: 'Genoux ouverts',
            durationType: 'REPS',
            durationValue: 8,
            durationTarget: null,
            exerciseRef: 'c:barbell-full-squat',
            tempo: '3-1-1-0',
            side: null,
            workoutId: 1,
            repeatParentId: 10,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            targets: [
              {
                workoutStepTargetId: 1,
                targetType: 'WEIGHT',
                targetMin: null,
                targetMax: null,
                targetValue: 80,
                metricType: null,
                stepId: 11,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
          },
          {
            workoutStepId: 12,
            orderIndex: 1,
            stepType: 'INTERVAL_ACTIVE',
            name: 'Fentes',
            notes: null,
            durationType: 'REPS',
            durationValue: 10,
            durationTarget: null,
            exerciseRef: 'u:42',
            tempo: null,
            side: 'EACH',
            workoutId: 1,
            repeatParentId: 10,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            targets: [],
          },
        ],
      },
    },
  ],
};

describe('API workout mapping', () => {
  it('maps Prisma workouts to DTOs and back without losing strength fields', () => {
    const dto = mapPrismaWorkoutToDto(stored);
    const create = mapWorkoutDtoToPrisma({ steps: dto.steps });

    expect(create.steps).toMatchObject({
      create: [
        {
          name: 'Bloc A',
          repeatBlock: {
            create: {
              kind: 'SUPERSET',
              childSteps: {
                create: [
                  {
                    exerciseRef: 'c:barbell-full-squat',
                    tempo: '3-1-1-0',
                    targets: {
                      create: [{ targetType: 'WEIGHT', targetValue: 80 }],
                    },
                  },
                  { exerciseRef: 'u:42', side: 'EACH' },
                ],
              },
            },
          },
        },
      ],
    });
  });
});
