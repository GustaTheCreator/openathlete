// @vitest-environment jsdom
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAuthTokens, getAccessToken, setAccessToken } from './auth';
import client, { isNetworkError } from './axios';
import { ACCESS_TOKEN, REFRESH_TOKEN } from './local-storage';

// Answers every request with the given status, without any network.
const respondWith =
  (status: number) => async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError(
      `HTTP ${status}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      { status, statusText: '', data: {}, headers: {}, config },
    );
  };

const ACCESS = `header.${btoa(JSON.stringify({ exp: 4102444800 }))}.signature`;

describe('API client errors', () => {
  beforeEach(() => {
    clearAuthTokens();
    setAccessToken(ACCESS);
  });

  afterEach(() => clearAuthTokens());

  it('drops the access token on 401 and still reports the failure', async () => {
    const request = client.post(
      '/auth/login',
      {},
      { adapter: respondWith(401) },
    );
    await expect(request).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(await getAccessToken()).toBeNull();
    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN)).toBeNull();
  });

  it('keeps the in-memory token on other failures', async () => {
    const request = client.get('/user/me', { adapter: respondWith(500) });
    await expect(request).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(await getAccessToken()).toMatchObject({ accessToken: ACCESS });
    expect(localStorage.getItem(ACCESS_TOKEN)).toBeNull();
  });

  it('distinguishes a network failure from an answered unauthorized response', async () => {
    const offline = client.get('/user/me', {
      adapter: async (config) => {
        throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
      },
    });
    const error = await offline.catch((e: unknown) => e);
    expect(isNetworkError(error)).toBe(true);
    expect(await getAccessToken()).toMatchObject({ accessToken: ACCESS });

    const unauthorized = await client
      .get('/user/me', { adapter: respondWith(401) })
      .catch((e: unknown) => e);
    expect(isNetworkError(unauthorized)).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
    expect(await getAccessToken()).toBeNull();
  });
});
