import { expect, test } from '@playwright/test';

import {
  apiHeaders,
  createAthlete,
  createCoachWithAthlete,
  login,
} from '../../support/api';
import { API_URL } from '../../support/env';

test('a COLLEAGUE invitation grants coach access without linking athlete profiles', async ({
  request,
}) => {
  const inviter = await createAthlete(request, { roles: ['ATHLETE', 'COACH'] });
  const colleague = await createAthlete(request);
  const invitation = await request.post(`${API_URL}/athlete/invite/coach`, {
    headers: apiHeaders(undefined, inviter.accessToken),
    data: { email: colleague.email, purpose: 'COLLEAGUE' },
  });
  expect(invitation.status(), await invitation.text()).toBe(201);

  const pending = await request.get(`${API_URL}/coach/invitations/pending`, {
    headers: apiHeaders(undefined, colleague.accessToken),
  });
  expect(pending.status(), await pending.text()).toBe(200);
  const [received] = (await pending.json()) as { coachInvitationId: number }[];
  const accepted = await request.post(
    `${API_URL}/coach/invitations/${received.coachInvitationId}/accept`,
    { headers: apiHeaders(undefined, colleague.accessToken) },
  );
  expect(accepted.status(), await accepted.text()).toBe(201);

  const reauthenticated = await login(
    request,
    colleague.email,
    colleague.password,
  );
  const profile = await request.get(`${API_URL}/user/me`, {
    headers: apiHeaders(undefined, reauthenticated.accessToken),
  });
  expect(profile.status(), await profile.text()).toBe(200);
  expect((await profile.json()).roles).toEqual(
    expect.arrayContaining(['ATHLETE', 'COACH']),
  );

  const inviterLinks = await request.get(`${API_URL}/athlete/coaches`, {
    headers: apiHeaders(undefined, inviter.accessToken),
  });
  expect(inviterLinks.status(), await inviterLinks.text()).toBe(200);
  expect(await inviterLinks.json()).toEqual([]);
  const colleagueLinks = await request.get(`${API_URL}/athlete/coaches`, {
    headers: apiHeaders(undefined, reauthenticated.accessToken),
  });
  expect(colleagueLinks.status(), await colleagueLinks.text()).toBe(200);
  expect(await colleagueLinks.json()).toEqual([]);
  const colleagueAthletes = await request.get(`${API_URL}/athlete/coached`, {
    headers: apiHeaders(undefined, reauthenticated.accessToken),
  });
  expect(colleagueAthletes.status(), await colleagueAthletes.text()).toBe(200);
  expect(await colleagueAthletes.json()).toEqual([]);
});

test('a PERSONAL invitation links the issuer athlete profile to the invited coach', async ({
  request,
}) => {
  const athlete = await createAthlete(request, {
    roles: ['ATHLETE', 'COACH'],
  });
  const coach = await createAthlete(request, { roles: ['ATHLETE', 'COACH'] });
  const invitation = await request.post(`${API_URL}/athlete/invite/coach`, {
    headers: apiHeaders(undefined, athlete.accessToken),
    data: { email: coach.email, purpose: 'PERSONAL' },
  });
  expect(invitation.status(), await invitation.text()).toBe(201);
  const pending = await request.get(`${API_URL}/coach/invitations/pending`, {
    headers: apiHeaders(undefined, coach.accessToken),
  });
  expect(pending.status(), await pending.text()).toBe(200);
  const [received] = (await pending.json()) as { coachInvitationId: number }[];
  const accepted = await request.post(
    `${API_URL}/coach/invitations/${received.coachInvitationId}/accept`,
    { headers: apiHeaders(undefined, coach.accessToken) },
  );
  expect(accepted.status(), await accepted.text()).toBe(201);

  const coaches = await request.get(`${API_URL}/athlete/coaches`, {
    headers: apiHeaders(undefined, athlete.accessToken),
  });
  expect(coaches.status(), await coaches.text()).toBe(200);
  expect(
    (await coaches.json()).map((item: { email: string }) => item.email),
  ).toContain(coach.email);
  const coached = await request.get(`${API_URL}/athlete/coached`, {
    headers: apiHeaders(undefined, coach.accessToken),
  });
  expect(coached.status(), await coached.text()).toBe(200);
  expect(await coached.json()).toEqual([]);
});

