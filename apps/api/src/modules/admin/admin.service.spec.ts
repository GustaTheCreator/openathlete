import { ConflictException, ForbiddenException } from '@nestjs/common';

import { UserRole } from '@openathlete/database';

import { PrismaService } from '../prisma/services/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const serviceFor = (prisma: object) =>
    new AdminService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
    );

  it('denies direct calls when the effective actor is not a super administrator', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ roles: [UserRole.ATHLETE] }),
      },
    };
    await expect(
      serviceFor(prisma).listCoachAthletes(4),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not remove the last super administrator', async () => {
    const tx = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ roles: [UserRole.SUPER_ADMIN] })
          .mockResolvedValueOnce({
            userId: 7,
            email: 'admin@example.com',
            firstName: 'Admin',
            lastName: '',
            roles: [UserRole.SUPER_ADMIN],
            onboardingCompleted: true,
            athlete: { athleteId: 17 },
          }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    await expect(
      serviceFor(prisma).updateRoles(7, 7, [UserRole.ATHLETE]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns only the explicit safe user projection', async () => {
    const actor = { roles: [UserRole.SUPER_ADMIN] };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(actor),
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 2,
            email: 'athlete@example.com',
            firstName: 'A',
            lastName: 'B',
            roles: [UserRole.ATHLETE],
            onboardingCompleted: false,
            athlete: { athleteId: 19 },
            password: 'secret',
            sessionVersion: 99,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const result = await serviceFor(prisma).listUsers(1);
    expect(result.users[0]).toEqual({
      userId: 2,
      email: 'athlete@example.com',
      firstName: 'A',
      lastName: 'B',
      roles: [UserRole.ATHLETE],
      onboardingCompleted: false,
      athleteId: 19,
    });
    expect(result.users[0]).not.toHaveProperty('password');
    expect(result.users[0]).not.toHaveProperty('sessionVersion');
  });
});
