import axios from 'axios';

import { routes } from './axios';
import { getApiBaseUrl, isCapacitor } from './capacitor';
import { ACCESS_TOKEN, REFRESH_TOKEN, removeItem } from './local-storage';

let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;
let refreshInFlight: Promise<TokenInfo | null> | null = null;

type TokenInfo = {
  accessToken: string;
  refreshed: boolean;
  refreshToken?: string;
};

function discardLegacySessionTokens() {
  removeItem(ACCESS_TOKEN);
  removeItem(REFRESH_TOKEN);
}

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const name =
    window.location.protocol === 'https:' ? '__Host-oa_csrf' : 'oa_csrf';
  const prefix = `${name}=`;
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function authHeaders(csrfToken?: string) {
  return {
    'X-Auth-Mode': 'cookie',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  };
}

export function setAccessToken(token: string) {
  discardLegacySessionTokens();
  memoryAccessToken = token;
}

export function setRefreshToken(token: string) {
  discardLegacySessionTokens();
  memoryRefreshToken = token;
}

export function clearAuthTokens() {
  memoryRefreshToken = null;
  memoryAccessToken = null;
  discardLegacySessionTokens();
}

function decodeJWT(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return decoded;
  } catch {
    return null;
  }
}

export function isValidToken(token: string): boolean {
  try {
    const decoded = decodeJWT(token);
    if (!decoded || !decoded.exp) return false;
    return decoded.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

/**
 * Check if a token will expire within the specified number of minutes
 * @param token The JWT token to check
 * @param minutesBeforeExpiry Number of minutes before expiry to consider as "expiring soon" (default: 5)
 * @returns true if the token will expire within the specified number of minutes
 */
export function isTokenExpiringSoon(
  token: string,
  minutesBeforeExpiry: number = 5,
): boolean {
  try {
    const decoded = decodeJWT(token);
    if (!decoded || !decoded.exp) return true;
    const expiryTime = decoded.exp * 1000;
    const threshold = minutesBeforeExpiry * 60 * 1000;
    return expiryTime - Date.now() < threshold;
  } catch {
    return true;
  }
}

async function refreshTokenOnce(force: boolean): Promise<TokenInfo | null> {
  if (!isCapacitor()) {
    discardLegacySessionTokens();
    const currentToken = memoryAccessToken;
    const currentTokenInfo =
      currentToken && isValidToken(currentToken)
        ? { accessToken: currentToken, refreshed: false }
        : null;
    if (
      !force &&
      currentTokenInfo &&
      !isTokenExpiringSoon(currentTokenInfo.accessToken)
    ) {
      return currentTokenInfo;
    }

    const csrfToken = readCsrfToken();
    if (!csrfToken) return currentTokenInfo;
    try {
      const { data } = await axios.post(
        `${getApiBaseUrl()}${routes.auth.refreshToken}`,
        {},
        {
          withCredentials: true,
          headers: authHeaders(csrfToken),
        },
      );
      if (typeof data?.accessToken !== 'string') return null;
      setAccessToken(data.accessToken);
      return { accessToken: data.accessToken, refreshed: true };
    } catch {
      return currentTokenInfo;
    }
  }

  discardLegacySessionTokens();
  const token = memoryRefreshToken;
  if (!token) return null;

  try {
    const { data } = await axios.post(
      `${getApiBaseUrl()}${routes.auth.refreshToken}`,
      { refreshToken: token },
    );
    if (
      typeof data?.accessToken !== 'string' ||
      typeof data?.refreshToken !== 'string'
    ) {
      return null;
    }
    setRefreshToken(data.refreshToken);
    setAccessToken(data.accessToken);
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      refreshed: true,
    };
  } catch {
    return null;
  }
}

export function refreshToken(force = true): Promise<TokenInfo | null> {
  if (refreshInFlight) return refreshInFlight;

  const run = () => refreshTokenOnce(force);
  const lockManager = !isCapacitor() ? navigator.locks : undefined;
  const pending: Promise<TokenInfo | null> = lockManager
    ? new Promise((resolve, reject) => {
        void lockManager
          .request('openathlete-auth-refresh', async () => {
            try {
              resolve(await run());
            } catch (error) {
              reject(error);
            }
          })
          .catch(reject);
      })
    : run();
  const tracked = pending.finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = tracked;
  return tracked;
}

export async function getAccessToken(): Promise<TokenInfo | null> {
  if (isCapacitor()) {
    discardLegacySessionTokens();
    const token = memoryAccessToken;
    if (token && isValidToken(token) && !isTokenExpiringSoon(token)) {
      return { accessToken: token, refreshed: false };
    }
    return refreshToken();
  }

  discardLegacySessionTokens();
  if (
    memoryAccessToken &&
    isValidToken(memoryAccessToken) &&
    !isTokenExpiringSoon(memoryAccessToken)
  ) {
    return { accessToken: memoryAccessToken, refreshed: false };
  }
  return refreshToken(false);
}

export async function logoutAuthSession(): Promise<void> {
  const native = isCapacitor();
  const tokenInfo = await getAccessToken();
  const token = tokenInfo?.accessToken;
  if (!token) return;
  const csrfToken = native ? null : readCsrfToken();
  if (!native && !csrfToken) return;
  await axios.post(
    `${getApiBaseUrl()}${routes.auth.logout}`,
    {},
    {
      timeout: 5000,
      headers: {
        ...(csrfToken ? authHeaders(csrfToken) : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(!native ? { withCredentials: true } : {}),
    },
  );
}
