import { expect, test } from '@playwright/test';

import { apiHeaders, createAthlete } from '../../support/api';
import { signIn } from '../../support/browser';
import { API_URL } from '../../support/env';
import { trackPageProblems } from '../../support/page-health';

test('AI settings and calendar actions are unavailable', async ({
  page,
  request,
}) => {
  const athlete = await createAthlete(request);
  await signIn(page, athlete);
  const problems = trackPageProblems(page);

  await page.goto('/dashboard/settings?tab=ai');
  await expect(
    page.getByRole('heading', { name: 'Connectors', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'AI', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-ai-data-sharing]')).toHaveCount(0);

  await page.goto('/dashboard/calendar');
  await page.locator('[data-calendar-day]').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Create with AI', exact: true }),
  ).toHaveCount(0);

  const headers = apiHeaders(undefined, athlete.accessToken);
  expect(
    (await request.get(`${API_URL}/ai/providers`, { headers })).status(),
  ).toBe(404);
  expect(
    (await request.get(`${API_URL}/ai/access`, { headers })).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`${API_URL}/activity-feedback/transcribe`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(problems).toEqual([]);
});
