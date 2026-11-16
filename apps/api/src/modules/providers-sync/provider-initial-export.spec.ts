import { ProviderConnectedEvent } from '../../events/provider-connected.event';
import { ProviderExportScheduler } from './scheduler.service';

jest.mock('./export.service', () => ({ ProviderExportService: class {} }));

function setup(worker = true) {
  const prisma = {
    providerAccount: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const scheduler = new ProviderExportScheduler(
    prisma as never,
    {} as never,
    { get: () => worker } as never,
  );
  return { scheduler, prisma };
}

describe('Initial provider export and Wahoo recovery', () => {
  it.each(['WAHOO', 'GARMIN'] as const)(
    'sends previously planned workouts for the athlete who just connected %s',
    async (provider) => {
      const { scheduler } = setup();
      const sync = jest
        .spyOn(scheduler, 'syncExportsForWindow')
        .mockResolvedValue(undefined);
      await scheduler.onProviderConnected(
        new ProviderConnectedEvent(42, provider),
      );
      expect(sync).toHaveBeenCalledWith(undefined, undefined, 42, provider);
    },
  );

  it('recovers pending Wahoo exports without resending to other providers', async () => {
    const { scheduler, prisma } = setup();
    await scheduler.syncWahooExports();
    expect(prisma.providerAccount.findMany).toHaveBeenCalledWith({
      where: {
        provider: 'WAHOO',
        status: 'active',
        exportWorkoutsEnabled: true,
      },
      select: { athleteId: true, provider: true },
    });
  });

  it('does not run the recovery schedule in a container without import workers', async () => {
    const { scheduler, prisma } = setup(false);
    await scheduler.syncWahooExports();
    expect(prisma.providerAccount.findMany).not.toHaveBeenCalled();
  });
});
