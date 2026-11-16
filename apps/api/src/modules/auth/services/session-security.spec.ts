import { verify } from 'jsonwebtoken';

import { AuthService } from './auth.service';

const testSigningKey = 'test-only-session-signing-key-not-for-deployment';
const decode = (token: string) => verify(token, testSigningKey);

function setup() {
  const user = {
    userId: 7,
    email: 'runner@example.com',
    sessionVersion: 0,
    athlete: null,
    coachAthletes: [],
  };
  const sessions = new Map<string, Record<string, unknown>>();
  const prisma = {
    user: {
      findUnique: jest.fn().mockImplementation(async () => user),
      findFirst: jest.fn().mockImplementation(async () => user),
    },
    authSession: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        sessions.set(data.id, data);
        return data;
      }),
      findUnique: jest
        .fn()
        .mockImplementation(
          async ({ where }) => sessions.get(where.id) ?? null,
        ),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        const session = sessions.get(where.id);
        if (
          !session ||
          session.userId !== where.userId ||
          session.refreshTokenHash !== where.refreshTokenHash ||
          (session.expiresAt as Date) <= new Date()
        )
          return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      }),
      deleteMany: jest.fn().mockImplementation(async ({ where }) => {
        const session = sessions.get(where.id);
        if (session?.userId === where.userId) sessions.delete(where.id);
        return { count: 1 };
      }),
    },
  };
  const values: Record<string, string> = {
    JWT_SECRET_KEY: testSigningKey,
    APP_URL: 'https://training.example.org',
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  };
  const service = new AuthService(
    prisma as never,
    {} as never,
    config as never,
    {} as never,
  );
  return { service, prisma, user, sessions };
}

describe('purpose-bound, revocable sessions', () => {
  it('never accepts a refresh JWT as API authentication', async () => {
    const { service, user } = setup();
    const pair = await service.sessionFor(user);
    await expect(
      service.validateUser(decode(pair.refreshToken) as never),
    ).rejects.toThrow();
  });

  it('never accepts an access JWT to extend the session', async () => {
    const { service, user } = setup();
    const pair = await service.sessionFor(user);
    await expect(service.refresh(pair.accessToken)).rejects.toThrow();
  });

  it('stores only a hash of the refresh credential and rotates it once', async () => {
    const { service, prisma, user } = setup();
    const pair = await service.sessionFor(user);
    expect(prisma.authSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refreshTokenHash: expect.any(String) }),
      }),
    );
    expect(JSON.stringify(prisma.authSession.create.mock.calls)).not.toContain(
      pair.refreshToken,
    );
    const next = await service.refresh(pair.refreshToken);
    expect(next.refreshToken).not.toBe(pair.refreshToken);
    await expect(
      service.validateUser(decode(next.accessToken) as never),
    ).resolves.toMatchObject({ userId: user.userId });
    await expect(service.refresh(pair.refreshToken)).rejects.toThrow();
    await expect(
      service.validateUser(decode(next.accessToken) as never),
    ).rejects.toThrow();
  });

  it('rejects access and refresh credentials after the session is deleted', async () => {
    const { service, user, sessions } = setup();
    const pair = await service.sessionFor(user);
    sessions.clear();
    await expect(
      service.validateUser(decode(pair.accessToken) as never),
    ).rejects.toThrow();
    await expect(service.refresh(pair.refreshToken)).rejects.toThrow();
  });

  it('rejects credentials minted before a password reset even if a session row survives', async () => {
    const { service, user } = setup();
    const pair = await service.sessionFor(user);
    user.sessionVersion++;
    await expect(
      service.validateUser(decode(pair.accessToken) as never),
    ).rejects.toThrow();
    await expect(service.refresh(pair.refreshToken)).rejects.toThrow();
  });

  it('rejects expired server sessions even when the signed access token is still valid', async () => {
    const { service, user, sessions } = setup();
    const pair = await service.sessionFor(user);
    for (const session of sessions.values()) session.expiresAt = new Date(0);
    await expect(
      service.validateUser(decode(pair.accessToken) as never),
    ).rejects.toThrow();
  });
});
