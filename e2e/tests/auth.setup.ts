import { expect, test as setup } from '@playwright/test';

import { createAthlete } from '../support/api';
import { AUTH_FILE, WEB_URL } from '../support/env';

// One athlete logged in through the real login form; the desktop and
// mobile projects reuse its HttpOnly refresh cookie.
setup('log in the shared athlete', async ({ page, request }) => {
  const athlete = await createAthlete(request);

  await page.goto('/auth/login');
  await page.fill('input[name="email"]', athlete.email);
  await page.fill('input[name="password"]', athlete.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);

  expect(
    await page.evaluate(() => [
      localStorage.getItem('access_token'),
      localStorage.getItem('refresh_token'),
    ]),
  ).toEqual([null, null]);
  const refreshCookie = (await page.context().cookies(WEB_URL)).find(
    ({ name }) => /^(?:__Host-)?oa_refresh$/.test(name),
  );
  expect(refreshCookie?.httpOnly).toBe(true);

  const state = await page.context().storageState({ path: AUTH_FILE });
  const storedSessionKeys = state.origins
    .flatMap(({ localStorage }) => localStorage)
    .filter(({ name }) => name === 'access_token' || name === 'refresh_token');
  expect(storedSessionKeys).toEqual([]);
});
