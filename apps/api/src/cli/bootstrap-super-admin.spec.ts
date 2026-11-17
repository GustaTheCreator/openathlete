import { UserRole } from '@openathlete/database';

import { PrismaService } from 'src/modules/prisma/services/prisma.service';

import { bootstrapSuperAdmin } from './bootstrap-super-admin';

describe('bootstrapSuperAdmin', () => {
  const makePrisma = (roles = [UserRole.ATHLETE]) => {
    const user = {
      userId: 9,
      email: 'person@example.com',
      roles,
      athlete: { athleteId: 12 },
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

  it('previews without writing and requires the exact canonical identity', async () => {
    const { prisma } = makePrisma();
    const result = await bootstrapSuperAdmin(
      prisma,
      9,
      'person@example.com',
      false,
    );
    expect(result).toMatchObject({
      beforeRoles: [UserRole.ATHLETE],
      proposedRoles: [UserRole.ATHLETE, UserRole.COACH, UserRole.SUPER_ADMIN],
      athleteId: 12,
      apply: false,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(
      bootstrapSuperAdmin(prisma, 8, 'person@example.com', false),
    ).rejects.toThrow();
    await expect(
      bootstrapSuperAdmin(prisma, 9, 'Person@example.com', false),
    ).rejects.toThrow();
  });

  it('applies once, retains the profile and does not reset sessions again', async () => {
    const { prisma, user } = makePrisma();
    await bootstrapSuperAdmin(prisma, 9, 'person@example.com', true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 9 },
        data: expect.objectContaining({
          roles: [UserRole.ATHLETE, UserRole.COACH, UserRole.SUPER_ADMIN],
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    await bootstrapSuperAdmin(prisma, 9, 'person@example.com', true);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(user.athlete.athleteId).toBe(12);
  });

  it('refuses to grant sports roles without an existing athlete profile', async () => {
    const { prisma, user } = makePrisma();
    user.athlete = null as never;
    await expect(
      bootstrapSuperAdmin(prisma, 9, 'person@example.com', true),
    ).rejects.toThrow('existing athlete profile');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
