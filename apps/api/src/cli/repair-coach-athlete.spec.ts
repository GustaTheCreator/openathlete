import { UserRole } from '@openathlete/database';

import { PrismaService } from 'src/modules/prisma/services/prisma.service';

import {
  inspectAthleteCoaches,
  repairCoachAthleteRole,
} from './repair-coach-athlete';

describe('legacy coach role repair', () => {
  const fixture = () => {
    const user = {
      userId: 14,
      email: 'legacy@example.com',
      roles: [UserRole.COACH, UserRole.SUPER_ADMIN],
      sessionVersion: 3,
      athlete: { athleteId: 28, coachAthletes: [] },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(async ({ where }) =>
            where.userId === user.userId ? user : null,
          ),
        update: jest.fn().mockImplementation(async ({ data }) => {
          user.roles = data.roles;
          user.sessionVersion += data.sessionVersion.increment;
          return { userId: user.userId };
        }),
      },
    };
    Object.assign(prisma, {
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(prisma),
      ),
    });
    return { prisma: prisma as unknown as PrismaService, user };
  };

  it('previews exact coach-only repair without writing and rejects mismatches', async () => {
    const { prisma } = fixture();
    const result = await repairCoachAthleteRole(
      prisma,
      14,
      'legacy@example.com',
      false,
    );
    expect(result.proposedRoles).toEqual([
      UserRole.COACH,
      UserRole.SUPER_ADMIN,
      UserRole.ATHLETE,
    ]);
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(
      repairCoachAthleteRole(prisma, 14, 'other@example.com', false),
    ).rejects.toThrow();
    await expect(
      repairCoachAthleteRole(prisma, 14, 'Legacy@example.com', false),
    ).rejects.toThrow();
  });

  it('adds only ATHLETE, revokes sessions once and preserves the profile', async () => {
    const { prisma, user } = fixture();
    await repairCoachAthleteRole(prisma, 14, 'legacy@example.com', true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 14 },
        data: expect.objectContaining({
          roles: [UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.ATHLETE],
          sessionVersion: { increment: 1 },
          authSessions: { deleteMany: {} },
        }),
      }),
    );
    await repairCoachAthleteRole(prisma, 14, 'legacy@example.com', true);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(user.athlete.athleteId).toBe(28);
    expect(user.sessionVersion).toBe(4);
  });

  it('inspects personal-profile coaches without mutating relationships', async () => {
    const { prisma } = fixture();
    prisma.user.findUnique = jest.fn().mockResolvedValue({
      userId: 14,
      email: 'legacy@example.com',
      athlete: {
        athleteId: 28,
        coachAthletes: [
          {
            coachAthleteId: 6,
            user: {
              userId: 21,
              email: 'coach@example.com',
              firstName: 'Coach',
              lastName: 'One',
            },
          },
        ],
      },
    });
    const result = await inspectAthleteCoaches(
      prisma,
      14,
      'legacy@example.com',
    );
    expect(result.coaches).toEqual([
      {
        coachAthleteId: 6,
        userId: 21,
        email: 'coach@example.com',
        name: 'Coach One',
      },
    ]);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to repair a coach without an existing athlete profile', async () => {
    const { prisma, user } = fixture();
    user.athlete = null as never;
    await expect(
      repairCoachAthleteRole(prisma, 14, 'legacy@example.com', true),
    ).rejects.toThrow('existing athlete profile');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
