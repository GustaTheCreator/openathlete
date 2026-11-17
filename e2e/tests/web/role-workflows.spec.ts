import {
  type APIRequestContext,
  type Page,
  type TestInfo,
  expect,
  test,
} from '@playwright/test';

import {
  type TestUser,
  apiHeaders,
  createAthlete,
  linkCoach,
  login,
} from '../../support/api';
import { signIn } from '../../support/browser';
import { API_URL } from '../../support/env';
import { trackPageProblems } from '../../support/page-health';

test.use({ trace: 'off', screenshot: 'off' });

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

async function coachedAthletes(request: APIRequestContext, coach: TestUser) {
  const response = await request.get(`${API_URL}/athlete/coached`, {
    headers: apiHeaders(undefined, coach.accessToken),
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as {
    athleteId: number;
    user: { email: string };
  }[];
}

test('an athlete cannot invite a coach or open administration', async ({
  page,
  request,
}, testInfo) => {
  const athlete = await createAthlete(request);
  await signIn(page, athlete);
  const problems = trackPageProblems(page);

  await page.goto('/dashboard/settings?tab=coaches');
  await expect(
    page.getByRole('heading', { name: 'Coaches', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Invite a coach' }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(
    0,
  );
  await attachScreenshot(page, testInfo, 'athlete-coaches-settings.png');

  await page.goto('/dashboard/admin');
  await expect(page).toHaveURL(/\/403$/);
  await expect(
    page.getByRole('heading', { name: 'Access denied' }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('a dual-role account can enter both sports areas and is labelled as both', async ({
  page,
  request,
}) => {
  const athlete = await createAthlete(request, {
    roles: ['ATHLETE', 'COACH'],
    firstName: 'Dual',
  });
  await signIn(page, athlete);
  const problems = trackPageProblems(page);
  await page.goto('/dashboard/settings?tab=coaches');

  await expect(
    page.getByRole('button', { name: 'Invite a coach' }),
  ).toBeVisible();
  await expect(
    page.getByText('Coach and athlete', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /My training/ }).click();
  const spaces = page.getByRole('menu');
  await expect(
    spaces.getByRole('menuitem', { name: 'My training' }),
  ).toBeVisible();
  await expect(
    spaces.getByRole('menuitem', { name: 'My athletes' }),
  ).toBeVisible();

  await spaces.getByRole('menuitem', { name: 'My athletes' }).click();
  await expect(
    page.getByRole('link', { name: 'Dashboard', exact: true }),
  ).toBeVisible();
  await page.goto('/dashboard/settings?tab=athletes');
  await expect(
    page.getByRole('heading', { name: 'Athletes', level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('No athletes yet. Invite one to start coaching.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: /My athletes/ }).click();
  await page.getByRole('menuitem', { name: 'My training' }).click();
  await expect(
    page.getByRole('link', { name: 'Calendar', exact: true }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('a coach shares a copyable open link that an athlete accepts once', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const coach = await createAthlete(request, {
    roles: ['ATHLETE', 'COACH'],
    firstName: 'Link',
  });
  const athlete = await createAthlete(request, { firstName: 'LinkTarget' });
  const otherAthlete = await createAthlete(request, {
    firstName: 'LinkOther',
  });
  await page.addInitScript(() =>
    localStorage.setItem('current_space', 'COACH'),
  );
  await signIn(page, coach);
  const problems = trackPageProblems(page);

  await page.goto('/dashboard/settings?tab=athletes');
  await expect(
    page.getByRole('button', { name: 'Invite Athlete' }),
  ).toBeVisible();
  await attachScreenshot(page, testInfo, 'coach-athletes-settings.png');
  await page.getByRole('button', { name: 'Invite Athlete' }).click();
  const dialog = page.getByRole('dialog');
  const linkField = dialog.locator('#invitation-link-url');
  await expect(linkField).toBeVisible();
  const invitationUrl = await linkField.inputValue();
  expect(invitationUrl).toContain('/auth/invitation?token=');
  const invitationPath =
    new URL(invitationUrl).pathname + new URL(invitationUrl).search;

  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  const recipientProblems = trackPageProblems(recipientPage);
  try {
    await signIn(recipientPage, athlete);
    await recipientPage.goto(invitationPath);
    await expect(
      recipientPage.getByRole('button', {
        name: 'Accept invitation',
        exact: true,
      }),
    ).toBeVisible();
    await recipientPage
      .getByRole('button', { name: 'Accept invitation', exact: true })
      .click();
    await expect(recipientPage).toHaveURL(/\/dashboard/);

    const recipientProfile = await request.get(`${API_URL}/athlete/me`, {
      headers: apiHeaders(undefined, athlete.accessToken),
    });
    expect(recipientProfile.status(), await recipientProfile.text()).toBe(200);
    const { athleteId } = (await recipientProfile.json()) as {
      athleteId: number;
    };
    expect(
      (await coachedAthletes(request, coach)).map((row) => row.athleteId),
    ).toContain(athleteId);

    const spentContext = await browser.newContext();
    const spentPage = await spentContext.newPage();
    const spentProblems = trackPageProblems(spentPage);
    try {
      await signIn(spentPage, otherAthlete);
      await spentPage.goto(invitationPath);
      await expect(spentPage.getByRole('alert')).toContainText(
        'This invitation is invalid, expired or already used.',
      );
      expect(spentProblems).toEqual([]);
    } finally {
      await spentContext.close();
    }
  } finally {
    await recipientContext.close();
  }
  expect(recipientProblems).toEqual([]);
  expect(problems).toEqual([]);
});

test('the roster UI accepts SHARE and a two-athlete TRANSFER with the right access', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const coach = await createAthlete(request, {
    roles: ['ATHLETE', 'COACH'],
    firstName: 'RosterOwner',
  });
  const shared = await createAthlete(request, { firstName: 'Shared' });
  const transferredOne = await createAthlete(request, {
    firstName: 'TransferOne',
  });
  const transferredTwo = await createAthlete(request, {
    firstName: 'TransferTwo',
  });
  for (const athlete of [shared, transferredOne, transferredTwo]) {
    await linkCoach(request, coach, athlete);
  }
  const initialRoster = await coachedAthletes(request, coach);
  const idFor = (email: string) => {
    const row = initialRoster.find((athlete) => athlete.user.email === email);
    if (!row)
      throw new Error('The synthetic athlete was not in the coach roster');
    return row.athleteId;
  };
  const sharedId = idFor(shared.email);
  const transferredIds = [
    idFor(transferredOne.email),
    idFor(transferredTwo.email),
  ];
  const recipient = await createAthlete(request, {
    firstName: 'RosterRecipient',
  });

  await page.addInitScript(() =>
    localStorage.setItem('current_space', 'COACH'),
  );
  await signIn(page, coach);
  const problems = trackPageProblems(page);
  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  const recipientProblems = trackPageProblems(recipientPage);
  try {
    await signIn(recipientPage, recipient);
    await page.goto('/dashboard/settings?tab=athletes');

    await page.getByRole('checkbox', { name: 'Select Shared Athlete' }).check();
    await page.getByRole('button', { name: 'Share coaching roster' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Shared Athlete');
    await dialog.locator('#roster-invite-email').fill(recipient.email);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    await recipientPage.goto('/dashboard/settings?tab=invitations');
    await expect(
      recipientPage.getByRole('heading', { name: 'Invitations from athletes' }),
    ).toBeVisible();
    await expect(recipientPage.getByText('Shared Athlete')).toBeVisible();
    await attachScreenshot(
      recipientPage,
      testInfo,
      'received-share-invitation.png',
    );
    await recipientPage
      .getByRole('button', { name: 'Accept', exact: true })
      .click();
    await expect(recipientPage.getByText('Invitation accepted')).toBeVisible();
    expect(
      (await coachedAthletes(request, coach)).map((row) => row.athleteId),
    ).toContain(sharedId);

    await page
      .getByRole('checkbox', { name: 'Select TransferOne Athlete' })
      .check();
    await page
      .getByRole('checkbox', { name: 'Select TransferTwo Athlete' })
      .check();
    await page
      .getByRole('button', { name: 'Transfer coaching roster' })
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('TransferOne Athlete');
    await expect(dialog).toContainText('TransferTwo Athlete');
    await dialog.locator('#roster-invite-email').fill(recipient.email);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    await recipientPage.goto('/dashboard/settings?tab=invitations');
    await expect(recipientPage.getByText('TransferOne Athlete')).toBeVisible();
    await expect(recipientPage.getByText('TransferTwo Athlete')).toBeVisible();
    await attachScreenshot(
      recipientPage,
      testInfo,
      'received-transfer-invitation.png',
    );
    await recipientPage
      .getByRole('button', { name: 'Accept', exact: true })
      .click();
    await expect(recipientPage.getByText('Invitation accepted')).toBeVisible();

    const senderRoster = (await coachedAthletes(request, coach)).map(
      (row) => row.athleteId,
    );
    expect(senderRoster).toContain(sharedId);
    for (const athleteId of transferredIds) {
      expect(senderRoster).not.toContain(athleteId);
    }
    const recipientRoster = await request.get(`${API_URL}/athlete/coached`, {
      headers: apiHeaders(undefined, recipient.accessToken),
    });
    expect(recipientRoster.status(), await recipientRoster.text()).toBe(200);
    const recipientIds = (
      (await recipientRoster.json()) as { athleteId: number }[]
    )
      .map((row) => row.athleteId)
      .sort((a, b) => a - b);
    expect(recipientIds).toHaveLength(3);
    expect(recipientIds).toEqual(
      [sharedId, ...transferredIds].sort((a, b) => a - b),
    );
    expect(recipientProblems).toEqual([]);
  } finally {
    await recipientContext.close();
  }
  expect(problems).toEqual([]);
});

test('a super-admin grants a fixture account coach access without granting administration or roster access', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const target = await createAthlete(request, { firstName: 'RoleTarget' });
  const adminActor = await createAthlete(request, { firstName: 'AdminActor' });
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();
  const bootstrapAdmin = await login(request, email!, password!);
  const adminProfile = await request.get(`${API_URL}/user/me`, {
    headers: apiHeaders(undefined, adminActor.accessToken),
  });
  expect(adminProfile.status(), await adminProfile.text()).toBe(200);
  const { userId: adminUserId } = (await adminProfile.json()) as {
    userId: number;
  };
  const adminGrant = await request.patch(
    `${API_URL}/admin/users/${adminUserId}/roles`,
    {
      headers: apiHeaders(undefined, bootstrapAdmin.accessToken),
      data: { roles: ['ATHLETE', 'SUPER_ADMIN'] },
    },
  );
  expect(adminGrant.status(), await adminGrant.text()).toBe(200);
  const admin = {
    ...adminActor,
    ...(await login(request, adminActor.email, adminActor.password)),
  };
  await signIn(page, admin);
  const problems = trackPageProblems(page);
  await page.goto('/dashboard/admin');
  await expect(
    page.getByRole('heading', {
      name: 'Administration',
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Search users').fill(target.email);
  const userRow = page
    .getByText(target.email, { exact: true })
    .locator('xpath=../..');
  await expect(userRow).toBeVisible();
  await userRow.getByRole('checkbox', { name: 'COACH' }).check();
  await userRow.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('Roles updated.', { exact: true })).toBeVisible();
  await expect(
    userRow.getByRole('checkbox', { name: 'ATHLETE' }),
  ).toBeChecked();
  await expect(userRow.getByRole('checkbox', { name: 'COACH' })).toBeChecked();
  await expect(
    userRow.getByRole('checkbox', { name: 'SUPER_ADMIN' }),
  ).not.toBeChecked();
  await attachScreenshot(page, testInfo, 'admin-role-grant.png');

  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const targetProblems = trackPageProblems(targetPage);
  try {
    await signIn(targetPage, target);
    await targetPage.goto('/dashboard/settings?tab=coaches');
    await expect(
      targetPage.getByText('Coach and athlete', { exact: true }),
    ).toBeVisible();
    await targetPage.getByRole('button', { name: /My training/ }).click();
    const spaces = targetPage.getByRole('menu');
    await expect(
      spaces.getByRole('menuitem', { name: 'My training' }),
    ).toBeVisible();
    await expect(
      spaces.getByRole('menuitem', { name: 'My athletes' }),
    ).toBeVisible();
    await expect(
      spaces.getByRole('menuitem', { name: /SUPER_ADMIN|Administration/ }),
    ).toHaveCount(0);
    await spaces.getByRole('menuitem', { name: 'My athletes' }).click();
    await targetPage.goto('/dashboard/settings?tab=athletes');
    await expect(
      targetPage.getByText('No athletes yet. Invite one to start coaching.', {
        exact: true,
      }),
    ).toBeVisible();
    await targetPage.getByRole('button', { name: /My athletes/ }).click();
    await targetPage.getByRole('menuitem', { name: 'My training' }).click();
    await expect(
      targetPage.getByRole('link', { name: 'Calendar', exact: true }),
    ).toBeVisible();
    await targetPage.goto('/dashboard/admin');
    await expect(targetPage).toHaveURL(/\/403$/);
    expect(targetProblems).toEqual([]);
  } finally {
    await targetContext.close();
  }
  expect(problems).toEqual([]);
});
