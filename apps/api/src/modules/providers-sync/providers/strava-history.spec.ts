import axios from 'axios';

import type { ProviderAccount } from '@openathlete/database';

import { StravaProviderService } from './strava.provider.service';

jest.mock('axios', () => ({
  __esModule: true,
  ...jest.requireActual('axios'),
  default: { get: jest.fn(), post: jest.fn() },
}));

describe('Strava historical ranges', () => {
  it('uses widened API bounds and applies inclusive exact bounds locally', async () => {
    const axiosGet = axios.get as jest.Mock;
    axiosGet.mockReset();
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    const endDate = new Date('2026-10-02T23:59:59.999Z');
    const account = {
      providerAccountId: 1,
      athleteId: 2,
      accessToken: 'token',
      refreshToken: 'refresh',
    } as ProviderAccount;
    const service = new StravaProviderService(
      {} as never,
      { get: jest.fn().mockReturnValue('') } as never,
      {} as never,
    );
    axiosGet
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            name: 'Start boundary',
            start_date: startDate.toISOString(),
            elapsed_time: 60,
            type: 'Run',
            sport_type: 'Run',
            distance: 100,
          },
          {
            id: 2,
            name: 'End boundary',
            start_date: endDate.toISOString(),
            elapsed_time: 60,
            type: 'Run',
            sport_type: 'Run',
            distance: 100,
          },
          {
            id: 3,
            name: 'Outside range',
            start_date: new Date(endDate.getTime() + 1000).toISOString(),
            elapsed_time: 60,
            type: 'Run',
            sport_type: 'Run',
            distance: 100,
          },
        ],
      })
      .mockResolvedValue({ data: [] });

    const activities = await service.importActivities(account, {
      startDate,
      endDate,
    });

    expect(axiosGet).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/athlete/activities',
      expect.objectContaining({
        params: {
          page: 1,
          per_page: 200,
          after: startDate.getTime() / 1000 - 1,
          before: Math.floor(endDate.getTime() / 1000) + 1,
        },
      }),
    );
    expect(activities.map(({ externalId }) => externalId)).toEqual(['1', '2']);
  });

  it('creates the activity and its event atomically', async () => {
    const prisma = {
      athlete: { findUnique: jest.fn().mockResolvedValue({ athleteId: 2 }) },
      eventActivity: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ eventActivityId: 5 }),
      },
    };
    const service = new StravaProviderService(
      prisma as never,
      { get: jest.fn().mockReturnValue('') } as never,
      {} as never,
    );
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    const endDate = new Date('2026-10-01T00:01:00.000Z');

    await service.importActivity(
      {
        providerAccountId: 1,
        athleteId: 2,
        accessToken: 'token',
      } as ProviderAccount,
      {
        externalId: '55',
        name: 'Morning run',
        startDate,
        endDate,
        sport: 'RUN',
        raw: {
          id: 55,
          name: 'Morning run',
          manual: true,
          start_date: startDate.toISOString(),
          elapsed_time: 60,
          moving_time: 60,
          type: 'Run',
          sport_type: 'Run',
          distance: 100,
        },
      },
    );

    expect(prisma.eventActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalId: '55',
          event: {
            create: {
              athleteId: 2,
              name: 'Morning run',
              type: 'ACTIVITY',
              startDate,
              endDate,
            },
          },
        }),
      }),
    );
  });
});
