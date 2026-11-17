import type { NormalizedWorkout } from '@openathlete/shared';

import { ProviderExportService } from './export.service';

jest.mock('./adapters', () => ({
  GarminAdapter: class {},
  SuuntoAdapter: class {},
  CorosAdapter: class {},
  WahooAdapter: class {},
}));

const normalized = {
  sport: 'RUNNING',
  title: 'Intervals',
  steps: [{ orderIndex: 0 }],
} as unknown as NormalizedWorkout;

function setup(existing: Record<string, unknown> | null) {
  const record = {
    providerWorkoutExportId: 9,
    externalId: '55',
    scheduleId: '77',
  };
  const prisma = {
    workout: {
      findUnique: jest.fn().mockResolvedValue({
        eventTraining: {
          event: {
            athleteId: 1,
            startDate: new Date('2026-10-28T00:00:00.000Z'),
          },
        },
      }),
    },
    providerWorkoutExport: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue(record),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const garmin = {
    upsertPlannedWorkout: jest
      .fn()
      .mockResolvedValue({ externalId: '55', scheduleId: '77' }),
    deletePlannedWorkout: jest.fn(),
  };
  const analytics = { captureForAthlete: jest.fn() };
  const exportLock = {
    withLock: jest.fn(
      (
        _workoutId: number,
        work: (assertHeld: () => Promise<void>) => Promise<unknown>,
      ) => work(async () => {}),
    ),
  };
  const wahoo = {
    upsertPlannedWorkout: jest
      .fn()
      .mockResolvedValue({ externalId: 'wahoo-55', scheduleId: 'wahoo-77' }),
    deletePlannedWorkout: jest.fn(),
  };
  const service = new ProviderExportService(
    prisma as never,
    garmin as never,
    {} as never,
    {} as never,
    wahoo as never,
    exportLock as never,
    analytics as never,
  );
  return { service, prisma, garmin, wahoo, analytics, exportLock };
}

const params = {
  athleteId: 1,
  provider: 'garmin' as const,
  workoutId: 3,
  date: '2026-10-28',
  normalized,
};

function createSerialTestLock() {
  const tails = new Map<number, Promise<void>>();
  return {
    withLock: async <T>(
      workoutId: number,
      work: (assertHeld: () => Promise<void>) => Promise<T>,
    ) => {
      const previous = tails.get(workoutId) ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((resolve) => (release = resolve));
      tails.set(workoutId, next);
      await previous;
      try {
        return await work(async () => {});
      } finally {
        release();
        if (tails.get(workoutId) === next) tails.delete(workoutId);
      }
    },
  };
}

function setupConcurrentServices(
  lock: ReturnType<typeof createSerialTestLock>,
) {
  type ExportRecord = {
    providerWorkoutExportId: number;
    externalId: string | null;
    scheduleId: string | null;
    status: 'pending' | 'success' | 'failed';
    contentHash: string;
    provider: 'GARMIN';
    athleteId: number;
    workoutId: number;
    plannedDate: Date;
    attemptCount: number;
  };
  let record: ExportRecord | null = null;
  let currentWorkout: { athleteId: number; startDate: Date } | null = {
    athleteId: 1,
    startDate: new Date('2026-10-28T00:00:00.000Z'),
  };
  const prisma = {
    workout: {
      findUnique: jest.fn(async () =>
        currentWorkout
          ? { eventTraining: { event: { ...currentWorkout } } }
          : null,
      ),
    },
    providerWorkoutExport: {
      findMany: jest.fn(async ({ where }: { where: { provider?: string } }) =>
        where.provider ? [] : record ? [{ ...record }] : [],
      ),
      findUnique: jest.fn(async () => (record ? { ...record } : null)),
      upsert: jest.fn(
        async (args: {
          create: { contentHash: string; plannedDate: Date };
        }) => {
          record = {
            providerWorkoutExportId: 9,
            externalId: record?.externalId ?? null,
            scheduleId: record?.scheduleId ?? null,
            status: 'pending',
            contentHash: args.create.contentHash,
            provider: 'GARMIN',
            athleteId: 1,
            workoutId: 3,
            plannedDate: args.create.plannedDate,
            attemptCount: record?.attemptCount ?? 0,
          };
          return { ...record };
        },
      ),
      updateMany: jest.fn(
        async (args: {
          data: {
            externalId?: string;
            scheduleId?: string | null;
            status?: 'success' | 'failed';
            attemptCount?: { increment: number };
          };
        }) => {
          if (record) {
            record = {
              ...record,
              ...args.data,
              attemptCount:
                record.attemptCount + (args.data.attemptCount?.increment ?? 0),
            };
          }
        },
      ),
      deleteMany: jest.fn(async () => {
        record = null;
      }),
    },
  };
  const adapter = {
    upsertPlannedWorkout: jest
      .fn()
      .mockResolvedValue({ externalId: '55', scheduleId: '77' }),
    deletePlannedWorkout: jest.fn().mockResolvedValue(undefined),
  };
  const makeService = () =>
    new ProviderExportService(
      prisma as never,
      adapter as never,
      {} as never,
      {} as never,
      {} as never,
      lock as never,
    );
  return {
    prisma,
    adapter,
    makeService,
    getRecord: () => record,
    removeWorkout: () => {
      currentWorkout = null;
    },
    moveWorkout: (startDate: Date) => {
      currentWorkout = { athleteId: 1, startDate };
    },
  };
}

describe('ProviderExportService.upsertPlannedExport', () => {
  it('serializes concurrent upserts so the second sees the saved external id', async () => {
    const fixture = setupConcurrentServices(createSerialTestLock());
    let finishRemoteCreate!: () => void;
    let remoteStarted!: () => void;
    const remoteEntered = new Promise<void>(
      (resolve) => (remoteStarted = resolve),
    );
    const remoteResult = new Promise<void>(
      (resolve) => (finishRemoteCreate = resolve),
    );
    fixture.adapter.upsertPlannedWorkout.mockImplementation(async () => {
      remoteStarted();
      await remoteResult;
      return { externalId: '55', scheduleId: '77' };
    });

    const first = fixture.makeService().upsertPlannedExport(params);
    await remoteEntered;
    const second = fixture.makeService().upsertPlannedExport(params);
    finishRemoteCreate();
    const results = await Promise.all([first, second]);

    expect(fixture.adapter.upsertPlannedWorkout).toHaveBeenCalledTimes(1);
    expect(results[1]).toEqual({ skipped: true, externalId: '55' });
    expect(fixture.getRecord()?.externalId).toBe('55');
  });

  it('waits for an in-flight create before deleting the remote workout and row', async () => {
    const fixture = setupConcurrentServices(createSerialTestLock());
    const effects: string[] = [];
    let finishRemoteCreate!: () => void;
    let remoteStarted!: () => void;
    const remoteEntered = new Promise<void>(
      (resolve) => (remoteStarted = resolve),
    );
    const remoteResult = new Promise<void>(
      (resolve) => (finishRemoteCreate = resolve),
    );
    fixture.adapter.upsertPlannedWorkout.mockImplementation(async () => {
      effects.push('create');
      remoteStarted();
      await remoteResult;
      return { externalId: '55', scheduleId: '77' };
    });
    fixture.adapter.deletePlannedWorkout.mockImplementation(async () => {
      effects.push('delete');
    });

    const create = fixture.makeService().upsertPlannedExport(params);
    await remoteEntered;
    const deletion = fixture
      .makeService()
      .deleteExportsForWorkout({ workoutId: params.workoutId });
    finishRemoteCreate();
    await Promise.all([create, deletion]);

    expect(effects).toEqual(['create', 'delete']);
    expect(fixture.getRecord()).toBeNull();
    expect(
      fixture.prisma.providerWorkoutExport.deleteMany,
    ).toHaveBeenCalledWith({ where: { workoutId: params.workoutId } });
  });

  it('does not recreate a workout after deletion wins the lease', async () => {
    const fixture = setupConcurrentServices(createSerialTestLock());
    const service = fixture.makeService();
    await service.upsertPlannedExport(params);
    let finishRemoteDelete!: () => void;
    let remoteDeleteStarted!: () => void;
    const deleteEntered = new Promise<void>(
      (resolve) => (remoteDeleteStarted = resolve),
    );
    const remoteDelete = new Promise<void>((resolve) => {
      finishRemoteDelete = resolve;
    });
    fixture.adapter.deletePlannedWorkout.mockImplementation(async () => {
      remoteDeleteStarted();
      await remoteDelete;
    });

    const deletion = service.deleteExportsForWorkout(
      { workoutId: params.workoutId },
      async () => fixture.removeWorkout(),
    );
    await deleteEntered;
    const pendingExport = fixture.makeService().upsertPlannedExport(params);
    finishRemoteDelete();
    await Promise.all([deletion, pendingExport]);

    expect(fixture.adapter.deletePlannedWorkout).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.upsertPlannedWorkout).toHaveBeenCalledTimes(1);
    expect(await pendingExport).toEqual({ skipped: true });
    expect(fixture.getRecord()).toBeNull();
  });

  it('skips an export intent for a workout that moved dates', async () => {
    const { service, prisma, garmin } = setup(null);
    prisma.workout.findUnique.mockResolvedValue({
      eventTraining: {
        event: {
          athleteId: 1,
          startDate: new Date('2026-10-29T00:00:00.000Z'),
        },
      },
    });

    await expect(service.upsertPlannedExport(params)).resolves.toEqual({
      skipped: true,
    });
    expect(garmin.upsertPlannedWorkout).not.toHaveBeenCalled();
    expect(prisma.providerWorkoutExport.upsert).not.toHaveBeenCalled();
  });

  it('routes Wahoo exports through its adapter and stores the provider', async () => {
    const { service, prisma, garmin, wahoo } = setup(null);
    await service.upsertPlannedExport({ ...params, provider: 'wahoo' });
    expect(wahoo.upsertPlannedWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ athleteId: 1, workoutId: 3 }),
    );
    expect(garmin.upsertPlannedWorkout).not.toHaveBeenCalled();
    expect(prisma.providerWorkoutExport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: 'WAHOO' }),
      }),
    );
  });

  it('keeps the external identifiers when deletion fails', async () => {
    const { service, prisma, wahoo } = setup(null);
    prisma.providerWorkoutExport.findMany.mockResolvedValue([
      {
        provider: 'WAHOO',
        athleteId: 1,
        externalId: '55',
        scheduleId: '77',
        plannedDate: new Date('2026-11-15'),
      },
    ]);
    wahoo.deletePlannedWorkout.mockRejectedValue(new Error('unavailable'));
    await expect(
      service.deleteExportsForWorkout({ workoutId: 3 }),
    ).rejects.toThrow('unavailable');
    expect(prisma.providerWorkoutExport.deleteMany).not.toHaveBeenCalled();
  });

  it('does not forget a stale schedule when removing it fails', async () => {
    const { service, prisma, garmin } = setup(null);
    prisma.providerWorkoutExport.findMany.mockResolvedValue([
      {
        providerWorkoutExportId: 9,
        externalId: '55',
        scheduleId: '77',
        plannedDate: new Date('2026-11-14'),
      },
    ]);
    garmin.deletePlannedWorkout.mockRejectedValue(new Error('unavailable'));
    await expect(service.upsertPlannedExport(params)).rejects.toThrow(
      'unavailable',
    );
    expect(prisma.providerWorkoutExport.deleteMany).not.toHaveBeenCalled();
    expect(garmin.upsertPlannedWorkout).not.toHaveBeenCalled();
  });

  it('reports a workout that reached the device', async () => {
    const { service, analytics } = setup(null);
    await service.upsertPlannedExport(params);

    expect(analytics.captureForAthlete).toHaveBeenCalledWith(
      1,
      'workout_sent_to_device',
      { provider: 'GARMIN', is_update: true },
    );
  });

  it('reports nothing when the device refuses the workout', async () => {
    const { service, garmin, analytics } = setup(null);
    garmin.upsertPlannedWorkout.mockRejectedValue(new Error('refused'));

    await expect(service.upsertPlannedExport(params)).rejects.toThrow();
    expect(analytics.captureForAthlete).not.toHaveBeenCalled();
  });

  it('sends nothing for a workout exported unchanged', async () => {
    const { service, prisma, garmin } = setup(null);
    await service.upsertPlannedExport(params);
    const contentHash =
      prisma.providerWorkoutExport.upsert.mock.calls[0][0].create.contentHash;

    const again = setup({ status: 'success', contentHash, externalId: '55' });
    const result = await again.service.upsertPlannedExport(params);

    expect(garmin.upsertPlannedWorkout).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ skipped: true, externalId: '55' });
    expect(again.garmin.upsertPlannedWorkout).not.toHaveBeenCalled();
    expect(again.prisma.providerWorkoutExport.upsert).not.toHaveBeenCalled();
  });

  it('skips a session without steps, which is no failure', async () => {
    const { service, prisma, garmin } = setup(null);

    const result = await service.upsertPlannedExport({
      ...params,
      normalized: { ...normalized, steps: [] },
    });

    expect(result).toEqual({ skipped: true });
    expect(garmin.upsertPlannedWorkout).not.toHaveBeenCalled();
    expect(prisma.providerWorkoutExport.upsert).not.toHaveBeenCalled();
  });

  it('only treats exports of other days as stale', async () => {
    const { service, prisma, garmin } = setup(null);
    await service.upsertPlannedExport(params);

    expect(prisma.providerWorkoutExport.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        NOT: { plannedDate: new Date('2026-10-28T00:00:00.000Z') },
      }),
    });
    expect(garmin.upsertPlannedWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        previousExternalId: '55',
        previousScheduleId: '77',
      }),
    );
  });
});
