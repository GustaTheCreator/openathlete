import { type Page, expect } from '@playwright/test';

import type { TestAthlete } from './api';
import { apiHeaders, randomClientIp } from './api';
import { API_URL, WEB_URL } from './env';

/**
 * Logs the page in through the browser cookie-session API contract. The
 * request context shares its cookie jar with the page; no JWT enters storage.
 */
export async function signIn(page: Page, athlete: TestAthlete) {
  const response = await page.request.post(`${API_URL}/auth/login`, {
    headers: {
      ...apiHeaders(randomClientIp()),
      Origin: WEB_URL,
      'X-Auth-Mode': 'cookie',
    },
    data: { email: athlete.email, password: athlete.password },
  });
  expect(response.status(), await response.text()).toBe(201);
  const refreshCookie = (await page.context().cookies(WEB_URL)).find(
    ({ name }) => /^(?:__Host-)?oa_refresh$/.test(name),
  );
  expect(refreshCookie?.httpOnly).toBe(true);
}
