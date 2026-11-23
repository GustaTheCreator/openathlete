import { m } from '@/paraglide/messages';
import { Browser } from '@capacitor/browser';
import { isAxiosError } from 'axios';

import { isCapacitor } from './capacitor';

export function wahooConnectionQuotaMessage(
  error: unknown,
): string | undefined {
  if (!isAxiosError<{ code?: string; retryAfterSeconds?: number }>(error))
    return undefined;

  const response = error.response;
  const retryAfter = response?.data?.retryAfterSeconds;
  if (
    response?.status === 429 &&
    response.data?.code === 'WAHOO_RATE_LIMITED' &&
    typeof retryAfter === 'number' &&
    Number.isFinite(retryAfter) &&
    retryAfter > 0
  ) {
    return m.wahoo_connection_rate_limited({
      minutes: Math.ceil(retryAfter / 60),
    });
  }
}

/**
 * Open a URL for OAuth flow, using Capacitor Browser in native or window.open in web
 * In native, the OAuth provider will redirect back to the app via deep link
 * The deep link format: org.openathlete://auth/callback/:provider?code=...
 */
export async function openOAuthUrl(url: string): Promise<void> {
  if (isCapacitor()) {
    // Use Capacitor Browser plugin for native apps
    // The OAuth provider will redirect back to our app via deep link
    await Browser.open({
      url,
      windowName: '_self',
      presentationStyle: 'popover',
    });
  } else {
    // Use window.open for web
    window.open(url, '_self')?.focus();
  }
}

/**
 * Close the OAuth browser if it's open
 */
export async function closeOAuthBrowser(): Promise<void> {
  if (isCapacitor()) {
    await Browser.close();
  }
}

/**
 * Set before Strava's consent page when the user turns the activity
 * description on, read back on the OAuth callback to finish the job.
 */
export const ENABLE_DESCRIPTION_AFTER_OAUTH_KEY =
  'oauth_enable_activity_description_STRAVA';

const WAHOO_LOGIN_KEY = 'oauth_pending_WAHOO_';

export function rememberWahooLogin(login: {
  state?: string;
  codeVerifier?: string;
}): void {
  if (!login.state || !login.codeVerifier) {
    throw new Error('Invalid Wahoo authorization response');
  }
  localStorage.setItem(
    WAHOO_LOGIN_KEY + login.state,
    JSON.stringify({
      state: login.state,
      verifier: login.codeVerifier,
      expiresAt: Date.now() + 10 * 60_000,
    }),
  );
}

/** Consume the login once, including failed callbacks, to prevent replay. */
export function consumeWahooLogin(state: string | null): string | null {
  try {
    if (!state) return null;
    const key = WAHOO_LOGIN_KEY + state;
    const stored = localStorage.getItem(key);
    localStorage.removeItem(key);
    if (!stored) return null;
    const login = JSON.parse(stored);
    return login.state === state &&
      typeof login.verifier === 'string' &&
      Number.isFinite(login.expiresAt) &&
      login.expiresAt > Date.now()
      ? login.verifier
      : null;
  } catch {
    return null;
  }
}