test('an open athlete invitation is verifiable, accepted once, then spent', async ({
  request,
}) => {
  const coach = await createAthlete(request, { roles: ['ATHLETE', 'COACH'] });
  const athlete = await createAthlete(request);
  const created = await request.post(`${API_URL}/athlete/invitations/links`, {
    headers: apiHeaders(undefined, coach.accessToken),
    data: { kind: 'ATHLETE' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { url } = (await created.json()) as { url: string };
  const token = new URL(url).searchParams.get('token');
  expect(token).toBeTruthy();

  const preview = await request.get(`${API_URL}/auth/invitation`, {
    params: { token: token! },
  });
  expect(preview.status(), await preview.text()).toBe(200);
  expect(await preview.json()).toMatchObject({ valid: true });
  const accepted = await request.post(`${API_URL}/auth/invitations/accept`, {
    headers: apiHeaders(undefined, athlete.accessToken),
    data: { token },
  });
  expect(accepted.status(), await accepted.text()).toBe(201);
  const repeated = await request.post(`${API_URL}/auth/invitations/accept`, {
    headers: apiHeaders(undefined, athlete.accessToken),
    data: { token },
  });
  expect(repeated.status(), await repeated.text()).toBe(400);
  const spent = await request.get(`${API_URL}/auth/invitation`, {
    params: { token: token! },
  });
  expect(spent.status(), await spent.text()).toBe(200);
  expect(await spent.json()).toMatchObject({ valid: false });
});

test('SHARE preserves the sender link and TRANSFER moves only selected athletes', async ({
  request,
}) => {
  const first = await createCoachWithAthlete(request);
  const second = await createCoachWithAthlete(request);
  const recipient = await createAthlete(request, {
    roles: ['ATHLETE', 'COACH'],
  });

  const share = await request.post(`${API_URL}/coach/roster-invitations`, {
    headers: apiHeaders(undefined, first.coach.accessToken),
    data: {
      email: recipient.email,
      operation: 'SHARE',
      athleteIds: [first.athleteId],
    },
  });
  expect(share.status(), await share.text()).toBe(201);
  const sharePending = await request.get(
    `${API_URL}/coach/invitations/pending`,
    {
      headers: apiHeaders(undefined, recipient.accessToken),
    },
  );
  expect(sharePending.status(), await sharePending.text()).toBe(200);
  const [shareInvite] = (await sharePending.json()) as {
    coachInvitationId: number;
  }[];
  const shareAccepted = await request.post(
    `${API_URL}/coach/invitations/${shareInvite.coachInvitationId}/accept`,
    { headers: apiHeaders(undefined, recipient.accessToken) },
  );
  expect(shareAccepted.status(), await shareAccepted.text()).toBe(201);

  const transfer = await request.post(`${API_URL}/coach/roster-invitations`, {
    headers: apiHeaders(undefined, second.coach.accessToken),
    data: {
      email: recipient.email,
      operation: 'TRANSFER',
      athleteIds: [second.athleteId],
    },
  });
  expect(transfer.status(), await transfer.text()).toBe(201);
  const transferPending = await request.get(
    `${API_URL}/coach/invitations/pending`,
    { headers: apiHeaders(undefined, recipient.accessToken) },
  );
  expect(transferPending.status(), await transferPending.text()).toBe(200);
  const [transferInvite] = (await transferPending.json()) as {
    coachInvitationId: number;
  }[];
  const transferAccepted = await request.post(
    `${API_URL}/coach/invitations/${transferInvite.coachInvitationId}/accept`,
    { headers: apiHeaders(undefined, recipient.accessToken) },
  );
  expect(transferAccepted.status(), await transferAccepted.text()).toBe(201);

  const roster = async (coach: (typeof first)['coach']) => {
    const response = await request.get(`${API_URL}/athlete/coached`, {
      headers: apiHeaders(undefined, coach.accessToken),
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { athleteId: number }[];
  };
  const recipientRoster = await request.get(`${API_URL}/athlete/coached`, {
    headers: apiHeaders(undefined, recipient.accessToken),
  });
  expect(recipientRoster.status(), await recipientRoster.text()).toBe(200);
  expect(
    (await recipientRoster.json()).map(
      (a: { athleteId: number }) => a.athleteId,
    ),
  ).toEqual(expect.arrayContaining([first.athleteId, second.athleteId]));
  expect(
    (await roster(first.coach)).map(({ athleteId }) => athleteId),
  ).toContain(first.athleteId);
  expect(
    (await roster(second.coach)).map(({ athleteId }) => athleteId),
  ).not.toContain(second.athleteId);
});

test('athletes cannot manage roles and invitation purposes cannot grant SUPER_ADMIN', async ({
  request,
}) => {
  const actor = await createAthlete(request);
  const actorProfile = await request.get(`${API_URL}/user/me`, {
    headers: apiHeaders(undefined, actor.accessToken),
  });
  expect(actorProfile.status(), await actorProfile.text()).toBe(200);
  const { userId: actorId } = (await actorProfile.json()) as { userId: number };
  const denied = await request.patch(
    `${API_URL}/admin/users/${actorId}/roles`,
    {
      headers: apiHeaders(undefined, actor.accessToken),
      data: { roles: ['ATHLETE', 'SUPER_ADMIN'] },
    },
  );
  expect(denied.status(), await denied.text()).toBe(403);

  const coach = await createAthlete(request, {
    roles: ['ATHLETE', 'COACH'],
  });
  const escalation = await request.post(`${API_URL}/athlete/invite/coach`, {
    headers: apiHeaders(undefined, coach.accessToken),
    data: { email: actor.email, purpose: 'SUPER_ADMIN' },
  });
  expect(escalation.status(), await escalation.text()).toBe(400);
});
