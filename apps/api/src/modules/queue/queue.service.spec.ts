import { QueueService } from './queue.service';

describe('QueueService activity imports', () => {
  const account = {
    provider: 'STRAVA',
    providerAccountId: 12,
  } as never;
  const activity = {
    externalId: 'activity-1',
    startDate: '2026-01-01',
  } as never;
  let queue: { getJob: jest.Mock; add: jest.Mock; addBulk: jest.Mock };
  let service: QueueService;

  beforeEach(() => {
    queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      addBulk: jest.fn().mockResolvedValue(undefined),
    };
    service = new QueueService(
      queue as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('propagates a bulk getJob failure', async () => {
    const error = new Error('Redis unavailable');
    queue.getJob.mockRejectedValue(error);

    await expect(
      service.addActivityImportJobs(account, [activity]),
    ).rejects.toBe(error);
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it('binds history activities to the connected provider identity', async () => {
    await service.addActivityImportJobs(
      {
        provider: 'GARMIN',
        providerAccountId: 12,
        externalUserId: 'remote-123',
      } as never,
      [activity],
      true,
    );

    expect(queue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: {
          providerAccountId: 12,
          activity,
          bulkImport: true,
          providerExternalUserId: 'remote-123',
        },
      }),
    ]);
  });

  it.each(['getState', 'remove'] as const)(
    'propagates a bulk existing-job %s failure',
    async (operation) => {
      const error = new Error(`${operation} failed`);
      const existing = {
        getState: jest.fn().mockResolvedValue('completed'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      existing[operation].mockRejectedValue(error);
      queue.getJob.mockResolvedValue(existing);

      await expect(
        service.addActivityImportJobs(account, [activity]),
      ).rejects.toBe(error);
      expect(queue.addBulk).not.toHaveBeenCalled();
    },
  );
});
