import { ConflictException } from '@nestjs/common';

import { Prisma, UserRole } from '@openathlete/database';

import { PrismaService } from 'src/modules/prisma/services/prisma.service';

export async function repairCoachAthleteRole(
  prisma: PrismaService,
  userId: number,
  email: string,
  apply: boolean,
) {
  const run = async (db: PrismaService | Prisma.TransactionClient) => {
    const user = await db.user.findUnique({
      where: { userId },
      select: {
        userId: true,
        email: true,
        roles: true,
        sessionVersion: true,
        athlete: { select: { athleteId: true } },
      },
    });
    if (!user || email !== email.toLowerCase() || user.email !== email) {
      throw new ConflictException(
        'User ID and canonical email must match exactly',
      );
    }
    if (!user.roles.includes(UserRole.COACH)) {
      throw new ConflictException(
        'Only an existing coach account can be repaired',
      );
    }
    if (!user.athlete) {
      throw new ConflictException(
        'An existing athlete profile is required for role repair',
      );
    }
    const roles = [...new Set([...user.roles, UserRole.ATHLETE])];
    const changed = roles.length !== user.roles.length;
    if (apply && changed) {
      await db.user.update({
        where: { userId },
        data: {
          roles,
          sessionVersion: { increment: 1 },
          authSessions: { deleteMany: {} },
        },
        select: { userId: true },
      });
    }
    return {
      userId: user.userId,
      email: user.email,
      beforeRoles: user.roles,
      proposedRoles: roles,
      athleteId: user.athlete?.athleteId ?? null,
      sessionVersion: user.sessionVersion,
      apply,
      changed: apply && changed,
      sideEffects: changed ? ['Apply will revoke existing sessions'] : [],
    };
  };
  return apply
    ? prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    : run(prisma);
}

/** Read-only preview of coaches attached to the user's own Athlete profile. */
export async function inspectAthleteCoaches(
  prisma: PrismaService,
  userId: number,
  email: string,
) {
  const user = await prisma.user.findUnique({
    where: { userId },
    select: {
      userId: true,
      email: true,
      athlete: {
        select: {
          athleteId: true,
          coachAthletes: {
            select: {
              coachAthleteId: true,
              user: {
                select: {
                  userId: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { coachAthleteId: 'asc' },
          },
        },
      },
    },
  });
  if (!user || email !== email.toLowerCase() || user.email !== email) {
    throw new ConflictException(
      'User ID and canonical email must match exactly',
    );
  }
  return {
    userId: user.userId,
    email: user.email,
    athleteId: user.athlete?.athleteId ?? null,
    coaches: (user.athlete?.coachAthletes ?? []).map((link) => ({
      coachAthleteId: link.coachAthleteId,
      userId: link.user.userId,
      email: link.user.email,
      name: `${link.user.firstName} ${link.user.lastName}`.trim(),
    })),
  };
}
