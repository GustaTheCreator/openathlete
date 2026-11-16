// @vitest-environment jsdom
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccessToken, refreshToken } from './auth';
import { keepSocketAuthenticated } from './socket-auth';

vi.mock('./auth', async (importActual) => ({
  ...(await importActual<typeof import('./auth')>()),
  getAccessToken: vi.fn(),
  refreshToken: vi.fn(),
}));

const tokenExpiringIn = (seconds: number) =>
  `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.signature`;

// Just what the helper uses of a Socket.IO client socket
function fakeSocket() {
  const listeners = new Map<string, (payload: unknown) => void>();
  const socket = {
    connected: true,
    auth: {} as Socket['auth'],
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return socket;
    }),
    off: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false;
      return socket;
    }),
    connect: vi.fn(() => {
      socket.connected = true;
      return socket;
    }),
    // What Nest sends when a guard refuses an event
    refuses: (message: string) =>
      listeners.get('exception')?.({ status: 'error', message }),
    disconnects: (reason: string) => {
      socket.connected = false;
      listeners.get('disconnect')?.(reason);
    },
  };
  return socket;
}

// Runs the handshake as Socket.IO would and resolves with the token it sends
const handshake = (socket: ReturnType<typeof fakeSocket>) =>
  new Promise<unknown>((resolve) => {
    if (typeof socket.auth !== 'function') throw new Error('auth not set');
    socket.auth((data) => resolve(data));
  });

describe('keepSocketAuthenticated', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getAccessToken).mockReset();
    vi.mocked(refreshToken).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('sends the current token with every handshake', async () => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);
    const first = tokenExpiringIn(3600);
    const second = tokenExpiringIn(7200);

    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: first,
      refreshed: false,
    });
    await expect(handshake(socket)).resolves.toEqual({ token: first });

    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: second,
      refreshToken: 'new-refresh',
      refreshed: true,
    });
    await expect(handshake(socket)).resolves.toEqual({ token: second });
    expect(localStorage.length).toBe(0);
  });

  // The server checks each event against the handshake token: a connected
  // socket must reconnect once that token expires, or every event fails.
  it('reconnects a connected socket once its token expired', async () => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);
    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: tokenExpiringIn(90),
      refreshed: false,
    });
    await handshake(socket);

    vi.advanceTimersByTime(60 * 1000);
    expect(socket.disconnect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60 * 1000);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('reconnects with a new token when the server finds it expired', async () => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);
    // The device's clock still deems the token valid
    const stale = tokenExpiringIn(600);
    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: stale,
      refreshed: false,
    });
    await handshake(socket);
    const fresh = tokenExpiringIn(3600);
    vi.mocked(refreshToken).mockResolvedValueOnce({
      accessToken: fresh,
      refreshToken: 'new-refresh',
      refreshed: true,
    });

    socket.refuses('Unauthorized: jwt expired');
    socket.refuses('Unauthorized: jwt expired');
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it('refreshes and reconnects after the server disconnects an expired socket', async () => {
    const socket = fakeSocket();
    const authentication = keepSocketAuthenticated(socket as unknown as Socket);
    const stale = tokenExpiringIn(600);
    const fresh = tokenExpiringIn(3600);
    vi.mocked(getAccessToken)
      .mockResolvedValueOnce({ accessToken: stale, refreshed: false })
      .mockResolvedValueOnce({ accessToken: fresh, refreshed: false });
    await handshake(socket);
    vi.mocked(refreshToken).mockResolvedValueOnce({
      accessToken: fresh,
      refreshed: true,
    });

    socket.disconnects('io server disconnect');
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledOnce());
    await expect(handshake(socket)).resolves.toEqual({ token: fresh });

    expect(refreshToken).toHaveBeenCalledOnce();
    expect(socket.disconnect).not.toHaveBeenCalled();
    authentication.stop();
  });

  it.each([
    ['revoked refresh session', null],
    ['refresh returning the same expired JWT', 'same'],
  ])('does not reconnect for %s', async (_name, result) => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);
    const stale = tokenExpiringIn(600);
    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: stale,
      refreshed: false,
    });
    await handshake(socket);
    vi.mocked(refreshToken).mockResolvedValueOnce(
      result === 'same' ? { accessToken: stale, refreshed: true } : null,
    );

    socket.disconnects('io server disconnect');
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('shares one refresh between an expiry refusal and server disconnect', async () => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);
    const stale = tokenExpiringIn(600);
    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: stale,
      refreshed: false,
    });
    await handshake(socket);
    let resolveRefresh!: (info: {
      accessToken: string;
      refreshed: boolean;
    }) => void;
    vi.mocked(refreshToken).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    socket.refuses('Unauthorized: jwt expired');
    socket.disconnects('io server disconnect');
    expect(refreshToken).toHaveBeenCalledOnce();

    resolveRefresh({ accessToken: tokenExpiringIn(3600), refreshed: true });
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledOnce());
  });

  it('does not reconnect when stopped while a refresh is pending', async () => {
    const socket = fakeSocket();
    const authentication = keepSocketAuthenticated(socket as unknown as Socket);
    const stale = tokenExpiringIn(600);
    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: stale,
      refreshed: false,
    });
    await handshake(socket);
    let resolveRefresh!: (info: {
      accessToken: string;
      refreshed: boolean;
    }) => void;
    vi.mocked(refreshToken).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    socket.disconnects('io server disconnect');
    authentication.stop();
    resolveRefresh({
      accessToken: tokenExpiringIn(3600),
      refreshed: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('stays put when no new token can be obtained', async () => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);
    vi.mocked(refreshToken).mockResolvedValueOnce(null);

    socket.refuses('Unauthorized: jwt expired');
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalled());
    await Promise.resolve();

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('ignores other refusals', () => {
    const socket = fakeSocket();
    keepSocketAuthenticated(socket as unknown as Socket);

    socket.refuses('Unauthorized: No token provided');

    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('stops checking once stopped', async () => {
    const socket = fakeSocket();
    const authentication = keepSocketAuthenticated(socket as unknown as Socket);
    vi.mocked(getAccessToken).mockResolvedValueOnce({
      accessToken: tokenExpiringIn(-1),
      refreshed: false,
    });
    await handshake(socket);

    authentication.stop();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
