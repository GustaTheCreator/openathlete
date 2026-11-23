import { providerFullImportRequestSchema } from '@openathlete/shared';

import { ProviderOAuthController } from './provider-oauth.controller';

jest.mock('src/modules/auth', () => ({
  JwtUser: () => () => undefined,
  UserTypeGuard: class {},
}));
jest.mock('src/modules/queue/queue.service', () => ({
  QueueService: class {},
}));
jest.mock('../providers', () => ({
  CorosProviderService: class {},
  SuuntoProviderService: class {},
  WahooProviderService: class {},
}));
jest.mock('../providers/garmin.provider.service', () => ({
  GarminProviderService: class {},
}));
jest.mock('../providers/polar.provider.service', () => ({
  PolarProviderService: class {},
}));
jest.mock('../providers/strava.provider.service', () => ({
  StravaProviderService: class {},
}));

function setup(configured = true) {
  const queue = {
    rememberWahooOAuth: jest.fn(),
    consumeWahooOAuth: jest.fn().mockResolvedValue(true),
    addFullImportJob: jest.fn().mockResolvedValue(true),
  };
  const emitter = { emit: jest.fn() };
  const garmin = {
    connect: jest.fn().mockResolvedValue({
      providerAccountId: 10,
      provider: 'GARMIN',
      status: 'active',
      athleteId: 42,
      accessToken: 'private-access',
    }),
  };
  const wahoo = {
    assertCanConnect: jest.fn().mockResolvedValue(undefined),
    getAuthorizationUriWithPKCE: jest.fn().mockReturnValue({
      uri: 'https://api.wahooligan.com/oauth/authorize',
      state: 's'.repeat(43),
      codeVerifier: 'verifier',
    }),
    connect: jest.fn().mockResolvedValue({
      providerAccountId: 9,
      provider: 'WAHOO',
      status: 'active',
      athleteId: 42,
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      oauthCodeVerifier: 'private-verifier',
    }),
    disconnect: jest.fn(),
  };
  const prisma = {
    athlete: { findUnique: jest.fn().mockResolvedValue({ athleteId: 42 }) },
    providerAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const config = {
    get: (key: string) =>
      configured && key === 'WAHOO_CLIENT_ID' ? 'client' : '',
  };
  const controller = new ProviderOAuthController(
    config as never,
    {} as never,
    garmin as never,
    {} as never,
    {} as never,
    {} as never,
    wahoo as never,
    prisma as never,
    queue as never,
    emitter as never,
  );
  return { controller, wahoo, garmin, prisma, queue, emitter };
}

describe('Wahoo OAuth controller', () => {
  it('starts initial Garmin export for the linked athlete and returns no tokens', async () => {
    const { controller, garmin, emitter } = setup();
    const result = await controller.connectProvider(
      { userId: 7 } as never,
      'GARMIN',
      {
        code: 'code',
        codeVerifier: 'verifier',
      },
    );
    expect(garmin.connect).toHaveBeenCalledWith('code', 'verifier', 42);
    expect(emitter.emit).toHaveBeenCalledWith(
      'provider.connected',
      expect.objectContaining({ athleteId: 42, provider: 'GARMIN' }),
    );
    expect(result).toEqual({
      providerAccountId: 10,
      provider: 'GARMIN',
      status: 'active',
      athleteId: 42,
    });
  });

  it('links the authenticated athlete and returns no credentials', async () => {
    const { controller, wahoo, prisma, emitter } = setup();
    const result = await controller.connectProvider(
      { userId: 7 } as never,
      'WAHOO',
      {
        code: 'code',
        codeVerifier: 'verifier',
        state: 's'.repeat(43),
        athleteId: 99,
      } as never,
    );
    expect(prisma.athlete.findUnique).toHaveBeenCalledWith({
      where: { userId: 7 },
    });
    expect(wahoo.connect).toHaveBeenCalledWith('code', 'verifier', 42);
    expect(emitter.emit).toHaveBeenCalledWith(
      'provider.connected',
      expect.objectContaining({ athleteId: 42, provider: 'WAHOO' }),
    );
    expect(result).toEqual({
      providerAccountId: 9,
      provider: 'WAHOO',
      status: 'active',
      athleteId: 42,
    });
  });

  it('binds the new authorization to the authenticated user', async () => {
    const { controller, queue } = setup();
    await controller.getAuthorizationUri('WAHOO', undefined, {
      userId: 7,
    } as never);
    expect(queue.rememberWahooOAuth).toHaveBeenCalledWith(
      's'.repeat(43),
      7,
      'verifier',
    );
  });

  it('refuses an anonymous Wahoo authorization', async () => {
    const { controller, queue } = setup();
    await expect(controller.getAuthorizationUri('WAHOO')).rejects.toThrow(
      'Unauthorized',
    );
    expect(queue.rememberWahooOAuth).not.toHaveBeenCalled();
  });

  it('refuses a state from another user, an expired flow or a replay', async () => {
    const { controller, queue, wahoo } = setup();
    queue.consumeWahooOAuth.mockResolvedValue(false);
    await expect(
      controller.connectProvider({ userId: 8 } as never, 'WAHOO', {
        code: 'code',
        codeVerifier: 'verifier',
        state: 's'.repeat(43),
      }),
    ).rejects.toThrow('Invalid or expired Wahoo authorization');
    expect(queue.consumeWahooOAuth).toHaveBeenCalledWith(
      's'.repeat(43),
      8,
      'verifier',
    );
    expect(wahoo.connect).not.toHaveBeenCalled();
  });

  it('refuses a connection without PKCE', async () => {
    const { controller, wahoo } = setup();
    await expect(
      controller.connectProvider({ userId: 7 } as never, 'WAHOO', {
        code: 'code',
      }),
    ).rejects.toThrow('codeVerifier is required');
    expect(wahoo.connect).not.toHaveBeenCalled();
  });

  it('rejects an invalid code before contacting Wahoo', async () => {
    const { controller, wahoo } = setup();
    await expect(
      controller.connectProvider({ userId: 7 } as never, 'WAHOO', {
        code: '',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow('valid OAuth code');
    expect(wahoo.connect).not.toHaveBeenCalled();
  });

  it('refuses an unconfigured connector', async () => {
    const { controller, wahoo } = setup(false);
    await expect(
      controller.connectProvider({ userId: 7 } as never, 'WAHOO', {
        code: 'code',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow('PROVIDER_NOT_CONFIGURED');
    expect(wahoo.connect).not.toHaveBeenCalled();
  });

  it('cannot disconnect another athlete account', async () => {
    const { controller, wahoo, prisma } = setup();
    await expect(
      controller.disconnectProvider({ userId: 7 } as never, 'WAHOO'),
    ).rejects.toThrow('Provider account not found');
    expect(prisma.providerAccount.findFirst).toHaveBeenCalledWith({
      where: { athleteId: 42, provider: 'WAHOO', status: 'active' },
    });
    expect(wahoo.disconnect).not.toHaveBeenCalled();
  });
});

describe('Provider history request', () => {
  const now = '2024-03-31T10:00:00.000Z';
  const user = { userId: 7 } as never;
  const account = {
    providerAccountId: 9,
    externalUserId: 'remote-123',
    importActivitiesEnabled: true,
    fullImportRequestedAt: new Date('2024-01-01T00:00:00Z'),
    fullImportCompletedAt: new Date('2024-01-01T00:01:00Z'),
  };

  beforeEach(() => jest.useFakeTimers({ now: new Date(now) }));
  afterEach(() => jest.useRealTimers());

  it.each([
    ['1w', '2024-03-24'],
    ['1m', '2024-02-29'],
    ['2m', '2024-01-31'],
    ['6m', '2023-09-30'],
    ['1y', '2023-03-31'],
  ] as const)(
    'queues the selected %s after a previous import',
    async (period, day) => {
      const { controller, prisma, queue } = setup();
      prisma.providerAccount.findFirst.mockResolvedValue(account);

      await expect(
        controller.importAllActivities(user, 'wahoo', { period }),
      ).resolves.toEqual({ success: true, queued: true });

      expect(queue.addFullImportJob).toHaveBeenCalledWith(9, {
        startDate: `${day}T10:00:00.000Z`,
        endDate: now,
        requestedAt: now,
        externalUserId: 'remote-123',
      });
    },
  );

  it('leaves the legacy bodyless request idempotent', async () => {
    const { controller, prisma, queue } = setup();
    prisma.providerAccount.findFirst.mockResolvedValue(account);

    expect(providerFullImportRequestSchema.parse(undefined)).toEqual({});
    await expect(
      controller.importAllActivities(user, 'garmin'),
    ).resolves.toEqual({
      success: true,
      message: 'Full import already completed',
    });
    expect(queue.addFullImportJob).not.toHaveBeenCalled();
  });

  it.each(['garmin', 'polar', 'strava', 'suunto', 'coros', 'wahoo'])(
    'passes an inclusive custom UTC range to %s independently of the request time',
    async (provider) => {
      const { controller, prisma, queue } = setup();
      prisma.providerAccount.findFirst.mockResolvedValue(account);
      await controller.importAllActivities(user, provider, {
        period: 'custom',
        startDate: '2024-03-10',
        endDate: '2024-03-10',
      });
      expect(queue.addFullImportJob).toHaveBeenCalledWith(9, {
        startDate: '2024-03-10T00:00:00.000Z',
        endDate: '2024-03-10T23:59:59.999Z',
        requestedAt: now,
        externalUserId: 'remote-123',
      });
    },
  );

  it('queues all available history without a minimum start date', async () => {
    const { controller, prisma, queue } = setup();
    prisma.providerAccount.findFirst.mockResolvedValue(account);
    await controller.importAllActivities(user, 'wahoo', { period: 'all' });
    expect(queue.addFullImportJob).toHaveBeenCalledWith(9, {
      endDate: now,
      requestedAt: now,
      externalUserId: 'remote-123',
    });
  });

  it.each([
    ['2024-03-10', '2024-03-09'],
    ['2024-02-30', '2024-03-01'],
    ['2024-03-10T00:00:00Z', '2024-03-10'],
  ])('rejects invalid custom dates %s to %s', (startDate, endDate) => {
    expect(
      providerFullImportRequestSchema.safeParse({
        period: 'custom',
        startDate,
        endDate,
      }).success,
    ).toBe(false);
  });

  it('rejects a future custom range before claiming the account', async () => {
    const { controller, prisma, queue } = setup();
    prisma.providerAccount.findFirst.mockResolvedValue(account);
    await expect(
      controller.importAllActivities(user, 'wahoo', {
        period: 'custom',
        startDate: '2024-03-30',
        endDate: '2024-04-01',
      }),
    ).rejects.toThrow('must not be in the future');
    expect(queue.addFullImportJob).not.toHaveBeenCalled();
  });

  it('keeps the existing request when another import is already present in the queue', async () => {
    const { controller, prisma, queue } = setup();
    prisma.providerAccount.findFirst.mockResolvedValue(account);
    queue.addFullImportJob.mockResolvedValue(false);

    await expect(
      controller.importAllActivities(user, 'wahoo', { period: '1m' }),
    ).rejects.toThrow('A historical import is already queued');

    expect(prisma.providerAccount.updateMany).toHaveBeenLastCalledWith({
      where: { providerAccountId: 9, fullImportRequestedAt: new Date(now) },
      data: {
        fullImportRequestedAt: account.fullImportRequestedAt,
        fullImportCompletedAt: account.fullImportCompletedAt,
      },
    });
  });

  it('rejects a competing request before adding a second job', async () => {
    const { controller, prisma, queue } = setup();
    prisma.providerAccount.findFirst.mockResolvedValue(account);
    prisma.providerAccount.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      controller.importAllActivities(user, 'wahoo', { period: '2m' }),
    ).rejects.toThrow('Historical import state has changed');
    expect(queue.addFullImportJob).not.toHaveBeenCalled();
  });
});
