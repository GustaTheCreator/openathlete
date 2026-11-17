import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';

import { UserRole } from '@openathlete/database';
import { ApiEnvSchemaType } from '@openathlete/shared';

import { AuthController } from 'src/modules/auth/controllers/auth.controller';
import { AuthUser } from 'src/modules/auth/decorators/user.decorator';
import { UserTypeGuard } from 'src/modules/auth/guards/user-type.guard';
import {
  COACH_ATHLETE_ID,
  COACH_USER_ID,
  DELETED_ATHLETE_ID,
  DELETED_USER_ID,
  accountFixtureSql,
} from 'src/modules/auth/services/account-deletion.fixture';
import { AuthCookieService } from 'src/modules/auth/services/auth-cookie.service';
import { AuthService } from 'src/modules/auth/services/auth.service';
import { CaslAbilityFactory } from 'src/modules/auth/services/casl-ability.factory';
import { accessibleBy } from 'src/modules/auth/services/casl-prisma';
import { AthleteController } from 'src/modules/core/controllers/athlete.controller';
import { CoachController } from 'src/modules/core/controllers/coach.controller';
import { AthleteSettingsService } from 'src/modules/core/services/athlete-settings.service';
import { AthleteService } from 'src/modules/core/services/athlete.service';
import { CoachService } from 'src/modules/core/services/coach.service';
import { PrismaService } from 'src/modules/prisma/services/prisma.service';
import { FeatureAccessService } from 'src/modules/subscription';

import { AthleteInvitationService } from './athlete-invitation.service';
import { CoachInvitationService } from './coach-invitation.service';
import { InvitationPolicyService } from './invitation-policy.service';
import { InvitationService } from './invitation.service';
import { UserService } from './user.service';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'INTEGRATION_DATABASE_URL must point to a disposable test database',
  );
}

