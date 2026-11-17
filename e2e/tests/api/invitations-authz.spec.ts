import { expect, test } from '@playwright/test';

import { apiHeaders, createAthlete } from '../../support/api';
import { API_URL } from '../../support/env';

test('an athlete cannot issue invitations or recover sent invitation links', async ({
  request,
}) => {
  const athlete = await createAthlete(request);
  const headers = apiHeaders(undefined, athlete.accessToken);

  for (const path of ['/athlete/invite/athlete', '/athlete/invite/coach']) {
    const response = await request.post(`${API_URL}${path}`, {
      headers,
      data: { email: 'invite-target@example.com' },
    });
    expect(response.status(), await response.text()).toBe(403);
  }

  for (const path of [
    '/athlete/coached',
    '/coach/dashboard',
    '/athlete/invitations/athletes/sent',
    '/athlete/invitations/coaches/sent',
  ]) {
    const response = await request.get(`${API_URL}${path}`, { headers });
    expect(response.status(), await response.text()).toBe(403);
  }
});
