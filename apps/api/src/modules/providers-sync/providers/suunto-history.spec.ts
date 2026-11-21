import axios from 'axios';

import type { ProviderAccount } from '@openathlete/database';

import { SuuntoProviderService } from './suunto.provider.service';

jest.mock('../../core/helpers/activity-file-parser.service', () => ({
  ActivityFileParserService: class {},
}));
jest.mock('axios', () => ({
  __esModule: true,
  ...jest.requireActual('axios'),
  default: { get: jest.fn(), post: jest.fn() },
}));

describe('Suunto historical ranges', () => {
  const account = {
    providerAccountId: 1,
    athleteId: 2,
    status: 'active',
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: new Date(Date.now() + 3_600_000),
    importMetricsEnabled: false,
  } as ProviderAccount;

  function setup() {
    const queue = {
      addActivityImportJobs: jest.fn(),
      addSuuntoMetricsJob: jest.fn(),
    };
    const prisma = {
      providerAccount: {
        findUnique: jest.fn().mockResolvedValue(account),
        update: jest.fn(),
      },
    };
    const service = new SuuntoProviderService(
      prisma as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      queue as never,
      {} as never,
    );
    return { service, queue };
  }

  beforeEach(() => (axios.get as jest.Mock).mockReset());

  it('uses activity dates for full imports and honors the selected range', async () => {
    const { service } = setup();
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    const endDate = new Date('2026-10-31T23:59:59.999Z');
    (axios.get as jest.Mock).mockResolvedValue({
      data: { error: null, payload: [], metadata: {} },
    });

    await service.queueFullImport(account, { startDate, endDate });

    expect(axios.get).toHaveBeenCalledWith(
      'https://cloudapi.suunto.com/v3/workouts',
      expect.objectContaining({
        params: expect.objectContaining({
          since: startDate.getTime(),
          until: endDate.getTime(),
          'filter-by-modification-time': false,
        }),
      }),
    );
  });

  it('surfaces rejected historical ranges instead of treating them as empty', async () => {
    const { service } = setup();
    (axios.get as jest.Mock).mockRejectedValue(
      Object.assign(new Error('HTTP 400'), {
        isAxiosError: true,
        response: { status: 400, data: {} },
      }),
    );

    await expect(
      service.queueFullImport(account, {
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T23:59:59.999Z'),
      }),
    ).rejects.toThrow('Failed to queue Suunto activities');
  });
});
