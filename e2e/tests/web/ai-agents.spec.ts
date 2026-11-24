import { expect, test } from '@playwright/test';

import { apiHeaders, createAthlete } from '../../support/api';
import { signIn } from '../../support/browser';
import { API_URL } from '../../support/env';

test('external AI agents and their settings are unavailable', async ({
  page,
  request,
}) => {
  const athlete = await createAthlete(request);
  await signIn(page, athlete);

  await page.goto('/dashboard/settings?tab=agents');
  await expect(page.getByText('No agent is connected yet.')).toHaveCount(0);
  await expect(page.locator('[data-mcp-url]')).toHaveCount(0);

  const mcp = await request.post(`${API_URL}/mcp`, {
    headers: {
      ...apiHeaders(undefined, athlete.accessToken),
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(mcp.status()).toBe(404);
  expect(
    (
      await request.get(`${API_URL}/.well-known/oauth-protected-resource/mcp`)
    ).status(),
  ).toBe(404);
});
