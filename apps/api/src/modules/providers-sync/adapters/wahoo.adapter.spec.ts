import { ConnectorProvider } from '@openathlete/database';
import {
  SPORT_TYPE,
  WORKOUT_DURATION_TYPE,
  WORKOUT_STEP_TYPE,
  WORKOUT_TARGET_TYPE,
} from '@openathlete/shared';

import { PrismaService } from '../../prisma/services/prisma.service';
import type { WahooProviderService } from '../providers/wahoo.provider.service';
import { WahooAdapter } from './wahoo.adapter';

jest.mock('../../core/helpers/activity-file-parser.service', () => ({
  ActivityFileParserService: class {},
}));
jest.mock('../providers/wahoo.provider.service', () => ({
  WahooProviderService: class {},
}));

describe('WahooAdapter', () => {
  const account = {
    providerAccountId: 4,
    athleteId: 9,
    provider: ConnectorProvider.WAHOO,
    status: 'active',
  };
  const workout = {
    workoutId: 12,
    eventTrainingId: 2,
    steps: [
      {
        orderIndex: 0,
        stepType: WORKOUT_STEP_TYPE.STEADY,
        durationType: WORKOUT_DURATION_TYPE.TIME,
        durationValue: 600,
        targets: [
          {
            targetType: WORKOUT_TARGET_TYPE.POWER,
            targetMin: 100,
            targetMax: 100,
          },
        ],
        repeatBlock: null,
      },
    ],
  };
  function setup(
    apiImpl?: (
      account: unknown,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      data?: Record<string, unknown>,
    ) => unknown,
  ) {
    const prisma = {
      providerAccount: { findFirst: jest.fn().mockResolvedValue(account) },
      workout: { findUnique: jest.fn().mockResolvedValue(workout) },
      athleteMetric: { findMany: jest.fn().mockResolvedValue([]) },
      trainingZone: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const api = {
      makeApiRequest: jest.fn(
        apiImpl ??
          (async (_a, method, path) => {
            if (method === 'GET' && path.includes('/plans?')) return [];
            if (method === 'GET' && path.includes('/plans?')) return [];
            if (method === 'GET' && path.includes('/workouts?')) return [];
            if (method === 'GET' && /\/workouts\/\d/.test(path))
              return { workout_token: 'openathlete-9-12' };
            if (method === 'GET' && /\/plans\/\d/.test(path))
              return {
                id: path.split('/').pop(),
                external_id: 'openathlete-9-12',
              };
            if (method === 'POST' && path === '/v1/plans') return { id: 21 };
            if (method === 'POST' && path === '/v1/workouts') return { id: 31 };
            if (method === 'PUT') return { id: path.split('/').pop() };
            return {};
          }),
      ),
    };
    const adapter = new WahooAdapter(
      prisma as unknown as PrismaService,
      api as unknown as WahooProviderService,
    );
    return { adapter, prisma, api };
  }

  it('creates both plan and schedule and returns their stable provider ids', async () => {
    const { adapter, api } = setup();
    const result = await adapter.upsertPlannedWorkout({
      athleteId: 9,
      workoutId: 12,
      date: new Date().toISOString().slice(0, 10),
      normalized: { sport: SPORT_TYPE.CYCLING, steps: [] },
    });
    expect(result).toEqual({ externalId: '21', scheduleId: '31' });
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'POST',
      '/v1/plans',
      expect.objectContaining({
        'plan[external_id]': 'openathlete-9-12',
        'plan[filename]': 'openathlete-9-12.json',
      }),
    );
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'POST',
      '/v1/workouts',
      expect.objectContaining({
        'workout[plan_id]': '21',
        'workout[workout_token]': 'openathlete-9-12',
        'workout[minutes]': 10,
      }),
    );
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'POST',
      '/v1/workouts',
      expect.objectContaining({
        'workout[starts]': expect.stringMatching(/T12:00:00\.000Z$/),
        'workout[day_code]': expect.any(Number),
      }),
    );
  });

  it('includes normalized coach instructions in the uploaded plan description', async () => {
    const { adapter, api } = setup();
    await adapter.upsertPlannedWorkout({
      athleteId: 9,
      workoutId: 12,
      date: new Date().toISOString().slice(0, 10),
      normalized: {
        sport: SPORT_TYPE.CYCLING,
        steps: [],
        description: '  Coach instructions  ',
      },
    });
    const call = api.makeApiRequest.mock.calls.find(
      ([, method, path]) => method === 'POST' && path === '/v1/plans',
    );
    const encoded = call?.[3]?.['plan[file]'];
    const plan = JSON.parse(
      Buffer.from(String(encoded).split(',')[1] ?? '', 'base64').toString(),
    );
    expect(plan.header.description).toBe('Coach instructions');
  });

  it('updates owned plan and schedule rather than creating duplicates', async () => {
    const { adapter, api } = setup(async (_a, method, path) => {
      if (method === 'GET' && path === '/v1/workouts/31')
        return { workout_token: 'openathlete-9-12' };
      if (method === 'GET' && path === '/v1/plans/21')
        return { id: 21, external_id: 'openathlete-9-12' };
      if (method === 'GET' && path === '/v1/workouts/31')
        return { workout_token: 'openathlete-9-12' };
      return { id: path.split('/').pop() };
    });
    const result = await adapter.upsertPlannedWorkout({
      athleteId: 9,
      workoutId: 12,
      date: new Date().toISOString().slice(0, 10),
      previousExternalId: '21',
      previousScheduleId: '31',
      normalized: { sport: SPORT_TYPE.CYCLING, steps: [] },
    });
    expect(result).toEqual({ externalId: '21', scheduleId: '31' });
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'PUT',
      '/v1/plans/21',
      expect.any(Object),
    );
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'PUT',
      '/v1/workouts/31',
      expect.any(Object),
    );
  });

  it('recovers both resources after lost create responses by stable IDs', async () => {
    const { adapter, api } = setup(async (_a, method, path) => {
      if (method === 'GET' && path.includes('/plans?'))
        return [{ id: 21, external_id: 'openathlete-9-12' }];
      if (method === 'GET' && path.includes('/workouts?'))
        return [{ id: 31, workout_token: 'openathlete-9-12' }];
      if (method === 'GET' && path === '/v1/workouts/31')
        return { workout_token: 'openathlete-9-12' };
      if (method === 'GET' && path === '/v1/plans/21')
        return { id: 21, external_id: 'openathlete-9-12' };
      return { id: path.split('/').pop() };
    });
    await adapter.upsertPlannedWorkout({
      athleteId: 9,
      workoutId: 12,
      date: new Date().toISOString().slice(0, 10),
      normalized: { sport: SPORT_TYPE.CYCLING, steps: [] },
    });
    expect(api.makeApiRequest).not.toHaveBeenCalledWith(
      account,
      'POST',
      '/v1/plans',
      expect.anything(),
    );
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'PUT',
      '/v1/plans/21',
      expect.any(Object),
    );
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'PUT',
      '/v1/workouts/31',
      expect.any(Object),
    );
  });

  it('refuses to update or delete completed schedules', async () => {
    const { adapter, api } = setup(async (_a, method, path) => {
      if (method === 'GET' && path === '/v1/workouts/31')
        return {
          workout_token: 'openathlete-9-12',
          workout_summary: { id: 8 },
        };
      if (method === 'GET' && path === '/v1/plans/21')
        return { id: 21, external_id: 'openathlete-9-12' };
      return { id: path.split('/').pop() };
    });
    await expect(
      adapter.upsertPlannedWorkout({
        athleteId: 9,
        workoutId: 12,
        date: new Date().toISOString().slice(0, 10),
        previousExternalId: '21',
        previousScheduleId: '31',
        normalized: { sport: SPORT_TYPE.CYCLING, steps: [] },
      }),
    ).rejects.toThrow(/completed/);
    await adapter.deletePlannedWorkout({
      athleteId: 9,
      externalId: '21',
      scheduleId: '31',
    });
    expect(api.makeApiRequest).not.toHaveBeenCalledWith(
      account,
      'DELETE',
      '/v1/workouts/31',
    );
    expect(api.makeApiRequest).not.toHaveBeenCalledWith(
      account,
      'DELETE',
      '/v1/plans/21',
    );
  });

  it('deletes the owned workout and plan', async () => {
    const { adapter, api } = setup();
    await adapter.deletePlannedWorkout({
      athleteId: 9,
      externalId: '21',
      scheduleId: '31',
    });
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'DELETE',
      '/v1/workouts/31',
    );
    expect(api.makeApiRequest).toHaveBeenCalledWith(
      account,
      'DELETE',
      '/v1/plans/21',
    );
  });
});
