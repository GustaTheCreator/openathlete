import { expect, test } from '@playwright/test';

import { API_URL } from '../../support/env';

test('release serves healthy API and matching source link', async ({
  page,
  request,
}) => {
  const health = await request.get(`${API_URL}/health`);
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: 'ok' });
  await page.goto('/auth/login');
  const source = page.getByRole('link', { name: 'Source code', exact: true });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute(
    'href',
    process.env.EXPECTED_SOURCE_URL ??
      /^https:\/\/github\.com\/GustaTheCreator\/openathlete\/tree\//,
  );
});
