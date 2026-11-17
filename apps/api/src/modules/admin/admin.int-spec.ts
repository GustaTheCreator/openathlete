import { randomUUID } from 'node:crypto';

import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';

import { UserRole } from '@openathlete/database';
import { ApiEnvSchemaType } from '@openathlete/shared';

import { bootstrapSuperAdmin } from '../../cli/bootstrap-super-admin';
import {
  inspectAthleteCoaches,
  repairCoachAthleteRole,
} from '../../cli/repair-coach-athlete';
import { UserTypeGuard } from '../auth/guards';
import {
  COACH_USER_ID,
  DELETED_ATHLETE_ID,
  DELETED_USER_ID,
  accountFixtureSql,
} from '../auth/services/account-deletion.fixture';
import { AthleteInvitationService } from '../auth/services/athlete-invitation.service';
import { CoachInvitationService } from '../auth/services/coach-invitation.service';
import { InvitationPolicyService } from '../auth/services/invitation-policy.service';
import { PrismaService } from '../prisma/services/prisma.service';
import { FeatureAccessService } from '../subscription';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'INTEGRATION_DATABASE_URL must point to a disposable test database',
  );

describe('admin API (PostgreSQL + HTTP)', () => {
  let prisma: PrismaService;
  let app: INestApplication;
  let origin: string;
  let adminId: number;
  let secondAdminId: number;
  let dualId: number;
  let dualAthleteId: number;
  let newAthleteId: number;
  let newAthleteUserId: number;
  let maxAthletes: number | null = null;

  const send = (
    path: string,
    method = 'GET',
    body?: unknown,
    actorId?: number,
    staleAdmin = false,
  ) =>
    fetch(`${origin}/admin${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(actorId ? { 'x-test-user': String(actorId) } : {}),
        ...(staleAdmin ? { 'x-test-stale-admin': 'true' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const createAccount = async (
    email: string,
    roles: UserRole[],
    withAthlete = false,
  ) =>
    prisma.user.create({
      data: {
        email,
        password: 'integration-hash',
        firstName: 'Test',
        lastName: 'Account',
        onboardingCompleted: true,
        roles,
        ...(withAthlete ? { athlete: { create: {} } } : {}),
      },
      select: { userId: true, athlete: { select: { athleteId: true } } },
    });

  beforeAll(async () => {
    prisma = new PrismaService({ datasourceUrl: databaseUrl });
    await prisma.$connect();
    const featureAccess = {
      getMaxAthletes: jest.fn(async () => maxAthletes),
    };
    const policy = new InvitationPolicyService(prisma);
    const config = {
      get: (key: string) =>
        key === 'APP_URL' ? 'http://localhost' : undefined,
    } as unknown as ConfigService<ApiEnvSchemaType, true>;
    const emitter = { emit: jest.fn() };
    const athleteInvitations = new AthleteInvitationService(
      prisma,
      config,
      emitter as never,
      featureAccess as never,
      policy,
    );
    const coachInvitations = new CoachInvitationService(
      prisma,
      config,
      emitter as never,
      featureAccess as never,
      policy,
    );
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        {
          provide: UserTypeGuard,
          useValue: new UserTypeGuard(new Reflector()),
        },
        { provide: PrismaService, useValue: prisma },
        { provide: AthleteInvitationService, useValue: athleteInvitations },
        { provide: CoachInvitationService, useValue: coachInvitations },
        { provide: FeatureAccessService, useValue: featureAccess },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: async (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          const id = Number(request.headers['x-test-user']);
          if (!id) throw new UnauthorizedException();
          const user = await prisma.user.findUnique({
            where: { userId: id },
            select: { userId: true, roles: true },
          });
          request.user = {
            userId: id,
            roles: request.headers['x-test-stale-admin']
              ? [UserRole.SUPER_ADMIN]
              : (user?.roles ?? []),
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    maxAthletes = null;
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((table) => `"${table.table_name}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    for (const sql of accountFixtureSql) await prisma.$executeRawUnsafe(sql);
    const admin = await createAccount(
      'admin@example.test',
      [UserRole.SUPER_ADMIN],
      true,
    );
    const secondAdmin = await createAccount('second-admin@example.test', [
      UserRole.SUPER_ADMIN,
    ]);
    const dual = await createAccount(
      'dual@example.test',
      [UserRole.ATHLETE, UserRole.COACH],
      true,
    );
    const athlete = await createAccount(
      'new-athlete@example.test',
      [UserRole.ATHLETE],
      true,
    );
    adminId = admin.userId;
    secondAdminId = secondAdmin.userId;
    dualId = dual.userId;
    dualAthleteId = dual.athlete!.athleteId;
    newAthleteUserId = athlete.userId;
    newAthleteId = athlete.athlete!.athleteId;
  });

  it('protects every route for missing, athlete-only, coach-only and dual-role actors', async () => {
    expect((await send('/users')).status).toBe(401);
    for (const id of [DELETED_USER_ID, COACH_USER_ID, dualId]) {
      expect((await send('/users', 'GET', undefined, id)).status).toBe(403);
      for (const [path, method, body] of [
        [
          `/users/${DELETED_USER_ID}/roles`,
          'PATCH',
          { roles: [UserRole.SUPER_ADMIN] },
        ],
        ['/coach-athletes', 'GET', undefined],
        [
          '/coach-athletes',
          'POST',
          { coachUserId: COACH_USER_ID, athleteId: DELETED_ATHLETE_ID },
        ],
        ['/coach-athletes/1', 'DELETE', undefined],
        ['/invitations', 'GET', undefined],
        [
          '/invitations',
          'POST',
          {
            kind: 'ATHLETE',
            ownerUserId: COACH_USER_ID,
            email: 'x@example.test',
          },
        ],
        ['/invitations/ATHLETE/1', 'DELETE', undefined],
      ] as const) {
        expect((await send(path, method, body, id)).status).toBe(403);
      }
    }
    expect((await send('/users', 'GET', undefined, adminId)).status).toBe(200);
  });

  it('rechecks DB roles after a stale JWT role claim and returns only safe user fields', async () => {
    expect(
      (await send('/users', 'GET', undefined, DELETED_USER_ID, true)).status,
    ).toBe(403);
    const response = await send('/users', 'GET', undefined, adminId);
    const payload = await response.json();
    const user = payload.users.find(
      (row: { userId: number }) => row.userId === DELETED_USER_ID,
    );
    expect(user).toMatchObject({
      athleteId: DELETED_ATHLETE_ID,
      roles: [UserRole.ATHLETE],
    });
    for (const secret of [
      'password',
      'sessionVersion',
      'tokens',
      'providerAccounts',
      'authSessions',
    ])
      expect(user).not.toHaveProperty(secret);
  });

  it('adds ATHLETE when assigning COACH and preserves explicitly requested roles and profile', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { userId: COACH_USER_ID },
      select: {
        sessionVersion: true,
        athlete: { select: { athleteId: true } },
      },
    });
    const response = await send(
      `/users/${COACH_USER_ID}/roles`,
      'PATCH',
      { roles: [UserRole.COACH] },
      adminId,
    );
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.roles).toEqual(
      expect.arrayContaining([UserRole.ATHLETE, UserRole.COACH]),
    );
    expect(updated.athleteId).toBe(before.athlete?.athleteId);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { userId: COACH_USER_ID },
          select: { sessionVersion: true },
        })
      ).sessionVersion,
    ).toBe(before.sessionVersion + 1);
    const adminUpdated = await send(
      `/users/${adminId}/roles`,
      'PATCH',
      { roles: [UserRole.COACH, UserRole.SUPER_ADMIN] },
      secondAdminId,
    ).then((result) => result.json());
    expect(adminUpdated.roles).toEqual(
      expect.arrayContaining([
        UserRole.ATHLETE,
        UserRole.COACH,
        UserRole.SUPER_ADMIN,
      ]),
    );
    const noProfile = await createAccount('no-profile@example.test', [
      UserRole.ATHLETE,
    ]);
    expect(
      (
        await send(
          `/users/${noProfile.userId}/roles`,
          'PATCH',
          { roles: [UserRole.COACH] },
          adminId,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { userId: noProfile.userId },
          select: { roles: true },
        })
      ).roles,
    ).toEqual([UserRole.ATHLETE]);
  });

  it('validates and unlinks coach associations without removing the athlete profile', async () => {
    const self = await send(
      '/coach-athletes',
      'POST',
      { coachUserId: dualId, athleteId: dualAthleteId },
      adminId,
    );
    expect(self.status).toBe(409);
    const created = await send(
      '/coach-athletes',
      'POST',
      { coachUserId: COACH_USER_ID, athleteId: newAthleteId },
      adminId,
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    const association = body.associations.find(
      (row: { athleteId: number }) => row.athleteId === newAthleteId,
    );
    expect(association).toMatchObject({
      coachUserId: COACH_USER_ID,
      athleteUserId: newAthleteUserId,
    });
    expect(association).not.toHaveProperty('user');
    const deleted = await send(
      `/coach-athletes/${association.coachAthleteId}`,
      'DELETE',
      undefined,
      adminId,
    );
    expect(deleted.status).toBe(200);
    expect(
      await prisma.athlete.findUnique({ where: { athleteId: newAthleteId } }),
    ).not.toBeNull();
  });

  it('enforces the subscription quota for concurrent link creation in the transaction', async () => {
    maxAthletes = 1;
    const otherAthlete = await createAccount(
      'quota-athlete@example.test',
      [UserRole.ATHLETE],
      true,
    );
    const responses = await Promise.all([
      send(
        '/coach-athletes',
        'POST',
        { coachUserId: dualId, athleteId: newAthleteId },
        adminId,
      ),
      send(
        '/coach-athletes',
        'POST',
        { coachUserId: dualId, athleteId: otherAthlete.athlete!.athleteId },
        adminId,
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await prisma.coachAthlete.count({ where: { userId: dualId } })).toBe(
      1,
    );
  });

  it('creates and cancels an owner-validated invitation using safe response metadata', async () => {
    const created = await send(
      '/invitations',
      'POST',
      {
        kind: 'ATHLETE',
        ownerUserId: COACH_USER_ID,
        email: 'invitee@example.test',
      },
      adminId,
    );
    expect(created.status).toBe(201);
    const payload = await created.json();
    const invitation = payload.invitations.find(
      (row: { email: string }) => row.email === 'invitee@example.test',
    );
    expect(invitation).toMatchObject({
      kind: 'ATHLETE',
      ownerUserId: COACH_USER_ID,
      ownerEmail: 'coach@example.com',
    });
    for (const secret of ['token', 'invitationToken', 'url'])
      expect(invitation).not.toHaveProperty(secret);
    const deleted = await send(
      `/invitations/ATHLETE/${invitation.invitationId}`,
      'DELETE',
      undefined,
      adminId,
    );
    expect(deleted.status).toBe(200);

    const coachInvite = await send(
      '/invitations',
      'POST',
      {
        kind: 'COACH',
        ownerUserId: DELETED_USER_ID,
        email: 'colleague@example.test',
        purpose: 'COLLEAGUE',
      },
      adminId,
    );
    expect(coachInvite.status).toBe(201);
    const coachPayload = await coachInvite.json();
    const colleague = coachPayload.invitations.find(
      (row: { email: string | null }) => row.email === 'colleague@example.test',
    );
    expect(colleague).toMatchObject({
      kind: 'COACH',
      purpose: 'COLLEAGUE',
      athleteIds: [],
      ownerUserId: DELETED_USER_ID,
    });
    for (const secret of ['token', 'invitationToken', 'url'])
      expect(colleague).not.toHaveProperty(secret);
    expect(
      (
        await send(
          `/invitations/COACH/${colleague.invitationId}`,
          'DELETE',
          undefined,
          adminId,
        )
      ).status,
    ).toBe(200);

    await prisma.coachInvitation.create({
      data: {
        email: null,
        token: randomUUID(),
        athleteUserId: DELETED_USER_ID,
        purpose: 'PERSONAL',
      },
    });
    const openList = await send('/invitations', 'GET', undefined, adminId).then(
      (result) => result.json(),
    );
    const openInvitation = openList.invitations.find(
      (row: { email: string | null }) => row.email === null,
    );
    expect(openInvitation).toMatchObject({
      kind: 'COACH',
      email: null,
      purpose: 'PERSONAL',
      athleteIds: [],
    });
    for (const secret of ['token', 'invitationToken', 'url'])
      expect(openInvitation).not.toHaveProperty(secret);
  });

  it('preserves a super administrator through concurrent demotions', async () => {
    const results = await Promise.allSettled([
      app
        .get(AdminService)
        .updateRoles(adminId, secondAdminId, [UserRole.ATHLETE]),
      app
        .get(AdminService)
        .updateRoles(secondAdminId, adminId, [UserRole.ATHLETE]),
    ]);
    expect(results.some((result) => result.status === 'rejected')).toBe(true);
    expect(
      await prisma.user.count({
        where: { roles: { has: UserRole.SUPER_ADMIN } },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('blocks coach demotion for pending roster transfers without active links', async () => {
    const target = await createAccount(
      'pending-roster-coach@example.test',
      [UserRole.ATHLETE, UserRole.COACH],
      true,
    );
    expect(
      await prisma.coachAthlete.count({ where: { userId: target.userId } }),
    ).toBe(0);
    const roster = await prisma.coachInvitation.create({
      data: {
        email: 'recipient@example.test',
        athleteUserId: target.userId,
        purpose: 'TRANSFER',
        athleteIds: [DELETED_ATHLETE_ID],
      },
    });
    await prisma.coachInvitation.create({
      data: {
        email: 'colleague@example.test',
        athleteUserId: target.userId,
        purpose: 'COLLEAGUE',
      },
    });
    const before = await prisma.user.findUniqueOrThrow({
      where: { userId: target.userId },
      select: { roles: true, sessionVersion: true },
    });

    expect(
      (
        await send(
          `/users/${target.userId}/roles`,
          'PATCH',
          { roles: [UserRole.ATHLETE] },
          adminId,
        )
      ).status,
    ).toBe(409);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { userId: target.userId },
        select: { roles: true, sessionVersion: true },
      }),
    ).toEqual(before);

    expect(
      (
        await send(
          `/invitations/COACH/${roster.coachInvitationId}`,
          'DELETE',
          undefined,
          adminId,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          `/users/${target.userId}/roles`,
          'PATCH',
          { roles: [UserRole.ATHLETE] },
          adminId,
        )
      ).status,
    ).toBe(200);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { userId: target.userId },
        select: { roles: true, sessionVersion: true },
      }),
    ).toEqual({
      roles: [UserRole.ATHLETE],
      sessionVersion: before.sessionVersion + 1,
    });
  });

  it('bootstraps only the exact ID/email, keeps profile data, and is idempotent', async () => {
    const metricCount = await prisma.athleteMetric.count({
      where: { athleteId: DELETED_ATHLETE_ID },
    });
    const target = await prisma.user.findUniqueOrThrow({
      where: { userId: DELETED_USER_ID },
      select: {
        email: true,
        sessionVersion: true,
        athlete: { select: { athleteId: true } },
      },
    });
    await expect(
      bootstrapSuperAdmin(prisma, DELETED_USER_ID + 99, target.email, true),
    ).rejects.toThrow();
    const adminOnly = await createAccount('admin-only@example.test', [
      UserRole.SUPER_ADMIN,
    ]);
    await expect(
      bootstrapSuperAdmin(
        prisma,
        adminOnly.userId,
        'admin-only@example.test',
        true,
      ),
    ).rejects.toThrow('existing athlete profile');
    const preview = await bootstrapSuperAdmin(
      prisma,
      DELETED_USER_ID,
      target.email,
      false,
    );
    expect(preview.athleteId).toBe(DELETED_ATHLETE_ID);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { userId: DELETED_USER_ID },
        })
      ).roles,
    ).toEqual([UserRole.ATHLETE]);
    await bootstrapSuperAdmin(prisma, DELETED_USER_ID, target.email, true);
    const afterFirst = await prisma.user.findUniqueOrThrow({
      where: { userId: DELETED_USER_ID },
      select: { roles: true, sessionVersion: true },
    });
    await bootstrapSuperAdmin(prisma, DELETED_USER_ID, target.email, true);
    const afterSecond = await prisma.user.findUniqueOrThrow({
      where: { userId: DELETED_USER_ID },
      select: {
        roles: true,
        sessionVersion: true,
        athlete: { select: { athleteId: true } },
      },
    });
    expect(afterFirst.sessionVersion).toBe(target.sessionVersion + 1);
    expect(afterSecond.sessionVersion).toBe(afterFirst.sessionVersion);
    expect(afterSecond.roles).toEqual(
      expect.arrayContaining([
        UserRole.ATHLETE,
        UserRole.COACH,
        UserRole.SUPER_ADMIN,
      ]),
    );
    expect(afterSecond.athlete?.athleteId).toBe(DELETED_ATHLETE_ID);
    expect(
      await prisma.athleteMetric.count({
        where: { athleteId: DELETED_ATHLETE_ID },
      }),
    ).toBe(metricCount);
  });

  it('repairs a coach-only account by adding only ATHLETE and preserving sessions/profile data', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { userId: COACH_USER_ID },
      select: {
        email: true,
        sessionVersion: true,
        athlete: { select: { athleteId: true } },
      },
    });
    const providerCount = await prisma.providerAccount.count({
      where: { athleteId: before.athlete!.athleteId },
    });
    const preview = await repairCoachAthleteRole(
      prisma,
      COACH_USER_ID,
      before.email,
      false,
    );
    expect(preview.proposedRoles).toEqual([UserRole.COACH, UserRole.ATHLETE]);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { userId: COACH_USER_ID },
          select: { roles: true, sessionVersion: true },
        })
      ).roles,
    ).toEqual([UserRole.COACH]);
    await repairCoachAthleteRole(prisma, COACH_USER_ID, before.email, true);
    const afterFirst = await prisma.user.findUniqueOrThrow({
      where: { userId: COACH_USER_ID },
      select: { roles: true, sessionVersion: true },
    });
    await repairCoachAthleteRole(prisma, COACH_USER_ID, before.email, true);
    const afterSecond = await prisma.user.findUniqueOrThrow({
      where: { userId: COACH_USER_ID },
      select: {
        roles: true,
        sessionVersion: true,
        athlete: { select: { athleteId: true } },
      },
    });
    expect(afterFirst.roles).toEqual([UserRole.COACH, UserRole.ATHLETE]);
    expect(afterFirst.sessionVersion).toBe(before.sessionVersion + 1);
    expect(afterSecond.sessionVersion).toBe(afterFirst.sessionVersion);
    expect(afterSecond.athlete?.athleteId).toBe(before.athlete?.athleteId);
    expect(
      await prisma.providerAccount.count({
        where: { athleteId: before.athlete!.athleteId },
      }),
    ).toBe(providerCount);
    const coachWithoutProfile = await createAccount(
      'coach-without-profile@example.test',
      [UserRole.COACH],
    );
    await expect(
      repairCoachAthleteRole(
        prisma,
        coachWithoutProfile.userId,
        'coach-without-profile@example.test',
        true,
      ),
    ).rejects.toThrow('existing athlete profile');
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { userId: coachWithoutProfile.userId },
          select: { roles: true },
        })
      ).roles,
    ).toEqual([UserRole.COACH]);
  });

  it('inspects coaches of a personal athlete profile without changing links', async () => {
    const before = await prisma.coachAthlete.findMany({
      where: { athleteId: DELETED_ATHLETE_ID },
      select: { coachAthleteId: true, userId: true },
    });
    const result = await inspectAthleteCoaches(
      prisma,
      DELETED_USER_ID,
      'athlete@example.com',
    );
    expect(result.athleteId).toBe(DELETED_ATHLETE_ID);
    expect(result.coaches).toEqual([
      expect.objectContaining({
        coachAthleteId: before[0].coachAthleteId,
        userId: COACH_USER_ID,
        email: 'coach@example.com',
      }),
    ]);
    expect(
      await prisma.coachAthlete.findMany({
        where: { athleteId: DELETED_ATHLETE_ID },
        select: { coachAthleteId: true, userId: true },
      }),
    ).toEqual(before);
  });
});