describe('invitation backlog (PostgreSQL)', () => {
  let prisma: PrismaService;
  let athleteInvitations: AthleteInvitationService;
  let coachInvitations: CoachInvitationService;
  let abilities: CaslAbilityFactory;
  let app: INestApplication;
  let origin: string;
  let maxAthletes: number | null = null;
  const emailEmitter = { emit: jest.fn() };

  beforeAll(async () => {
    prisma = new PrismaService({ datasourceUrl: databaseUrl });
    await prisma.$connect();
    const config = {
      get: () => 'http://localhost',
      getOrThrow: () => 'http://localhost',
    } as unknown as ConfigService<ApiEnvSchemaType, true>;
    const emitter = emailEmitter as unknown as EventEmitter2;
    const featureAccess = {
      checkAthleteLimit: jest.fn().mockResolvedValue(true),
      getMaxAthletes: jest.fn(async () => maxAthletes),
    } as unknown as FeatureAccessService;
    const policy = new InvitationPolicyService(prisma);
    athleteInvitations = new AthleteInvitationService(
      prisma,
      config,
      emitter,
      featureAccess,
      policy,
    );
    coachInvitations = new CoachInvitationService(
      prisma,
      config,
      emitter,
      featureAccess,
      policy,
    );
    abilities = new CaslAbilityFactory();

    const invitations = new InvitationService(
      athleteInvitations,
      coachInvitations,
    );
    const module = await Test.createTestingModule({
      controllers: [AthleteController, CoachController, AuthController],
      providers: [
        { provide: AthleteService, useValue: {} },
        { provide: AthleteSettingsService, useValue: {} },
        { provide: CoachService, useValue: {} },
        { provide: AthleteInvitationService, useValue: athleteInvitations },
        { provide: CoachInvitationService, useValue: coachInvitations },
        { provide: InvitationService, useValue: invitations },
        { provide: AuthService, useValue: {} },
        { provide: AuthCookieService, useValue: {} },
        {
          provide: UserTypeGuard,
          useValue: new UserTypeGuard(new Reflector()),
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: async (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          const userId = Number(request.headers['x-test-user']);
          if (!userId) throw new UnauthorizedException();
          const user = await prisma.user.findUnique({
            where: { userId },
            select: { userId: true, roles: true },
          });
          if (!user) throw new UnauthorizedException();
          request.user = user;
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
    emailEmitter.emit.mockClear();
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((table) => `"${table.table_name}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    for (const sql of accountFixtureSql) await prisma.$executeRawUnsafe(sql);
  });

  const account = async (
    email: string,
    roles: UserRole[] = [UserRole.ATHLETE],
  ) => {
    const user = await prisma.user.create({
      data: {
        email,
        password: 'fixture-hash',
        firstName: 'Test',
        lastName: 'Account',
        roles,
        onboardingCompleted: true,
        athlete: { create: {} },
      },
      select: { userId: true, athlete: { select: { athleteId: true } } },
    });
    if (!user.athlete) throw new Error('Test account athlete was not created');
    return { userId: user.userId, athleteId: user.athlete.athleteId };
  };

  const linksFor = (userId: number) =>
    prisma.coachAthlete.findMany({
      where: { userId },
      select: { athleteId: true },
    });

  const signupService = () => {
    const config = {
      get: (key: string) =>
        ({
          HASH_PEPPER: 'test-pepper-at-least-32-characters-long',
          APP_URL: 'http://localhost',
        })[key],
    } as unknown as ConfigService<ApiEnvSchemaType, true>;
    return new UserService(
      prisma,
      config,
      { emit: jest.fn() } as never,
      {} as never,
      athleteInvitations,
      coachInvitations,
      {} as never,
    );
  };

  const authUser = async (userId: number): Promise<AuthUser> => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { userId },
      select: {
        userId: true,
        email: true,
        roles: true,
        athlete: { select: { athleteId: true } },
        coachAthletes: { select: { athleteId: true } },
      },
    });
    return user;
  };

  const readableEvents = async (userId: number, eventIds: number[]) => {
    const ability = await abilities.getFor({ user: await authUser(userId) });
    return prisma.event.findMany({
      where: {
        AND: [
          accessibleBy(ability, 'read').Event,
          { eventId: { in: eventIds } },
        ],
      },
      select: { eventId: true, athleteId: true },
    });
  };

  const send = (path: string, actorId: number, body: unknown) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': String(actorId),
      },
      body: JSON.stringify(body),
    });

  const get = (path: string) => fetch(`${origin}${path}`);

  it('previews a SHARE link without exposing the selected roster', async () => {
    const secondAthlete = await account('private-athlete@example.com');
    await prisma.coachAthlete.create({
      data: { userId: COACH_USER_ID, athleteId: secondAthlete.athleteId },
    });
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'preview-recipient@example.com',
      'SHARE',
      [DELETED_ATHLETE_ID, secondAthlete.athleteId],
    );
    const response = await get(
      `/auth/invitation?token=${encodeURIComponent(invitation.token!)}`,
    );
    expect(response.status).toBe(200);
    const preview = (await response.json()) as Record<string, unknown>;
    expect(preview).toMatchObject({
      valid: true,
      kind: 'COACH',
      purpose: 'SHARE',
      email: 'preview-recipient@example.com',
    });
    expect(Object.keys(preview).sort()).toEqual(
      ['email', 'expiresAt', 'inviterName', 'kind', 'purpose', 'valid'].sort(),
    );
    expect(preview).not.toHaveProperty('token');
    expect(preview).not.toHaveProperty('athleteIds');
    expect(preview).not.toHaveProperty('athletes');
    expect(JSON.stringify(preview)).not.toContain(
      'private-athlete@example.com',
    );
    expect(JSON.stringify(preview)).not.toContain('Test Account');
  });

  it('rejects an authenticated invitation link without changing account roles or relationships', async () => {
    const link = await coachInvitations.createOpenInvitationLink(
      COACH_USER_ID,
      'COLLEAGUE',
      COACH_USER_ID,
    );
    const token = new URL(link.url).searchParams.get('token')!;
    const invitation = await prisma.coachInvitation.findUniqueOrThrow({
      where: { token },
      select: { coachInvitationId: true },
    });
    const recipient = await account('reject-link@example.com');
    const before = await prisma.user.findUniqueOrThrow({
      where: { userId: recipient.userId },
      select: { roles: true, athlete: { select: { athleteId: true } } },
    });

    const rejected = await send('/auth/invitations/reject', recipient.userId, {
      token,
    });
    expect(rejected.status).toBe(201);
    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: invitation.coachInvitationId },
        select: { status: true, coachUserId: true },
      }),
    ).resolves.toEqual({ status: 'REJECTED', coachUserId: recipient.userId });
    expect(await linksFor(recipient.userId)).toEqual([]);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { userId: recipient.userId },
        select: { roles: true, athlete: { select: { athleteId: true } } },
      }),
    ).resolves.toEqual(before);
    const replay = await send('/auth/invitations/reject', recipient.userId, {
      token,
    });
    expect(replay.status).toBe(400);
  });

  it('denies an ATHLETE at all invitation write endpoints and accepts a valid link over HTTP', async () => {
    const denied = await Promise.all([
      send('/athlete/invite/coach', DELETED_USER_ID, {
        email: 'coach-target@example.com',
      }),
      send('/athlete/invitations/links', DELETED_USER_ID, {
        kind: 'COACH',
        purpose: 'PERSONAL',
      }),
      send('/coach/roster-invitations', DELETED_USER_ID, {
        email: 'coach-target@example.com',
        operation: 'SHARE',
        athleteIds: [DELETED_ATHLETE_ID],
      }),
    ]);
    expect(denied.map((response) => response.status)).toEqual([403, 403, 403]);
    const invalidRoster = await send(
      '/coach/roster-invitations',
      COACH_USER_ID,
      {
        email: 'invalid-roster@example.com',
        operation: 'SHARE',
        athleteIds: [DELETED_ATHLETE_ID, DELETED_ATHLETE_ID],
      },
    );
    expect(invalidRoster.status).toBe(400);

    const issue = await send('/athlete/invitations/links', COACH_USER_ID, {
      kind: 'COACH',
      purpose: 'COLLEAGUE',
    });
    expect(issue.status).toBe(201);
    expect(emailEmitter.emit).not.toHaveBeenCalled();
    const { url } = (await issue.json()) as { url: string };
    const token = new URL(url).searchParams.get('token');
    expect(token).toBeTruthy();

    const recipient = await account('http-recipient@example.com');
    const accept = await send('/auth/invitations/accept', recipient.userId, {
      token,
    });
    expect(accept.status).toBe(201);
    expect(await linksFor(recipient.userId)).toEqual([]);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { userId: recipient.userId },
        select: { roles: true },
      }),
    ).resolves.toMatchObject({
      roles: expect.arrayContaining([UserRole.ATHLETE, UserRole.COACH]),
    });
  });

  it.each([
    ['PERSONAL', COACH_ATHLETE_ID],
    ['COLLEAGUE', null],
  ] as const)(
    'applies an open %s invitation only to its intended relationship',
    async (purpose, expectedAthleteId) => {
      const link = await coachInvitations.createOpenInvitationLink(
        COACH_USER_ID,
        purpose,
        COACH_USER_ID,
      );
      const token = new URL(link.url).searchParams.get('token');
      expect(token).toBeTruthy();
      expect(
        await prisma.coachInvitation.findUniqueOrThrow({
          where: { token: token! },
          select: { email: true },
        }),
      ).toEqual({ email: null });
      expect(
        await coachInvitations.createOpenInvitationLink(
          COACH_USER_ID,
          purpose,
          COACH_USER_ID,
        ),
      ).toEqual(link);

      const recipient = await account('new-coach@example.com');
      await coachInvitations.acceptToken(token!, recipient.userId);

      expect(
        (await linksFor(recipient.userId)).map((row) => row.athleteId),
      ).toEqual(expectedAthleteId === null ? [] : [expectedAthleteId]);
      await expect(
        prisma.user.findUniqueOrThrow({
          where: { userId: recipient.userId },
          select: { roles: true },
        }),
      ).resolves.toMatchObject({
        roles: expect.arrayContaining([UserRole.ATHLETE, UserRole.COACH]),
      });
      await expect(
        coachInvitations.acceptToken(token!, recipient.userId),
      ).rejects.toThrow();
    },
  );

  it('shares every selected athlete and preserves the sender links', async () => {
    const secondAthlete = await account('second-athlete@example.com');
    await prisma.coachAthlete.create({
      data: { userId: COACH_USER_ID, athleteId: secondAthlete.athleteId },
    });
    const recipient = await account('recipient@example.com');
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'recipient@example.com',
      'SHARE',
      [DELETED_ATHLETE_ID, secondAthlete.athleteId],
    );

    await coachInvitations.acceptInvitation(
      recipient.userId,
      invitation.coachInvitationId,
    );

    expect(
      (await linksFor(recipient.userId)).map((row) => row.athleteId).sort(),
    ).toEqual([DELETED_ATHLETE_ID, secondAthlete.athleteId].sort());
    expect((await linksFor(COACH_USER_ID)).map((row) => row.athleteId)).toEqual(
      expect.arrayContaining([DELETED_ATHLETE_ID, secondAthlete.athleteId]),
    );
  });

  it('transfers all selected athletes atomically and keeps the recipient dual-role', async () => {
    const secondAthlete = await account('transfer-athlete@example.com');
    await prisma.coachAthlete.create({
      data: { userId: COACH_USER_ID, athleteId: secondAthlete.athleteId },
    });
    const recipient = await account('transfer-recipient@example.com');
    const athleteIds = [DELETED_ATHLETE_ID, secondAthlete.athleteId];
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'transfer-recipient@example.com',
      'TRANSFER',
      athleteIds,
    );

    await coachInvitations.acceptInvitation(
      recipient.userId,
      invitation.coachInvitationId,
    );

    expect(
      (await linksFor(recipient.userId)).map((row) => row.athleteId).sort(),
    ).toEqual(athleteIds.sort());
    expect(
      (await linksFor(COACH_USER_ID)).map((row) => row.athleteId),
    ).not.toEqual(expect.arrayContaining(athleteIds));
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { userId: recipient.userId },
        select: { roles: true },
      }),
    ).resolves.toMatchObject({
      roles: expect.arrayContaining([UserRole.ATHLETE, UserRole.COACH]),
    });
  });

  it('allows one concurrent TRANSFER acceptance and leaves no partial or duplicate roster', async () => {
    const secondAthlete = await account(
      'concurrent-transfer-athlete@example.com',
    );
    await prisma.coachAthlete.create({
      data: { userId: COACH_USER_ID, athleteId: secondAthlete.athleteId },
    });
    const recipient = await account('concurrent-transfer@example.com');
    const athleteIds = [DELETED_ATHLETE_ID, secondAthlete.athleteId];
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'concurrent-transfer@example.com',
      'TRANSFER',
      athleteIds,
    );

    const results = await Promise.allSettled([
      coachInvitations.acceptInvitation(
        recipient.userId,
        invitation.coachInvitationId,
      ),
      coachInvitations.acceptInvitation(
        recipient.userId,
        invitation.coachInvitationId,
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      (await linksFor(recipient.userId)).map((row) => row.athleteId).sort(),
    ).toEqual([...athleteIds].sort());
    expect(
      await prisma.coachAthlete.count({
        where: { userId: recipient.userId, athleteId: { in: athleteIds } },
      }),
    ).toBe(athleteIds.length);
    expect(
      await prisma.coachAthlete.count({
        where: { userId: COACH_USER_ID, athleteId: { in: athleteIds } },
      }),
    ).toBe(0);
    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: invitation.coachInvitationId },
        select: { status: true, coachUserId: true },
      }),
    ).resolves.toEqual({ status: 'ACCEPTED', coachUserId: recipient.userId });
  });

  it('grants shared history through current CASL links, and removes that access after transfer', async () => {
    const unrelated = await account('unrelated-history@example.com');
    const unrelatedEvent = await prisma.event.create({
      data: {
        name: 'Unrelated plan',
        type: 'TRAINING',
        startDate: new Date('2026-01-08T00:00:00.000Z'),
        endDate: new Date('2026-01-08T01:00:00.000Z'),
        athleteId: unrelated.athleteId,
        training: { create: { sport: 'RUNNING' } },
      },
      select: { eventId: true },
    });
    const recipient = await account('history-recipient@example.com');
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'history-recipient@example.com',
      'TRANSFER',
      [DELETED_ATHLETE_ID],
    );
    await coachInvitations.acceptInvitation(
      recipient.userId,
      invitation.coachInvitationId,
    );

    await expect(
      readableEvents(recipient.userId, [3002, unrelatedEvent.eventId]),
    ).resolves.toEqual([{ eventId: 3002, athleteId: DELETED_ATHLETE_ID }]);
    await expect(readableEvents(COACH_USER_ID, [3002])).resolves.toEqual([]);
    await expect(
      prisma.event.findUniqueOrThrow({
        where: { eventId: 3002 },
        select: { eventId: true, athleteId: true },
      }),
    ).resolves.toEqual({ eventId: 3002, athleteId: DELETED_ATHLETE_ID });
  });

  it('rejects a roster claim from the wrong email without consuming the invitation', async () => {
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'bound-recipient@example.com',
      'SHARE',
      [DELETED_ATHLETE_ID],
    );
    const wrongRecipient = await account('wrong-recipient@example.com');

    await expect(
      coachInvitations.acceptInvitation(
        wrongRecipient.userId,
        invitation.coachInvitationId,
      ),
    ).rejects.toThrow('This invitation is not for you');
    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: invitation.coachInvitationId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PENDING' });
    expect(await linksFor(wrongRecipient.userId)).toEqual([]);
  });

  it('rechecks sender access before accepting a pending transfer', async () => {
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'later-recipient@example.com',
      'TRANSFER',
      [DELETED_ATHLETE_ID],
    );
    const recipient = await account('later-recipient@example.com');
    await prisma.coachAthlete.deleteMany({
      where: { userId: COACH_USER_ID, athleteId: DELETED_ATHLETE_ID },
    });

    await expect(
      coachInvitations.acceptInvitation(
        recipient.userId,
        invitation.coachInvitationId,
      ),
    ).rejects.toThrow('The sender no longer coaches this roster');
    expect(await linksFor(recipient.userId)).toEqual([]);
    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: invitation.coachInvitationId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PENDING' });
  });

  it('counts only new roster links against quota and preserves existing links', async () => {
    const secondAthlete = await account('quota-athlete@example.com');
    await prisma.coachAthlete.create({
      data: { userId: COACH_USER_ID, athleteId: secondAthlete.athleteId },
    });
    const recipient = await account('quota-recipient@example.com');
    await prisma.coachAthlete.create({
      data: { userId: recipient.userId, athleteId: DELETED_ATHLETE_ID },
    });
    maxAthletes = 2;
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'quota-recipient@example.com',
      'SHARE',
      [DELETED_ATHLETE_ID, secondAthlete.athleteId],
    );

    await coachInvitations.acceptInvitation(
      recipient.userId,
      invitation.coachInvitationId,
    );

    expect(
      await prisma.coachAthlete.count({
        where: {
          userId: recipient.userId,
          athleteId: { in: [DELETED_ATHLETE_ID, secondAthlete.athleteId] },
        },
      }),
    ).toBe(2);
  });

  it('leaves a roster untouched when the recipient quota rejects the claim', async () => {
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'over-limit@example.com',
      'TRANSFER',
      [DELETED_ATHLETE_ID],
    );
    const recipient = await account('over-limit@example.com');
    maxAthletes = 0;

    await expect(
      coachInvitations.acceptInvitation(
        recipient.userId,
        invitation.coachInvitationId,
      ),
    ).rejects.toThrow('maximum number of athletes');
    expect(await linksFor(recipient.userId)).toEqual([]);
    expect(
      (await linksFor(COACH_USER_ID)).map((row) => row.athleteId),
    ).toContain(DELETED_ATHLETE_ID);
    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: invitation.coachInvitationId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PENDING' });
  });

  it('does not let an account accept its own open link and lets the sender cancel a pending roster operation', async () => {
    const ownLink = await coachInvitations.createOpenInvitationLink(
      COACH_USER_ID,
      'COLLEAGUE',
      COACH_USER_ID,
    );
    const ownToken = new URL(ownLink.url).searchParams.get('token')!;
    await expect(
      coachInvitations.acceptToken(ownToken, COACH_USER_ID),
    ).rejects.toThrow('You cannot accept your own invitation');

    const pending = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'cancelled@example.com',
      'TRANSFER',
      [DELETED_ATHLETE_ID],
    );
    await coachInvitations.cancelInvitationByAthlete(
      COACH_USER_ID,
      pending.coachInvitationId,
    );
    await expect(
      prisma.coachInvitation.findUnique({
        where: { coachInvitationId: pending.coachInvitationId },
      }),
    ).resolves.toBeNull();
    expect(
      (await linksFor(COACH_USER_ID)).map((row) => row.athleteId),
    ).toContain(DELETED_ATHLETE_ID);
  });

  it('reserves a roster invitation during signup and applies it only on later acceptance', async () => {
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'new-roster-coach@example.com',
      'SHARE',
      [DELETED_ATHLETE_ID],
    );
    const signupConfig = {
      get: (key: string) =>
        ({
          HASH_PEPPER: 'test-pepper-at-least-32-characters-long',
          APP_URL: 'http://localhost',
        })[key],
    } as unknown as ConfigService<ApiEnvSchemaType, true>;
    const signup = new UserService(
      prisma,
      signupConfig,
      { emit: jest.fn() } as never,
      {} as never,
      athleteInvitations,
      coachInvitations,
      {} as never,
    );
    const recipient = await signup.createAccount({
      email: 'new-roster-coach@example.com',
      password: 'Long-Test-Password-123!',
      firstName: 'New',
      lastName: 'Coach',
      coachInvitationToken: invitation.token!,
      acceptInvitation: true,
    });

    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: invitation.coachInvitationId },
        select: { status: true, coachUserId: true, token: true },
      }),
    ).resolves.toEqual({
      status: 'PENDING',
      coachUserId: recipient.userId,
      token: null,
    });
    expect(await linksFor(recipient.userId)).toEqual([]);

    await coachInvitations.acceptInvitation(
      recipient.userId,
      invitation.coachInvitationId,
    );
    expect(
      (await linksFor(recipient.userId)).map((row) => row.athleteId),
    ).toEqual([DELETED_ATHLETE_ID]);
  });

  it('creates only one account when two different signups race for one open coach link', async () => {
    const link = await coachInvitations.createOpenInvitationLink(
      COACH_USER_ID,
      'COLLEAGUE',
      COACH_USER_ID,
    );
    const token = new URL(link.url).searchParams.get('token')!;
    const results = await Promise.allSettled(
      ['open-race-one@example.com', 'open-race-two@example.com'].map((email) =>
        signupService().createAccount({
          email,
          password: 'Long-Test-Password-123!',
          firstName: 'Open',
          lastName: 'Race',
          coachInvitationToken: token,
          acceptInvitation: true,
        }),
      ),
    );

    const admitted = results.filter(
      (result): result is PromiseFulfilledResult<{ userId: number }> =>
        result.status === 'fulfilled',
    );
    if (admitted.length !== 1) {
      throw new Error(
        results
          .map((result) =>
            result.status === 'rejected' ? String(result.reason) : 'fulfilled',
          )
          .join('; '),
      );
    }
    const surviving = await prisma.user.findMany({
      where: {
        email: {
          in: ['open-race-one@example.com', 'open-race-two@example.com'],
        },
      },
      select: { userId: true, roles: true },
    });
    expect(surviving).toHaveLength(1);
    expect(surviving[0].roles).toEqual(
      expect.arrayContaining([UserRole.ATHLETE, UserRole.COACH]),
    );
    expect(await linksFor(surviving[0].userId)).toEqual([]);
    expect(
      await prisma.coachInvitation.count({
        where: {
          token: null,
          status: 'ACCEPTED',
          coachUserId: surviving[0].userId,
        },
      }),
    ).toBe(1);
  });

  it('admits only one athlete signup when a coach has one remaining place', async () => {
    maxAthletes = 2;
    const signupEmails = [
      'quota-race-one@example.com',
      'quota-race-two@example.com',
    ];
    const invitations = await Promise.all(
      signupEmails.map((email) =>
        athleteInvitations.createInvitation(COACH_USER_ID, email),
      ),
    );
    const results = await Promise.allSettled(
      invitations.map((invitation, index) =>
        signupService().createAccount({
          email: signupEmails[index],
          password: 'Long-Test-Password-123!',
          firstName: 'Quota',
          lastName: 'Race',
          invitationToken: invitation.token!,
        }),
      ),
    );

    const admitted = results.filter(
      (result): result is PromiseFulfilledResult<{ userId: number }> =>
        result.status === 'fulfilled',
    );
    if (admitted.length !== 1) {
      throw new Error(
        results
          .map((result) =>
            result.status === 'rejected' ? String(result.reason) : 'fulfilled',
          )
          .join('; '),
      );
    }
    expect(
      await prisma.user.count({
        where: { email: { in: signupEmails } },
      }),
    ).toBe(1);
    expect(
      await prisma.coachAthlete.count({ where: { userId: COACH_USER_ID } }),
    ).toBe(2);
    expect(
      await prisma.athleteInvitation.count({ where: { status: 'ACCEPTED' } }),
    ).toBe(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(String(rejected?.reason)).toContain('maximum number of athletes');
  });

  it('rolls back a transfer if deleting the sender link fails after recipient inserts', async () => {
    const invitation = await coachInvitations.createRosterInvitation(
      COACH_USER_ID,
      'trigger-failure@example.com',
      'TRANSFER',
      [DELETED_ATHLETE_ID],
    );
    const recipient = await account('trigger-failure@example.com');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_roster_transfer_delete()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.user_id = ${COACH_USER_ID} AND OLD.athlete_id = ${DELETED_ATHLETE_ID} THEN
          RAISE EXCEPTION 'simulated transfer delete failure';
        END IF;
        RETURN OLD;
      END;
      $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_roster_transfer_delete
      BEFORE DELETE ON coach_athlete
      FOR EACH ROW EXECUTE FUNCTION test_fail_roster_transfer_delete()`);

    try {
      await expect(
        coachInvitations.acceptInvitation(
          recipient.userId,
          invitation.coachInvitationId,
        ),
      ).rejects.toThrow();
      expect(await linksFor(recipient.userId)).toEqual([]);
      expect(
        (await linksFor(COACH_USER_ID)).map((row) => row.athleteId),
      ).toContain(DELETED_ATHLETE_ID);
      await expect(
        prisma.coachInvitation.findUniqueOrThrow({
          where: { coachInvitationId: invitation.coachInvitationId },
          select: { status: true, coachUserId: true },
        }),
      ).resolves.toEqual({ status: 'PENDING', coachUserId: null });
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_fail_roster_transfer_delete ON coach_athlete',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS test_fail_roster_transfer_delete()',
      );
    }
  });

  it('allows only one concurrent claim of an open coach link', async () => {
    const link = await coachInvitations.createOpenInvitationLink(
      COACH_USER_ID,
      'COLLEAGUE',
      COACH_USER_ID,
    );
    const token = new URL(link.url).searchParams.get('token')!;
    const recipients = await Promise.all([
      account('race-one@example.com'),
      account('race-two@example.com'),
    ]);
    const results = await Promise.allSettled(
      recipients.map(({ userId }) =>
        coachInvitations.acceptToken(token, userId),
      ),
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.coachInvitation.count({
        where: {
          token: null,
          status: 'ACCEPTED',
          coachUserId: { in: recipients.map(({ userId }) => userId) },
        },
      }),
    ).toBe(1);
  });

  it('keeps legacy PERSONAL invitations bound and rejects expired links', async () => {
    const legacy = await prisma.coachInvitation.create({
      data: {
        email: 'legacy-recipient@example.com',
        athleteUserId: DELETED_USER_ID,
        token: 'legacy-personal-token',
      },
    });
    const wrongRecipient = await account('legacy-wrong@example.com');
    await expect(
      coachInvitations.acceptToken(
        'legacy-personal-token',
        wrongRecipient.userId,
      ),
    ).rejects.toThrow('This invitation is not for you');
    await expect(
      prisma.coachInvitation.findUniqueOrThrow({
        where: { coachInvitationId: legacy.coachInvitationId },
        select: { purpose: true, status: true },
      }),
    ).resolves.toEqual({ purpose: 'PERSONAL', status: 'PENDING' });

    const open = await coachInvitations.createOpenInvitationLink(
      COACH_USER_ID,
      'COLLEAGUE',
      COACH_USER_ID,
    );
    const token = new URL(open.url).searchParams.get('token')!;
    await prisma.coachInvitation.update({
      where: { token },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });
    const recipient = await account('expired-recipient@example.com');
    await expect(
      coachInvitations.acceptToken(token, recipient.userId),
    ).rejects.toThrow('Invalid or expired invitation token');
    expect(await linksFor(recipient.userId)).toEqual([]);
  });
});
