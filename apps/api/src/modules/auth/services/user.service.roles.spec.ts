import { ForbiddenException } from '@nestjs/common';

import { UserRole } from '@openathlete/database';
import { completeOnboardingDtoSchema } from '@openathlete/shared';

import { UserService } from './user.service';

describe('UserService role assignment', () => {
  it.each([
    [undefined, undefined, [UserRole.ATHLETE]],
    ['athlete-link', undefined, [UserRole.ATHLETE]],
    [undefined, 'coach-link', [UserRole.ATHLETE, UserRole.COACH]],
    ['athlete-link', 'coach-link', [UserRole.ATHLETE, UserRole.COACH]],
  ])(
    'assigns only the role grants from validated invitations (%s, %s)',
    async (invitationToken, coachInvitationToken, expectedRoles) => {
      const create = jest.fn().mockResolvedValue({ userId: 12 });
      const prisma: Record<string, unknown> = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      };
      prisma.$transaction = jest.fn((operation: (tx: unknown) => unknown) =>
        operation(prisma),
      );
      const athleteInvitations = {
        verifyInvitationToken: jest.fn((token: string) =>
          Promise.resolve(
            token === 'athlete-link' ? { email: 'runner@example.com' } : null,
          ),
        ),
        consumeInvitation: jest.fn(),
      };
      const coachInvitations = {
        verifyInvitationToken: jest.fn((token: string) =>
          Promise.resolve(
            token === 'coach-link' ? { email: 'runner@example.com' } : null,
          ),
        ),
        consumeInvitation: jest.fn(),
      };
      const service = new UserService(
        prisma as never,
        { get: () => 'open' } as never,
        { emit: jest.fn() } as never,
        {} as never,
        athleteInvitations as never,
        coachInvitations as never,
        {} as never,
      );

      await service.createAccount({
        email: 'runner@example.com',
        password: 'Secure-password-123',
        firstName: 'Runner',
        lastName: 'Test',
        invitationToken,
        coachInvitationToken,
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roles: expectedRoles }),
        }),
      );
    },
  );

  it('preserves assigned roles during onboarding and prevents self-granting a role', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ userId: 12, roles: [UserRole.ATHLETE] })
          .mockResolvedValue({
            userId: 12,
            roles: [UserRole.ATHLETE, UserRole.COACH, UserRole.SUPER_ADMIN],
          }),
        update,
      },
      athlete: { findUnique: jest.fn().mockResolvedValue({ athleteId: 4 }) },
    };
    const service = new UserService(
      prisma as never,
      { get: () => undefined } as never,
      { emit: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.completeOnboarding(
        { userId: 12 } as never,
        { roles: [UserRole.COACH] } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();

    await service.completeOnboarding(
      { userId: 12 } as never,
      { roles: [UserRole.ATHLETE] } as never,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roles: [UserRole.ATHLETE, UserRole.COACH, UserRole.SUPER_ADMIN],
        }),
      }),
    );
  });

  it('rejects SUPER_ADMIN in the public onboarding role schema', () => {
    expect(
      completeOnboardingDtoSchema.safeParse({ roles: [UserRole.SUPER_ADMIN] })
        .success,
    ).toBe(false);
  });

  it('notifies active sockets after password reset revokes every session', async () => {
    const update = jest.fn().mockResolvedValue({});
    const emit = jest.fn();
    const service = new UserService(
      { user: { update } } as never,
      { get: () => undefined } as never,
      { emit } as never,
      { consumeToken: jest.fn().mockResolvedValue({ userId: 23 }) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.passwordReset({
      token: 'one-time-token',
      password: 'New-Secure-Password-456',
    } as never);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 23 },
        data: expect.objectContaining({
          sessionVersion: { increment: 1 },
          authSessions: { deleteMany: {} },
        }),
      }),
    );
    expect(emit).toHaveBeenCalledWith('auth.user-sessions.revoked', {
      userId: 23,
    });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0],
    );
  });
});
