import { ForbiddenException } from '@nestjs/common';

import { UserRole } from '@openathlete/database';

import { InvitationPolicyService } from './invitation-policy.service';

describe('InvitationPolicyService', () => {
  const serviceFor = (users: Record<number, unknown>) =>
    new InvitationPolicyService({
      user: {
        findUnique: jest.fn(({ where }: { where: { userId: number } }) =>
          Promise.resolve(users[where.userId] ?? null),
        ),
      },
    } as never);

  it.each([
    [[UserRole.ATHLETE], true, 1, 1],
    [[UserRole.COACH], false, 1, 1],
    [[UserRole.COACH], true, 1, 1],
    [[UserRole.ATHLETE, UserRole.COACH], true, 1, 1],
    [[UserRole.SUPER_ADMIN], false, 1, 1],
    [[UserRole.COACH], true, 1, 2],
    [[UserRole.SUPER_ADMIN], false, 1, 2],
  ])(
    'checks actor roles, onboarding, and delegated owner',
    async (
      roles: UserRole[],
      onboardingCompleted: boolean,
      actorId: number,
      ownerId: number,
    ) => {
      const users = {
        1: { roles, onboardingCompleted },
        2: { roles: [UserRole.COACH] },
      };
      const service = serviceFor(users);
      const allowed =
        roles.includes(UserRole.SUPER_ADMIN) ||
        (roles.includes(UserRole.COACH) &&
          onboardingCompleted &&
          actorId === ownerId);

      if (allowed) {
        await expect(
          service.assertCanIssueInvitations(actorId, ownerId),
        ).resolves.toBeUndefined();
      } else {
        await expect(
          service.assertCanIssueInvitations(actorId, ownerId),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    },
  );
});
