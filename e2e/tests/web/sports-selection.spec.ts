import { type Page, expect, test } from '@playwright/test';

import { importRecentRun } from '../../support/activities';
import { apiHeaders, createAthlete } from '../../support/api';
import { signIn } from '../../support/browser';
import { API_URL } from '../../support/env';
import { trackPageProblems } from '../../support/page-health';

test.use({ storageState: { cookies: [], origins: [] } });

const SPORTS = [
  'CYCLING',
  'RUNNING',
  'STRENGTH',
  'WALK',
  'SWIMMING',
  'MOBILITY',
];
const LABELS = [
  'Cycling',
  'Running',
  'Strength Training',
  'Walking',
  'Swimming',
  'Mobility',
];

async function openForm(page: Page, action: string) {
  await page.goto('/dashboard/calendar');
  const day = page.locator('[data-calendar-day]').nth(9);
  await day.hover();
  await day.locator('[data-calendar-day-plan]').click();
  await page.getByRole('menuitem', { name: action }).click();
  return page.getByRole('dialog');
}

test('new sessions offer the six team sports and save cycling by default', async ({
  page,
  request,
}, testInfo) => {
  const athlete = await createAthlete(request);
  await signIn(page, athlete);
  const problems = trackPageProblems(page);
  const form = await openForm(page, 'Plan a training');

  await expect(form.locator('[data-sport-chip]')).toHaveCount(6);
  await expect(form.getByRole('combobox', { name: 'Other sport' })).toHaveCount(
    0,
  );
  expect(
    await form
      .locator('[data-sport-chip]')
      .evaluateAll((chips) =>
        chips.map((chip) => chip.getAttribute('data-sport-chip')),
      ),
  ).toEqual(SPORTS);
  await expect(form.locator('[data-sport-chip="CYCLING"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await testInfo.attach('desktop-six-sports.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await form.locator('[data-session-name]').fill('Cycling choice');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.locator('.calendar-event', { hasText: 'Cycling choice' }),
  ).toBeVisible();

  const response = await request.get(`${API_URL}/event`, {
    headers: apiHeaders(undefined, athlete.accessToken),
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual([
    expect.objectContaining({ name: 'Cycling choice', sport: 'CYCLING' }),
  ]);
  expect(problems).toEqual([]);
});

test('manual activities use the same six sports and start with cycling', async ({
  page,
  request,
}, testInfo) => {
  const athlete = await createAthlete(request);
  await signIn(page, athlete);
  const problems = trackPageProblems(page);
  const form = await openForm(page, 'Add an activity');

  const sport = form.getByRole('combobox', { name: 'Sport' });
  await expect(sport).toContainText('Cycling');
  await sport.click();
  await expect(page.getByRole('option')).toHaveText(LABELS);
  await testInfo.attach('manual-activity-six-sports.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('option', { name: 'Mobility', exact: true }).click();
  await form.getByLabel('Event Name').fill('Mobility choice');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.locator('.calendar-event', { hasText: 'Mobility choice' }),
  ).toBeVisible();

  const response = await request.get(`${API_URL}/event`, {
    headers: apiHeaders(undefined, athlete.accessToken),
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual([
    expect.objectContaining({ name: 'Mobility choice', sport: 'MOBILITY' }),
  ]);
  expect(problems).toEqual([]);
});

test('six sports remain usable at a narrow mobile viewport', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const athlete = await createAthlete(request);
  await signIn(page, athlete);
  const problems = trackPageProblems(page);
  await page.goto('/dashboard/calendar');
  await page.locator('[data-calendar-plan-trigger]').click();
  await page.getByRole('menuitem', { name: 'Plan a training' }).click();
  const form = page.getByRole('dialog');

  await expect(form.locator('[data-sport-chip]')).toHaveCount(6);
  await expect(form.locator('[data-sport-chip="CYCLING"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await form.locator('[data-sport-chip="MOBILITY"]').click();
  await expect(form.locator('[data-sport-chip="MOBILITY"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await testInfo.attach('mobile-390x844-mobility-selected.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(problems).toEqual([]);
});

test('an imported sport outside the shortlist survives editing', async ({
  page,
  request,
}) => {
  const athlete = await createAthlete(request);
  const activity = await importRecentRun(
    request,
    athlete,
    'TRAIL_RUNNING',
    1,
    30,
  );
  await signIn(page, athlete);
  const problems = trackPageProblems(page);
  await page.goto('/dashboard/calendar');
  await page.getByText('TRAIL_RUNNING session').first().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit the activity' });
  const sport = form.getByRole('combobox', { name: 'Sport' });
  await expect(sport).toContainText('Trail Running');
  await sport.click();
  await expect(page.getByRole('option')).toHaveText([
    ...LABELS,
    'Trail Running',
  ]);
  await page
    .getByRole('option', { name: 'Trail Running', exact: true })
    .click();
  await form.getByLabel('Event Name').fill('Renamed trail activity');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toBeHidden();

  const response = await request.get(`${API_URL}/event/${activity.eventId}`, {
    headers: apiHeaders(undefined, athlete.accessToken),
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    name: 'Renamed trail activity',
    sport: 'TRAIL_RUNNING',
  });
  expect(problems).toEqual([]);
});
