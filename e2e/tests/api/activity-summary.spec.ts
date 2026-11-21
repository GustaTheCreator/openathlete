import { expect, test } from '@playwright/test';

import { apiHeaders, createAthlete } from '../../support/api';
import { API_URL } from '../../support/env';

test('activity creation and retrieval work without AI summaries', async ({
  request,
}) => {
  const athlete = await createAthlete(request);
  const headers = apiHeaders(undefined, athlete.accessToken);
  const start = new Date('2026-10-20T07:00:00Z');

  const created = await request.post(`${API_URL}/event`, {
    headers,
    data: {
      type: 'ACTIVITY',
      name: 'Morning run',
      sport: 'RUNNING',
      startDate: start.toISOString(),
      endDate: new Date(start.getTime() + 3600_000).toISOString(),
      distance: 10_000,
      rpe: 0.6,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { eventId } = (await created.json()) as { eventId: number };

  const response = await request.get(`${API_URL}/event/${eventId}`, {
    headers,
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.json()).toMatchObject({
    eventId,
    name: 'Morning run',
    type: 'ACTIVITY',
  });
});
