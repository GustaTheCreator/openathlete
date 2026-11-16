import { expect, test as setup } from '@playwright/test';

import { createAthlete } from '../support/api';
import { WEB_URL } from '../support/env';

// Exercise the real login form and cookie-only browser session contract.
setup('log in the athlete through the real form', async ({ page, request }) => {
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
});
