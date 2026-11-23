import axios from 'axios';
import * as crypto from 'node:crypto';

import { ConnectorProvider, ProviderAccount } from '@openathlete/database';

import { WahooProviderService } from './wahoo.provider.service';

jest.mock('../../core/helpers/activity-file-parser.service', () => ({
  ActivityFileParserService: class {},
}));
jest.mock('axios', () => ({
  __esModule: true,
  ...jest.requireActual('axios'),
  default: {
    get: jest.fn(),
    post: jest.fn(),
    request: jest.fn(),
    delete: jest.fn(),
  },
}));

const axiosMock = axios as jest.Mocked<typeof axios>;

function makeAccount(
  overrides: Partial<ProviderAccount> = {},
): ProviderAccount {
  return {
    providerAccountId: 4,
    athleteId: 8,
    provider: ConnectorProvider.WAHOO,
    status: 'active',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    oauthCodeVerifier: 'v'.repeat(43),
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  } as ProviderAccount;
}

function buildService() {
  const providerAccount = {
    findUnique: jest.fn(),
    update: jest
      .fn()
      .mockImplementation(async (args: { data?: Record<string, unknown> }) =>
        makeAccount(args.data as Partial<ProviderAccount>),
      ),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    providerAccount,
    eventActivity: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    event: { create: jest.fn() },
    $transaction: jest.fn(
      async (
        callback: (tx: unknown) => unknown,
        _?: { maxWait: number; timeout: number },
      ) => {
        const stagedUpdates: Array<{
          where: unknown;
          data: Record<string, unknown>;
        }> = [];
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          providerAccount: {
            ...providerAccount,
            update: jest.fn(
              async (args: {
                where: unknown;
                data: Record<string, unknown>;
              }) => {
                stagedUpdates.push(args);
                return makeAccount(args.data as Partial<ProviderAccount>);
              },
            ),
            updateMany: jest.fn(
              async (args: {
                where: unknown;
                data: Record<string, unknown>;
              }) => {
                stagedUpdates.push(args);
                return { count: 1 };
              },
            ),
          },
          event: { create: jest.fn().mockResolvedValue({ eventId: 70 }) },
          eventActivity: {
            create: jest.fn().mockResolvedValue({ eventActivityId: 80 }),
          },
        };
        const result = await callback(tx);
        for (const update of stagedUpdates)
          await providerAccount.updateMany(update);
        return result;
      },
    ),
  };
  const queue = {
    addActivityImportJobs: jest.fn(),
    getWahooQuotaDelay: jest.fn().mockResolvedValue(0),
    pauseWahooRequests: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) =>
      ({ WAHOO_CLIENT_ID: 'client-id', APP_URL: 'https://example.test' })[key],
  };
  const parser = { parseByFileType: jest.fn() };
  const service = new WahooProviderService(
    prisma as never,
    config as never,
    queue as never,
    parser as never,
  );
  return { service, prisma, queue, parser };
}

