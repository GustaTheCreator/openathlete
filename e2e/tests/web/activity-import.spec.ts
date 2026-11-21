import { expect } from '@playwright/test';
import path from 'node:path';

import { test } from '../../support/authenticated-test';

// A synthetic 10-minute run recorded with the Garmin FIT SDK; no real data.
const FIT = path.join(import.meta.dirname, '../../fixtures/synthetic-run.fit');
const GPX = path.join(import.meta.dirname, '../../fixtures/synthetic-run.gpx');
const TCX = path.join(import.meta.dirname, '../../fixtures/synthetic-run.tcx');

test('imports FIT files from Settings > Connectors', async ({ page }) => {
  await page.goto('/dashboard/settings?tab=connectors');
  await page.locator('[data-import-fit-trigger]').click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="file"]').setInputFiles(FIT);
  await expect(dialog.locator('input[name="name"]')).toHaveValue(
    'synthetic-run',
  );
  await dialog.locator('button[type="submit"]').click();

  const result = dialog.locator('[data-import-result="ok"]');
  await expect(result).toBeVisible();
  await expect(result).toContainText('synthetic-run');
  await expect(result.getByRole('button')).toBeVisible();
});

test('imports a GPX file with its track name and a sport', async ({ page }) => {
  await page.goto('/dashboard/settings?tab=connectors');
  await page.locator('[data-import-fit-trigger]').click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="file"]').setInputFiles(GPX);
  // The name comes from the track, not the file.
  await expect(dialog.locator('input[name="name"]')).toHaveValue(
    'Synthetic run',
  );
  await dialog.locator('select[name="sport"]').selectOption('RUNNING');
  await dialog.locator('button[type="submit"]').click();

  const result = dialog.locator('[data-import-result="ok"]');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Synthetic run');
});

test('imports a TCX file with its notes as the name', async ({ page }) => {
  await page.goto('/dashboard/settings?tab=connectors');
  await page.locator('[data-import-fit-trigger]').click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="file"]').setInputFiles(TCX);
  // The name comes from the activity's notes, not the file.
  await expect(dialog.locator('input[name="name"]')).toHaveValue(
    'Synthetic run',
  );
  await dialog.locator('button[type="submit"]').click();

  const result = dialog.locator('[data-import-result="ok"]');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Synthetic run');
});

test('imports the selected Wahoo history period', async ({ page }) => {
  const requestBodies: unknown[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/instance', (route) =>
    route.fulfill({
      json: {
        googleSignIn: false,
        garminPersonalApi: false,
        email: false,
        personalEmails: false,
        providers: ['WAHOO'],
        signup: 'open',
        oidc: { name: 'Fake IdP' },
        images: false,
      },
    }),
  );
  await page.route('**/api/provider/connected', (route) =>
    route.fulfill({
      json: [
        {
          provider: 'WAHOO',
          status: 'CONNECTED',
          connectedAt: new Date().toISOString(),
          importActivitiesEnabled: true,
          exportWorkoutsEnabled: false,
          importMetricsEnabled: false,
          activityDescriptionEnabled: false,
          activityDescriptionLanguage: null,
          activityDescriptionAuthorized: false,
          fullImportRequestedAt: null,
          fullImportCompletedAt: null,
        },
      ],
    }),
  );
  await page.route('**/api/provider/wahoo/import-all', async (route) => {
    requestBodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true, queued: true } });
  });

  await page.goto('/dashboard/settings?tab=connectors');
  await page.getByRole('button', { name: /Wahoo.*sync options/i }).click();
  const period = page.getByRole('combobox', { name: 'History period' });
  await expect(period).toContainText('1 month');
  await period.click();
  await expect(page.getByRole('option')).toHaveText([
    '1 week',
    '1 month',
    '2 months',
    '6 months',
    '1 year',
    'Custom',
  ]);
  await page.getByRole('option', { name: 'Custom' }).click();
  await page.getByLabel('From').fill('2025-01-15');
  await page.getByLabel('To').fill('2025-02-20');
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  await expect
    .poll(() => requestBodies)
    .toEqual([
      { period: 'custom', startDate: '2025-01-15', endDate: '2025-02-20' },
    ]);
  await page.getByRole('button', { name: 'Import all activities' }).click();
  await expect
    .poll(() => requestBodies)
    .toEqual([
      { period: 'custom', startDate: '2025-01-15', endDate: '2025-02-20' },
      { period: 'all' },
    ]);
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
