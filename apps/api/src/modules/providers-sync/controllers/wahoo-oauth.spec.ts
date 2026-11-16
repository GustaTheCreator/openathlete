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
    providerAccount: { findFirst: jest.fn().mockResolvedValue(null) },
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