describe('WahooProviderService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a distinct S256 PKCE verifier and state with the required scopes', () => {
    const { service } = buildService();
    const first = service.getAuthorizationUriWithPKCE();
    const second = service.getAuthorizationUriWithPKCE();
    const url = new URL(first.uri);

    expect(url.origin + url.pathname).toBe(
      'https://api.wahooligan.com/oauth/authorize',
    );
    expect(url.searchParams.get('scope')).toBe(
      'user_read workouts_read workouts_write plans_read plans_write',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      crypto
        .createHash('sha256')
        .update(first.codeVerifier)
        .digest('base64url'),
    );
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.state).not.toBe(first.codeVerifier);
  });

  it('saves the verifier with the tokens in the connect write', async () => {
    const { service, prisma } = buildService();
    const saved = makeAccount();
    jest.spyOn(service, 'saveProviderAccount').mockResolvedValue(saved);
    axiosMock.post.mockResolvedValue({
      data: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        scope: 'user_read workouts_read workouts_write plans_read plans_write',
      },
    } as never);
    axiosMock.get.mockResolvedValue({ data: { id: 42 } } as never);

    await service.connect('code', 'v'.repeat(43), 8);

    expect(service.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({ oauthCodeVerifier: 'v'.repeat(43) }),
    );
    expect(prisma.providerAccount.update).not.toHaveBeenCalled();
  });

  it('reserves the last daily requests for association when background work runs low', async () => {
    const { service, queue } = buildService();
    axiosMock.request.mockResolvedValueOnce({
      data: { ok: true },
      headers: {
        'x-ratelimit-remaining': '8, 80, 20',
        'x-ratelimit-reset': '0',
        date: 'Mon, 23 Nov 2026 22:00:00 GMT',
      },
    } as never);
    await service.makeApiRequest(makeAccount(), 'GET', '/v1/workouts');

    expect(queue.pauseWahooRequests).toHaveBeenCalledWith(
      'background',
      7_200_000,
    );
    queue.getWahooQuotaDelay.mockImplementation(async (scope) =>
      scope === 'background' ? 50_000 : 0,
    );
    await expect(
      service.makeApiRequest(makeAccount(), 'GET', '/v1/workouts'),
    ).rejects.toMatchObject({
      name: 'ProviderRateLimitError',
      retryAfterMs: 50_000,
    });
    await expect(service.assertCanConnect()).resolves.toBeUndefined();
    expect(axiosMock.request).toHaveBeenCalledTimes(1);
  });

  it('shares the Wahoo reset across requests and stops association before issuing another token', async () => {
    const { service, queue } = buildService();
    axiosMock.request.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, headers: { 'x-ratelimit-reset': '6586' } },
    });
    await expect(
      service.makeApiRequest(makeAccount(), 'GET', '/v1/workouts'),
    ).rejects.toMatchObject({
      name: 'ProviderRateLimitError',
      retryAfterMs: 6_586_000,
    });
    expect(queue.pauseWahooRequests).toHaveBeenCalledWith('all', 6_586_000);

    queue.getWahooQuotaDelay.mockResolvedValue(6_585_001);
    await expect(
      service.connect('code', 'v'.repeat(43), 8),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'WAHOO_RATE_LIMITED', retryAfterSeconds: 6586 },
    });
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  it('returns a usable 429 when the profile lookup first discovers the limit', async () => {
    const { service, queue } = buildService();
    axiosMock.post.mockResolvedValueOnce({
      data: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
      },
    } as never);
    axiosMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, headers: { 'x-ratelimit-reset': '300' } },
    });
    await expect(
      service.connect('code', 'v'.repeat(43), 8),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'WAHOO_RATE_LIMITED', retryAfterSeconds: 300 },
    });
    expect(queue.pauseWahooRequests).toHaveBeenCalledWith('all', 300_000);
  });

  it('stops the recent activity scan when an old workout has no summary', async () => {
    const { service } = buildService();
    const request = jest
      .spyOn(service, 'makeApiRequest')
      .mockResolvedValueOnce({
        workouts: Array.from({ length: 30 }, (_, index) => ({
          id: index + 1,
          starts: '2026-11-10T10:00:00Z',
          workout_summary: null,
        })),
        total: 700,
      });
    request.mockResolvedValueOnce({ workouts: [], total: 700 });

    await expect(
      service.importActivities(makeAccount(), {
        startDate: new Date('2026-11-20T00:00:00Z'),
        endDate: new Date('2026-11-23T00:00:00Z'),
      }),
    ).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses the stored PKCE verifier to refresh under a database lock, then persists the rotated pair', async () => {
    const { service, prisma } = buildService();
    const expired = makeAccount({ expiresAt: new Date(0) });
    prisma.providerAccount.findUnique.mockResolvedValue(expired);
    axiosMock.post.mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 7200,
      },
    } as never);
    axiosMock.request.mockResolvedValue({ data: { ok: true } } as never);

    await expect(
      service.makeApiRequest(expired, 'GET', '/v1/user'),
    ).resolves.toEqual({ ok: true });

    const tokenForm = new URLSearchParams(
      axiosMock.post.mock.calls[0][1] as string,
    );
    expect(tokenForm.get('code_verifier')).toBe(expired.oauthCodeVerifier);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      maxWait: 10_000,
      timeout: 45_000,
    });
    expect(axiosMock.request.mock.calls[0][0]?.headers).toMatchObject({
      Authorization: 'Bearer new-access',
    });
    expect(prisma.providerAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerAccountId: expired.providerAccountId,
          status: 'active',
          accessToken: expired.accessToken,
          refreshToken: expired.refreshToken,
          oauthCodeVerifier: expired.oauthCodeVerifier,
        }),
        data: expect.objectContaining({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
        }),
      }),
    );
  });

  it('paginates beyond 30 and skips workouts without a completed summary', async () => {
    const { service } = buildService();
    const firstPage = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      name: `Ride ${index + 1}`,
      starts: '2026-11-10T10:00:00Z',
      workout_type_id: 0,
      workout_summary: { distance_accum: 1000, duration_active_accum: 60 },
    }));
    jest
      .spyOn(service, 'makeApiRequest')
      .mockResolvedValueOnce({ workouts: firstPage, total: 32 })
      .mockResolvedValueOnce({
        workouts: [
          {
            id: 31,
            starts: '2026-11-10T10:00:00Z',
            workout_type_id: 0,
            workout_summary: {},
          },
          {
            id: 32,
            starts: '2026-11-10T10:00:00Z',
            workout_type_id: 12,
            workout_summary: { distance_accum: 2000 },
          },
        ],
        total: 32,
      });

    const activities = await service.importActivities(makeAccount(), {
      startDate: new Date('2026-11-01T00:00:00Z'),
    });

    expect(service.makeApiRequest).toHaveBeenCalledTimes(2);
    expect(activities).toHaveLength(32);
    expect(activities[31].externalId).toBe('wahoo:8:32');
    expect(activities[31].sport).toBe('CYCLING');
  });

  it('imports only the requested inclusive history and checkpoints pages after queueing', async () => {
    const { service, prisma, queue } = buildService();
    const account = makeAccount({ externalUserId: 'wahoo-user-8' });
    const makeWorkout = (id: number, starts: string) => ({
      id,
      starts,
      workout_type_id: 0,
      workout_summary: {},
    });
    const firstPage = [
      ...Array.from({ length: 29 }, (_, index) =>
        makeWorkout(index + 1, '2026-05-01T12:00:00Z'),
      ),
      makeWorkout(30, '2026-01-01T00:00:00Z'),
    ];
    jest
      .spyOn(service, 'makeApiRequest')
      .mockResolvedValueOnce({ workouts: firstPage, total: 32 })
      .mockResolvedValueOnce({
        workouts: [
          makeWorkout(31, '2026-01-02T00:00:00Z'),
          makeWorkout(32, '2025-12-31T23:59:59Z'),
        ],
        total: 32,
      });
    prisma.eventActivity.findMany.mockResolvedValue([
      { externalId: 'wahoo:8:2' },
    ]);
    queue.addActivityImportJobs.mockResolvedValue(undefined);
    const checkpoint = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.queueFullImport(
        account,
        {
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-05-01T12:00:00Z',
          requestedAt: '2026-05-01T12:00:00Z',
          externalUserId: 'wahoo-user-8',
        },
        checkpoint,
      ),
    ).resolves.toEqual({ queuedActivities: 30 });

    expect(queue.addActivityImportJobs).toHaveBeenNthCalledWith(
      1,
      account,
      expect.arrayContaining([
        expect.objectContaining({ externalId: 'wahoo:8:1' }),
        expect.objectContaining({ externalId: 'wahoo:8:30' }),
      ]),
      true,
    );
    expect(queue.addActivityImportJobs).toHaveBeenCalledTimes(2);
    expect(queue.addActivityImportJobs.mock.calls[1][1]).toEqual([
      expect.objectContaining({ externalId: 'wahoo:8:31' }),
    ]);
    expect(checkpoint).toHaveBeenNthCalledWith(1, {
      nextPage: 2,
      queuedActivities: 29,
    });
    expect(checkpoint).toHaveBeenNthCalledWith(2, {
      nextPage: 3,
      queuedActivities: 30,
    });
  });

  it('rejects Wahoo history after the account identity changes', async () => {
    const { service } = buildService();
    await expect(
      service.queueFullImport(
        makeAccount({ externalUserId: 'new-user' }),
        {
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-02-01T00:00:00Z',
          requestedAt: '2026-02-01T00:00:00Z',
          externalUserId: 'old-user',
        },
        jest.fn(),
      ),
    ).rejects.toThrow('Wahoo account identity changed');
  });

  it('imports all available Wahoo history without a minimum date', async () => {
    const { service, prisma, queue } = buildService();
    const account = makeAccount({ externalUserId: 'wahoo-user-8' });
    jest.spyOn(service, 'makeApiRequest').mockResolvedValue({
      workouts: [
        {
          id: 17,
          starts: '2018-04-23T12:00:00Z',
          workout_type_id: 0,
          workout_summary: {},
        },
      ],
      total: 1,
    });
    prisma.eventActivity.findMany.mockResolvedValue([]);
    const history = {
      endDate: '2026-05-01T12:00:00Z',
      requestedAt: '2026-05-01T12:00:00Z',
      externalUserId: 'wahoo-user-8',
    };

    await expect(
      service.queueFullImport(account, history, jest.fn()),
    ).resolves.toEqual({ queuedActivities: 1 });
    expect(queue.addActivityImportJobs).toHaveBeenCalledWith(
      account,
      [expect.objectContaining({ externalId: 'wahoo:8:17' })],
      true,
    );
  });

  it('rejects non-Wahoo hosts before downloading activity files', async () => {
    const { service, prisma } = buildService();
    jest.spyOn(service, 'makeApiRequest').mockResolvedValue({
      workout_summary: { file: { url: 'https://127.0.0.1/private.fit' } },
    });
    prisma.eventActivity.findFirst.mockResolvedValue(null);
    await expect(
      service.importActivity(makeAccount(), {
        externalId: 'wahoo:8:123',
        name: 'Ride',
        startDate: new Date(),
        endDate: new Date(),
        sport: 'CYCLING',
        raw: {},
      }),
    ).rejects.toThrow('Wahoo FIT URL host is not allowed');
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts before making API calls', async () => {
    const { service } = buildService();
    const inactive = makeAccount({ status: 'revoked' });
    await expect(
      service.makeApiRequest(inactive, 'GET', '/v1/user'),
    ).rejects.toThrow('Wahoo account is not active');
    expect(axiosMock.request).not.toHaveBeenCalled();
  });

  it('keeps summary-only metadata numeric when Wahoo returns numeric strings', async () => {
    const { service } = buildService();
    jest.spyOn(service, 'makeApiRequest').mockResolvedValue({
      workouts: [
        {
          id: 44,
          starts: '2026-11-10T10:00:00Z',
          workout_type_id: 15,
          workout_summary: {
            distance_accum: '12500.5',
            duration_active_accum: '1800',
            heart_rate_avg: '145',
            power_avg: '205',
            cadence_avg: '88',
          },
        },
      ],
    });
    const [activity] = await service.importActivities(makeAccount(), {
      startDate: new Date('2026-11-10T00:00:00Z'),
      endDate: new Date('2026-11-11T00:00:00Z'),
    });
    expect(activity).toMatchObject({
      externalId: 'wahoo:8:44',
      distance: 12500.5,
      duration: 1800,
    });
    expect(typeof activity.distance).toBe('number');
    expect(typeof activity.duration).toBe('number');
  });

  it('commits revoked status after an invalid_grant refresh response', async () => {
    const { service, prisma } = buildService();
    const expired = makeAccount({ expiresAt: new Date(0) });
    prisma.providerAccount.findUnique.mockResolvedValue(expired);
    axiosMock.post.mockRejectedValue(
      Object.assign(new Error('redacted'), {
        isAxiosError: true,
        response: { status: 400, data: { error: 'invalid_grant' } },
      }),
    );

    await expect(
      service.makeApiRequest(expired, 'GET', '/v1/user'),
    ).rejects.toThrow('Wahoo refresh was rejected; reconnect the account');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.providerAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accessToken: expired.accessToken,
          refreshToken: expired.refreshToken,
          oauthCodeVerifier: expired.oauthCodeVerifier,
        }),
        data: { status: 'revoked' },
      }),
    );
    expect(axiosMock.request).not.toHaveBeenCalled();
  });

  it('uses a fresher pair found after acquiring the refresh lock', async () => {
    const { service, prisma } = buildService();
    const expired = makeAccount({ expiresAt: new Date(0) });
    const current = makeAccount({
      accessToken: 'current-access',
      refreshToken: 'current-refresh',
    });
    const findUnique = jest.fn().mockResolvedValue(current);
    const tx = {
      $executeRaw: jest.fn(),
      providerAccount: { findUnique, update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    axiosMock.request.mockResolvedValue({ data: { ok: true } } as never);

    await expect(
      service.makeApiRequest(expired, 'GET', '/v1/user'),
    ).resolves.toEqual({ ok: true });
    expect(axiosMock.post).not.toHaveBeenCalled();
    expect(axiosMock.request.mock.calls[0][0]?.headers).toMatchObject({
      Authorization: 'Bearer current-access',
    });
  });

  it('keeps the reconnected tokens when a successful refresh loses its CAS', async () => {
    const { service, prisma } = buildService();
    const expired = makeAccount({ expiresAt: new Date(0) });
    const reconnected = makeAccount({
      accessToken: 'reconnected-access',
      refreshToken: 'reconnected-refresh',
      oauthCodeVerifier: 'n'.repeat(43),
    });
    const txProviderAccount = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(expired)
        .mockResolvedValueOnce(reconnected),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: jest.fn(),
          providerAccount: txProviderAccount,
        }),
    );
    axiosMock.post.mockResolvedValue({
      data: {
        access_token: 'stale-refresh-result',
        refresh_token: 'stale-refresh-token',
        expires_in: 3600,
      },
    } as never);
    axiosMock.request.mockResolvedValue({ data: { ok: true } } as never);

    await expect(
      service.makeApiRequest(expired, 'GET', '/v1/user'),
    ).resolves.toEqual({ ok: true });
    expect(txProviderAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          oauthCodeVerifier: expired.oauthCodeVerifier,
        }),
      }),
    );
    expect(axiosMock.request.mock.calls[0][0]?.headers).toMatchObject({
      Authorization: 'Bearer reconnected-access',
    });
    expect(prisma.providerAccount.updateMany).not.toHaveBeenCalled();
  });

  it('does not revoke a reconnected account when the old refresh token returns invalid_grant', async () => {
    const { service, prisma } = buildService();
    const expired = makeAccount({ expiresAt: new Date(0) });
    const reconnected = makeAccount({
      accessToken: 'reconnected-access',
      refreshToken: 'reconnected-refresh',
      oauthCodeVerifier: 'n'.repeat(43),
    });
    const txProviderAccount = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(expired)
        .mockResolvedValueOnce(reconnected),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: jest.fn(),
          providerAccount: txProviderAccount,
        }),
    );
    axiosMock.post.mockRejectedValue(
      Object.assign(new Error('redacted'), {
        isAxiosError: true,
        response: { status: 400, data: { error: 'invalid_grant' } },
      }),
    );
    axiosMock.request.mockResolvedValue({ data: { ok: true } } as never);

    await expect(
      service.makeApiRequest(expired, 'GET', '/v1/user'),
    ).resolves.toEqual({ ok: true });
    expect(txProviderAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          oauthCodeVerifier: expired.oauthCodeVerifier,
        }),
        data: { status: 'revoked' },
      }),
    );
    expect(axiosMock.request.mock.calls[0][0]?.headers).toMatchObject({
      Authorization: 'Bearer reconnected-access',
    });
    expect(prisma.providerAccount.updateMany).not.toHaveBeenCalled();
  });

  it('does not follow redirects when downloading FIT files', async () => {
    const { service, parser, prisma } = buildService();
    jest.spyOn(service, 'makeApiRequest').mockResolvedValue({
      workout_summary: {
        file: { url: 'https://cdn.wahooligan.com/temporary.fit?sig=secret' },
      },
    });
    prisma.eventActivity.findFirst.mockResolvedValue(null);
    prisma.event.create.mockResolvedValue({ eventId: 70 });
    axiosMock.get.mockRejectedValue(
      Object.assign(new Error('redirect'), {
        isAxiosError: true,
        response: { status: 302 },
      }),
    );
    parser.parseByFileType.mockRejectedValue(new Error('invalid FIT'));
    const activity = {
      externalId: 'wahoo:8:123',
      name: 'Ride',
      startDate: new Date('2026-11-10T10:00:00Z'),
      endDate: new Date('2026-11-10T11:00:00Z'),
      sport: 'CYCLING',
      distance: 1_000,
      duration: 60,
      raw: { workout_summary: { distance_accum: 1_000 } },
    };
    await expect(
      service.importActivity(makeAccount(), activity),
    ).rejects.toThrow('Wahoo FIT download failed (302)');
    expect(axiosMock.get.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails a present invalid FIT rather than marking a summary-only import complete', async () => {
    const { service, parser, prisma } = buildService();
    jest.spyOn(service, 'makeApiRequest').mockResolvedValue({
      workout_summary: {
        file: { url: 'https://cdn.wahooligan.com/temporary.fit?sig=private' },
      },
    });
    prisma.eventActivity.findFirst.mockResolvedValue(null);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('bad fit') } as never);
    parser.parseByFileType.mockRejectedValue(new Error('invalid FIT'));
    const activity = {
      externalId: 'wahoo:8:123',
      name: 'Ride',
      startDate: new Date('2026-11-10T10:00:00Z'),
      endDate: new Date('2026-11-10T11:00:00Z'),
      sport: 'CYCLING',
      distance: 1_000,
      duration: 60,
      raw: { workout_summary: { distance_accum: 1_000 } },
    };
    await expect(
      service.importActivity(makeAccount(), activity),
    ).rejects.toThrow('Wahoo FIT file could not be parsed');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns an already imported activity without fetching its FIT file', async () => {
    const { service, prisma } = buildService();
    const existing = { eventActivityId: 80 };
    prisma.eventActivity.findFirst.mockResolvedValue(existing);
    const activity = {
      externalId: 'wahoo:8:123',
      name: 'Ride',
      startDate: new Date(),
      endDate: new Date(),
      sport: 'CYCLING',
      raw: {},
    };
    await expect(
      service.importActivity(makeAccount(), activity),
    ).resolves.toEqual({
      activity: existing,
      created: false,
    });
    expect(axiosMock.get).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refreshes an expired account before trying to revoke Wahoo permissions remotely', async () => {
    const { service, prisma } = buildService();
    const expired = makeAccount({ expiresAt: new Date(0) });
    prisma.providerAccount.findUnique.mockResolvedValue(expired);
    axiosMock.post.mockResolvedValue({
      data: {
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      },
    } as never);
    axiosMock.request.mockResolvedValue({ data: {} } as never);

    await expect(service.disconnect(expired)).resolves.toBe(true);
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
    expect(axiosMock.request.mock.calls[0][0]).toMatchObject({
      method: 'DELETE',
      url: 'https://api.wahooligan.com/v1/permissions',
      headers: { Authorization: 'Bearer fresh-access' },
    });
    expect(prisma.providerAccount.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: 'revoked', disconnectedByUser: true },
      }),
    );
  });

  it('returns false and revokes locally when remote permission removal fails', async () => {
    const { service, prisma } = buildService();
    jest
      .spyOn(service, 'makeApiRequest')
      .mockRejectedValue(
        Object.assign(new Error('sanitized'), { status: 403 }),
      );
    await expect(service.disconnect(makeAccount())).resolves.toBe(false);
    expect(prisma.providerAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'revoked', disconnectedByUser: true },
      }),
    );
  });

  it('does not locally revoke a new generation if disconnect finishes after reconnect', async () => {
    const { service, prisma } = buildService();
    const disconnected = makeAccount({ oauthCodeVerifier: 'o'.repeat(43) });
    const reconnected = makeAccount({ oauthCodeVerifier: 'n'.repeat(43) });
    let stored = reconnected;
    jest.spyOn(service, 'makeApiRequest').mockImplementation(async () => {
      stored = reconnected;
      return {};
    });
    prisma.providerAccount.updateMany.mockImplementation(
      async (args: {
        where: { oauthCodeVerifier?: string; status?: string };
        data: { status: 'revoked' };
      }) => {
        if (
          stored.status === args.where.status &&
          stored.oauthCodeVerifier === args.where.oauthCodeVerifier
        ) {
          stored = { ...stored, status: args.data.status };
          return { count: 1 };
        }
        return { count: 0 };
      },
    );

    await expect(service.disconnect(disconnected)).resolves.toBe(true);
    expect(prisma.providerAccount.updateMany).toHaveBeenCalledWith({
      where: {
        providerAccountId: disconnected.providerAccountId,
        status: 'active',
        oauthCodeVerifier: disconnected.oauthCodeVerifier,
      },
      data: { status: 'revoked', disconnectedByUser: true },
    });
    expect(stored.status).toBe('active');
    expect(stored.oauthCodeVerifier).toBe(reconnected.oauthCodeVerifier);
  });

  it('does not revoke a new connection when the failed token changes during a 401 race', async () => {
    const { service, prisma } = buildService();
    const original = makeAccount();
    const replacement = makeAccount({ accessToken: 'replacement-access' });
    prisma.providerAccount.findUnique
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(replacement);
    prisma.providerAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    axiosMock.request
      .mockRejectedValueOnce(
        Object.assign(new Error('redacted'), {
          isAxiosError: true,
          response: { status: 401 },
        }),
      )
      .mockResolvedValueOnce({ data: { ok: true } } as never);

    await expect(
      service.makeApiRequest(original, 'GET', '/v1/user'),
    ).resolves.toEqual({ ok: true });
    expect(prisma.providerAccount.updateMany).toHaveBeenCalledWith({
      where: {
        providerAccountId: original.providerAccountId,
        status: 'active',
        accessToken: original.accessToken,
        refreshToken: original.refreshToken,
        oauthCodeVerifier: original.oauthCodeVerifier,
      },
      data: { status: 'revoked' },
    });
    expect(axiosMock.request.mock.calls[1][0]?.headers).toMatchObject({
      Authorization: 'Bearer replacement-access',
    });
  });

  it('rejects malformed token responses, including string or nonpositive expiry values', async () => {
    const { service } = buildService();
    for (const expires_in of ['3600', 0, -1, Number.NaN]) {
      axiosMock.post.mockResolvedValueOnce({
        data: { access_token: 'access', refresh_token: 'refresh', expires_in },
      } as never);
      await expect(service.connect('code', 'v'.repeat(43), 8)).rejects.toThrow(
        'Wahoo returned an incomplete token response',
      );
    }
  });
});
