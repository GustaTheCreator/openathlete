import { ConflictException } from '@nestjs/common';

import { Prisma, UserRole } from '@openathlete/database';

import { PrismaService } from 'src/modules/prisma/services/prisma.service';

export async function bootstrapSuperAdmin(
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
        athlete: { select: { athleteId: true } },
      },
    });
    if (!user || email !== email.toLowerCase() || user.email !== email) {
      throw new ConflictException(
        'User ID and canonical email must match exactly',
      );
    }
    if (!user.athlete) {
      throw new ConflictException(
        'An existing athlete profile is required for role bootstrap',
      );
    }
    const roles = [
      ...new Set([
        ...user.roles,
        UserRole.ATHLETE,
        UserRole.COACH,
        UserRole.SUPER_ADMIN,
      ]),
    ];
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
