import { Logger } from '@nestjs/common';

import { ConnectorProvider } from '@openathlete/database';

import { AccountDeletingEvent } from 'src/events';
import { PrismaService } from 'src/modules/prisma/services/prisma.service';
import {
  GarminProviderService,
  PolarProviderService,
  WahooProviderService,
} from 'src/modules/providers-sync/providers';

import { ProviderDeregistrationListener } from './provider-deregistration.listener';

jest.mock('src/modules/providers-sync/providers', () => ({
  GarminProviderService: class {},
  PolarProviderService: class {},
  WahooProviderService: class {},
}));

describe('ProviderDeregistrationListener', () => {
  const garminAccount = {
    providerAccountId: 11,
    athleteId: 7,
    provider: ConnectorProvider.GARMIN,
    refreshToken: 'fixture-refresh-value',
  };
  const polarAccount = {
    providerAccountId: 12,
    athleteId: 7,
    provider: ConnectorProvider.POLAR,
  };
  const wahooAccount = {
    providerAccountId: 13,
    athleteId: 7,
    provider: ConnectorProvider.WAHOO,
    status: 'active',
  };

  function setup(accounts = [garminAccount, polarAccount, wahooAccount]) {
    const prisma = {
      providerAccount: {
        findMany: jest.fn(
          async ({ where }: { where: { provider: ConnectorProvider } }) =>
            accounts.filter((account) => account.provider === where.provider),
        ),
      },
    };
    const garmin = { disconnect: jest.fn().mockResolvedValue(undefined) };
    const polar = { disconnect: jest.fn().mockResolvedValue(undefined) };
    const wahoo = { disconnect: jest.fn().mockResolvedValue(true) };
    const listener = new ProviderDeregistrationListener(
      prisma as unknown as PrismaService,
      garmin as unknown as GarminProviderService,
      polar as unknown as PolarProviderService,
      wahoo as unknown as WahooProviderService,
    );
    return { listener, prisma, garmin, polar, wahoo };
  }

  const event = () => new AccountDeletingEvent({ userId: 5, athleteId: 7 });

  it('disconnects the active Wahoo account for the deleting athlete', async () => {
    const { listener, prisma, wahoo } = setup();
    await listener.handle(event());

    expect(prisma.providerAccount.findMany).toHaveBeenCalledWith({
      where: {
        athleteId: 7,
        provider: ConnectorProvider.WAHOO,
        status: 'active',
      },
    });
    expect(wahoo.disconnect).toHaveBeenCalledWith(wahooAccount);
  });

  it('does nothing when there is no athlete', async () => {
    const { listener, prisma, garmin, polar, wahoo } = setup();
    await listener.handle(new AccountDeletingEvent({ userId: 5 }));
    expect(prisma.providerAccount.findMany).not.toHaveBeenCalled();
    expect(garmin.disconnect).not.toHaveBeenCalled();
    expect(polar.disconnect).not.toHaveBeenCalled();
    expect(wahoo.disconnect).not.toHaveBeenCalled();
  });

  it('continues deletion after Wahoo failure without logging provider details', async () => {
    const { listener, wahoo } = setup();
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    wahoo.disconnect.mockRejectedValueOnce(
      new Error('provider-internal-detail-marker'),
    );
    await expect(listener.handle(event())).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith(
      'Failed to deregister Wahoo account 13; local account deletion will continue',
    );
    expect(loggerError.mock.calls.flat().join(' ')).not.toContain(
      'provider-internal-detail-marker',
    );
    loggerError.mockRestore();
  });

  it('preserves Garmin and Polar deregistration', async () => {
    const { listener, garmin, polar } = setup();
    await listener.handle(event());
    expect(garmin.disconnect).toHaveBeenCalledWith(garminAccount);
    expect(polar.disconnect).toHaveBeenCalledWith(polarAccount);
  });
});
