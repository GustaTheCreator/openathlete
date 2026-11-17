import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRole } from '@openathlete/database';
import { canIssueInvitations } from '@openathlete/shared';

import { PrismaService } from 'src/modules/prisma/services/prisma.service';

@Injectable()
export class InvitationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanIssueInvitations(
    actorUserId: number,
    ownerUserId = actorUserId,
  ): Promise<void> {
    const [actor, owner] = await Promise.all([
      this.prisma.user.findUnique({
        where: { userId: actorUserId },
        select: { roles: true, onboardingCompleted: true },
      }),
      ownerUserId === actorUserId
        ? Promise.resolve(null)
        : this.prisma.user.findUnique({
            where: { userId: ownerUserId },
            select: { roles: true },
          }),
    ]);

    if (!actor) throw new NotFoundException('User not found');
    const isAdmin = actor.roles.includes(UserRole.SUPER_ADMIN);
    if (
      !canIssueInvitations(actor.roles) ||
      (!isAdmin && !actor.onboardingCompleted)
    ) {
      throw new ForbiddenException(
        'Only onboarded coaches can issue invitations',
      );
    }
    if (ownerUserId !== actorUserId && !isAdmin) {
      throw new ForbiddenException(
        'Only administrators can issue invitations for another user',
      );
    }
    if (ownerUserId !== actorUserId && !owner) {
      throw new NotFoundException('Invitation owner not found');
    }
  }
}
