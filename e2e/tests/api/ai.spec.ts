import { expect, test } from '@playwright/test';

import { apiHeaders, createAthlete } from '../../support/api';
import { API_URL } from '../../support/env';

test('built-in AI API routes are unavailable', async ({ request }) => {
  const athlete = await createAthlete(request);
  const headers = apiHeaders(undefined, athlete.accessToken);

  const responses = await Promise.all([
    request.get(`${API_URL}/ai/access`, { headers }),
    request.get(`${API_URL}/ai/providers`, { headers }),
    request.get(`${API_URL}/ai/credentials`, { headers }),
    request.post(`${API_URL}/ai/consent`, { headers }),
    request.put(`${API_URL}/ai/models`, {
      headers,
      data: { preferences: [] },
    }),
    request.post(`${API_URL}/agent/ai/events/generate`, {
      headers,
      data: { prompt: '45 minutes easy run', date: '2026-10-05' },
    }),
    request.post(`${API_URL}/activity-feedback/transcribe`, { headers }),
  ]);

  for (const response of responses) {
    expect(response.status(), await response.text()).toBe(404);
  }
});
