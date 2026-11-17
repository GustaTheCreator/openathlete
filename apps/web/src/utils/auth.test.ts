// @vitest-environment jsdom
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthTokens,
  getAccessToken,
  setAccessToken,
  setRefreshToken,
} from './auth';
import { ACCESS_TOKEN, REFRESH_TOKEN } from './local-storage';

const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => (platform.native ? 'android' : 'web'),
  },
}));

const validToken = `header.${btoa(JSON.stringify({ exp: 4102444800 }))}.signature`;

describe('browser authentication tokens', () => {
  beforeEach(() => {
    platform.native = false;
    clearAuthTokens();
    document.cookie = 'oa_csrf=csrf-value; Path=/';
    localStorage.setItem(ACCESS_TOKEN, 'legacy-access');
    localStorage.setItem(REFRESH_TOKEN, 'legacy-refresh');
  });

  afterEach(() => {
    vi.useRealTimers();
    platform.native = false;
    vi.restoreAllMocks();
    document.cookie = 'oa_csrf=; Path=/; Max-Age=0';
    clearAuthTokens();
  });

  it('restores from the HttpOnly refresh cookie without persisting either token', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: validToken },
    });

    await expect(getAccessToken()).resolves.toMatchObject({
      accessToken: validToken,
      refreshed: true,
    });

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh-token'),
      {},
      expect.objectContaining({
        withCredentials: true,
        headers: expect.objectContaining({
          'X-Auth-Mode': 'cookie',
          'X-CSRF-Token': 'csrf-value',
        }),
      }),
    );
    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN)).toBeNull();
    expect(await getAccessToken()).toMatchObject({ accessToken: validToken });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps a new browser access token in memory only', async () => {
    setAccessToken(validToken);

    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN)).toBeNull();
    await expect(getAccessToken()).resolves.toMatchObject({
      accessToken: validToken,
      refreshed: false,
    });
  });

  it('keeps native bearer refresh in memory without persisting credentials', async () => {
    platform.native = true;
    const expiringToken = `header.${btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 }),
    )}.signature`;
    setAccessToken(expiringToken);
    setRefreshToken('native-refresh');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: validToken, refreshToken: 'rotated-refresh' },
    });

    await expect(getAccessToken()).resolves.toMatchObject({
      accessToken: validToken,
      refreshToken: 'rotated-refresh',
      refreshed: true,
    });

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh-token'),
      { refreshToken: 'native-refresh' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN)).toBeNull();
    await expect(getAccessToken()).resolves.toMatchObject({
      accessToken: validToken,
      refreshed: false,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('purges legacy native tokens without reusing them', async () => {
    platform.native = true;
    localStorage.setItem(ACCESS_TOKEN, validToken);
    localStorage.setItem(REFRESH_TOKEN, 'legacy-native-refresh');
    const post = vi.spyOn(axios, 'post');

    await expect(getAccessToken()).resolves.toBeNull();

    expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN)).toBeNull();
  });

  it('requires native sign-in again after in-memory session state is lost', async () => {
    platform.native = true;
    setAccessToken(validToken);
    setRefreshToken('native-refresh');
    clearAuthTokens();

    await expect(getAccessToken()).resolves.toBeNull();
    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN)).toBeNull();
  });

  it('revokes the cookie session before local logout completes', async () => {
    setAccessToken(validToken);
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    const { logoutAuthSession } = await import('./auth');
    await logoutAuthSession();

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      {},
      expect.objectContaining({
        withCredentials: true,
        headers: expect.objectContaining({
          Authorization: `Bearer ${validToken}`,
          'X-Auth-Mode': 'cookie',
          'X-CSRF-Token': 'csrf-value',
        }),
      }),
    );
  });

  it('revokes the native bearer session on the server', async () => {
    platform.native = true;
    setAccessToken(validToken);
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    const { logoutAuthSession } = await import('./auth');
    await logoutAuthSession();

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      {},
      expect.objectContaining({
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    );
    expect(post.mock.calls[0][2]).not.toHaveProperty('withCredentials');
  });

  it('bounds logout when refresh never resolves', async () => {
    vi.useFakeTimers();
    setAccessToken(`header.${btoa(JSON.stringify({ exp: 1 }))}.signature`);
    vi.spyOn(axios, 'post').mockImplementation(
      (_url, _data, config) =>
        new Promise((_resolve, reject) =>
          config?.signal?.addEventListener?.('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    );
    const { logoutAuthSession } = await import('./auth');
    const logout = logoutAuthSession();
    await vi.advanceTimersByTimeAsync(5001);
    await expect(logout).resolves.toBeUndefined();
    document.cookie = 'oa_csrf=; Path=/; Max-Age=0';
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('ignores a refresh response that arrives after logout times out', async () => {
    vi.useFakeTimers();
    setAccessToken(`header.${btoa(JSON.stringify({ exp: 1 }))}.signature`);
    let resolveRefresh!: (value: {
      data: { accessToken: string; refreshToken: string };
    }) => void;
    vi.spyOn(axios, 'post').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const { logoutAuthSession } = await import('./auth');
    const logout = logoutAuthSession();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(logout).resolves.toBeUndefined();
    document.cookie = 'oa_csrf=; Path=/; Max-Age=0';
    resolveRefresh({
      data: { accessToken: validToken, refreshToken: 'rotated' },
    });

    await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('refreshes an expired access token before server revocation', async () => {
    setAccessToken(`header.${btoa(JSON.stringify({ exp: 1 }))}.signature`);
    const post = vi
      .spyOn(axios, 'post')
      .mockImplementationOnce(async () => {
        document.cookie = 'oa_csrf=rotated-csrf; Path=/';
        return { data: { accessToken: validToken } };
      })
      .mockResolvedValueOnce({ data: {} });
    const { logoutAuthSession } = await import('./auth');
    await logoutAuthSession();

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${validToken}`,
          'X-CSRF-Token': 'rotated-csrf',
        }),
      }),
    );
  });

  it('does not start refresh after logout expires while waiting for the browser lock', async () => {
    vi.useFakeTimers();
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let releaseLock!: () => void;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(
          (_name, callback) =>
            new Promise<void>((resolve) => {
              releaseLock = () => {
                void callback().then(resolve);
              };
            }),
        ),
      },
    });
    setAccessToken(`header.${btoa(JSON.stringify({ exp: 1 }))}.signature`);
    const post = vi.spyOn(axios, 'post');
    const { logoutAuthSession } = await import('./auth');
    const pendingToken = getAccessToken();
    const logout = logoutAuthSession();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(logout).resolves.toBeUndefined();
    releaseLock!();
    await expect(pendingToken).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
    if (originalLocks) {
      Object.defineProperty(navigator, 'locks', originalLocks);
    } else {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });
});
