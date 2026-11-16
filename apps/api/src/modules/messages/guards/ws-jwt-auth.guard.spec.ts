import {
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';

import { AuthUser } from 'src/modules/auth/decorators/user.decorator';
import { AuthService } from 'src/modules/auth/services';

import { WsJwtAuthGuard } from './ws-jwt-auth.guard';

const SECRET = 'test-secret';
const jwt = new JwtService({ secret: SECRET });
const activeSockets = new Set<ReturnType<typeof socketWith>>();

const socketWith = (token: string) => {
  const socket = {
    handshake: { headers: {}, auth: { token }, query: {} },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    disconnect: jest.fn(),
  };
  activeSockets.add(socket);
  return socket;
};

// Expiry set in the payload, in seconds from now
const tokenExpiringIn = (seconds: number, payload: object) =>
  jwt.signAsync({ ...payload, exp: Math.floor(Date.now() / 1000) + seconds });

const contextFor = (client: ReturnType<typeof socketWith>) =>
  ({
    switchToWs: () => ({ getClient: () => client }),
  }) as unknown as ExecutionContext;

describe('WsJwtAuthGuard', () => {
  const user = {
    userId: 7,
    email: 'athlete@example.com',
    authSessionId: 'session-7',
  } as AuthUser;
  const authService = {
    validateUser: jest.fn().mockResolvedValue(user),
  } as unknown as AuthService;
  const guard = new WsJwtAuthGuard(jwt, authService);

  beforeEach(() => {
    jest.mocked(authService.validateUser).mockClear();
  });

  afterEach(() => {
    for (const client of activeSockets) {
      const timer = client.data.authExpiryTimer as
        ReturnType<typeof setTimeout> | undefined;
      if (timer) clearTimeout(timer);
    }
    activeSockets.clear();
    jest.useRealTimers();
  });

  it('authenticates with the shared token and session checks', async () => {
    const payload = { userId: 7, email: 'athlete@example.com' };
    const client = socketWith(await tokenExpiringIn(3600, payload));

    await expect(guard.canActivate(contextFor(client))).resolves.toBe(true);
    expect(authService.validateUser).toHaveBeenCalledWith(
      expect.objectContaining(payload),
    );
    expect(client.data.user).toEqual(user);
    expect(client.join).toHaveBeenCalledWith('auth-session:session-7');
    expect(client.join).toHaveBeenCalledWith('auth-user:7');
  });

  it('disconnects the socket when its access token expires', async () => {
    const token = await tokenExpiringIn(60, {
      userId: 7,
      email: 'athlete@example.com',
    });
    jest.useFakeTimers();
    const client = socketWith(token);

    await expect(guard.canActivate(contextFor(client))).resolves.toBe(true);
    expect(client.data.authExpiryTimer).toBeDefined();

    jest.advanceTimersByTime(60_000);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects tokens when the shared validator reports a revoked session', async () => {
    const error = jest.spyOn(Logger.prototype, 'error');
    const token = await tokenExpiringIn(3600, {
      userId: 7,
      email: 'athlete@example.com',
    });
    const client = socketWith(token);
    jest
      .mocked(authService.validateUser)
      .mockRejectedValueOnce(new UnauthorizedException());

    await expect(guard.canActivate(contextFor(client))).rejects.toThrow(
      new WsException('Unauthorized'),
    );
    expect(client.data.user).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('does not accept tokens from query parameters', async () => {
    const client = socketWith('');
    const token = await tokenExpiringIn(3600, {
      userId: 7,
      email: 'athlete@example.com',
    });
    client.handshake.auth = undefined as never;
    client.handshake.query = { token } as never;

    await expect(guard.canActivate(contextFor(client))).rejects.toThrow(
      new WsException('Unauthorized'),
    );
    expect(authService.validateUser).not.toHaveBeenCalled();
  });

  it('rejects an expired token as a routine condition', async () => {
    const error = jest.spyOn(Logger.prototype, 'error');
    const debug = jest.spyOn(Logger.prototype, 'debug');
    const client = socketWith(
      await tokenExpiringIn(-60, { userId: 7, email: 'athlete@example.com' }),
    );

    await expect(guard.canActivate(contextFor(client))).rejects.toThrow(
      new WsException('Unauthorized: jwt expired'),
    );
    expect(client.data.user).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
  });
});
