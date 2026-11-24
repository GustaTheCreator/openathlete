import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { createAthlete } from '../../support/api';
import { WEB_URL } from '../../support/env';

// The E2E stack signs in through fake-oidc (see fake-oidc/server.mjs)
async function signInWithSso(page: Page, email: string) {
  await page.goto('/auth/login');
  await page.locator('[data-oidc-sign-in]').click();
  await page.waitForURL(/localhost:19000\/authorize/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function refreshCookie(page: Page) {
  return (await page.context().cookies(WEB_URL)).find(({ name }) =>
    /^(?:__Host-)?oa_refresh$/.test(name),
  );
}

test('creates the account on a first sign-in', async ({ page }) => {
  await signInWithSso(page, `sso-${randomUUID()}@example.com`);
  // A new account starts with the onboarding
  await page.waitForURL(/\/dashboard\/onboarding/);
  await expect(
    page.getByRole('heading', { name: 'Welcome to OpenAthlete!' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Get Started' }).click();
  await expect(page.getByText('What describes you best?')).toBeVisible();
  expect(
    await page.evaluate(() => [
      localStorage.getItem('access_token'),
      localStorage.getItem('refresh_token'),
    ]),
  ).toEqual([null, null]);
  expect((await refreshCookie(page))?.httpOnly).toBe(true);
  // The one-time code does not stay in the address bar
  expect(page.url()).not.toContain('code=');
});

test('signs in the account of the same address', async ({ page, request }) => {
  const athlete = await createAthlete(request);
  await signInWithSso(page, athlete.email.toUpperCase());
  await page.waitForURL(/\/dashboard/);
  await expect(page.locator('[data-sso-error]')).toHaveCount(0);
  expect((await refreshCookie(page))?.httpOnly).toBe(true);
});

test('refuses an address the provider did not verify', async ({ page }) => {
  await signInWithSso(page, 'unverified@example.com');
  await expect(
    page.locator('[data-sso-error="email_unverified"]'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [
      localStorage.getItem('access_token'),
      localStorage.getItem('refresh_token'),
    ]),
  ).toEqual([null, null]);
  expect(await refreshCookie(page)).toBeUndefined();
});
