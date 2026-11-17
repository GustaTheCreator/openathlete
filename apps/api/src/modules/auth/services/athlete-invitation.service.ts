import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { BadRequestException as BadRequestException2 } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { InvitationStatus, Prisma, UserRole } from '@openathlete/database';
import { ApiEnvSchemaType, InvitationLinkDto } from '@openathlete/shared';

import { SendEmailEvent } from 'src/events';
import { AnalyticsService } from 'src/modules/analytics/analytics.service';
import {
  PrismaService,
  type PrismaTx,
} from 'src/modules/prisma/services/prisma.service';
import { FeatureAccessService } from 'src/modules/subscription';

import { InvitationPolicyService } from './invitation-policy.service';

/**
 * Invitations the athlete can still answer. One sent before the account
 * existed has no status: the link accepts it on sign-up, and an athlete who
 * signed up without the link (from the app stores, say) answers it in the
 * app like any other.
 */
const OPEN_STATUSES = [{ status: InvitationStatus.PENDING }, { status: null }];

const isOpen = (status: InvitationStatus | null) =>
  status === null || status === InvitationStatus.PENDING;

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AthleteInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private configService: ConfigService<ApiEnvSchemaType, true>,
    private eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => FeatureAccessService))
    private featureAccessService: FeatureAccessService,
    private readonly invitationPolicy: InvitationPolicyService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  private async reportLinked(coachUserId: number, athleteId: number) {
    await this.analytics?.capture(coachUserId, 'athlete_linked', {
      invited_by: 'coach',
    });
    await this.analytics?.captureForAthlete(athleteId, 'coach_linked', {
      invited_by: 'coach',
    });
  }

  async generateInvitationToken(): Promise<string> {
    return randomUUID();
  }

  async createInvitation(
    coachUserId: number,
    email: string,
    actorUserId = coachUserId,
  ) {
    await this.invitationPolicy.assertCanIssueInvitations(
      actorUserId,
      coachUserId,
    );
    const normalizedEmail = email.toLowerCase();

    const coachUser = await this.prisma.user.findUnique({
      where: { userId: coachUserId },
      select: {
        userId: true,
        email: true,
        firstName: true,
        lastName: true,
        language: true,
        roles: true,
        onboardingCompleted: true,
      },
    });

    if (!coachUser) {
      throw new NotFoundException('Coach not found');
    }

    if (!coachUser.onboardingCompleted) {
      throw new ForbiddenException('Complete onboarding before inviting');
    }

    if (
      !Array.isArray(coachUser.roles) ||
      !coachUser.roles.includes(UserRole.COACH)
    ) {
      throw new ForbiddenException('Only coaches can invite athletes');
    }

    if (coachUser.email.toLowerCase() === normalizedEmail) {
      throw new BadRequestException('You cannot invite yourself');
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      // Check if athlete is already linked to this coach
      const athlete = await this.prisma.athlete.findUnique({
        where: { userId: existingUser.userId },
      });

      if (athlete) {
        const existingLink = await this.prisma.coachAthlete.findFirst({
          where: {
            athleteId: athlete.athleteId,
            userId: coachUserId,
          },
        });

        if (existingLink) {
          throw new ConflictException('This athlete is already linked to you');
        }

        // Check if there's already a pending invitation for this email from this coach
        const existingInvitation =
          await this.prisma.athleteInvitation.findFirst({
            where: {
              email: normalizedEmail,
              userId: coachUserId,
              OR: OPEN_STATUSES,
            },
          });

        if (existingInvitation) {
          throw new ConflictException(
            'An invitation has already been sent to this email',
          );
        }

        // Create invitation with PENDING status (user exists, needs to accept)
        const invitation = await this.prisma.athleteInvitation.create({
          data: {
            email: normalizedEmail,
            userId: coachUserId,
            status: InvitationStatus.PENDING,
          },
        });

        const invitationUrl = `${this.configService.get('APP_URL')}/dashboard/settings?tab=invitations`;

        // Send invitation email (athlete exists, needs to accept)
        this.eventEmitter.emit(
          SendEmailEvent.SLUG,
          new SendEmailEvent({
            type: 'athlete-invitation-existing',
            to: normalizedEmail,
            params: {
              coachName: `${coachUser.firstName} ${coachUser.lastName}`,
              url: invitationUrl,
            },
          }),
        );

        await this.analytics?.capture(coachUserId, 'athlete_invited');

        return invitation;
      }
    }

    // User doesn't exist or is not an athlete, create invitation with token for account creation
    // Check if there's already a pending invitation for this email from this coach
    const existingInvitation = await this.prisma.athleteInvitation.findFirst({
      where: {
        email: normalizedEmail,
        userId: coachUserId,
      },
    });

    if (existingInvitation) {
      // Check if invitation is still valid (7 days)
      const now = new Date();
      const invitationDate = new Date(existingInvitation.createdAt);
      const diff = now.getTime() - invitationDate.getTime();
      const sevenDays = 60 * 60 * 24 * 7 * 1000;

      if (diff < sevenDays) {
        throw new ConflictException(
          'An invitation has already been sent to this email',
        );
      } else {
        // Delete expired invitation
        await this.prisma.athleteInvitation.delete({
          where: {
            athleteInvitationId: existingInvitation.athleteInvitationId,
          },
        });
      }
    }

    const token = await this.generateInvitationToken();

    const invitation = await this.prisma.athleteInvitation.create({
      data: {
        email: normalizedEmail,
        token,
        userId: coachUserId,
        // status is null = auto-accept on account creation
      },
    });

    const invitationUrl = `${this.configService.get('APP_URL')}/auth/create-account?invitation=${token}`;

    // Send invitation email (athlete doesn't exist, needs to create account)
    this.eventEmitter.emit(
      SendEmailEvent.SLUG,
      new SendEmailEvent({
        type: 'athlete-invitation',
        to: normalizedEmail,
        params: {
          coachName: `${coachUser.firstName} ${coachUser.lastName}`,
          url: invitationUrl,
        },
        // Used when the invitee has no account yet
        language: coachUser.language,
      }),
    );

    await this.analytics?.capture(coachUserId, 'athlete_invited');

    return invitation;
  }

  private async serializable<T>(operation: (tx: PrismaTx) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 5
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  }

  async createOpenInvitationLink(
    coachUserId: number,
    actorUserId = coachUserId,
  ): Promise<InvitationLinkDto> {
    await this.invitationPolicy.assertCanIssueInvitations(
      actorUserId,
      coachUserId,
    );
    const coach = await this.prisma.user.findUnique({
      where: { userId: coachUserId },
      select: { roles: true, onboardingCompleted: true },
    });
    if (!coach) throw new NotFoundException('Coach not found');
    if (!coach.onboardingCompleted || !coach.roles.includes(UserRole.COACH)) {
      throw new ForbiddenException(
        'Only onboarded coaches can invite athletes',
      );
    }
    const cutoff = new Date(Date.now() - INVITATION_TTL_MS);
    const invitation = await this.serializable(async (tx) => {
      const existing = await tx.athleteInvitation.findFirst({
        where: {
          userId: coachUserId,
          email: null,
          status: InvitationStatus.PENDING,
          token: { not: null },
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return existing;
      return tx.athleteInvitation.create({
        data: {
          userId: coachUserId,
          email: null,
          token: await this.generateInvitationToken(),
          status: InvitationStatus.PENDING,
        },
      });
    });
    const url = new URL(
      '/auth/invitation',
      this.configService.getOrThrow('APP_URL'),
    );
    url.searchParams.set('token', invitation.token!);
    return {
      url: url.toString(),
      expiresAt: new Date(
        invitation.createdAt.getTime() + INVITATION_TTL_MS,
      ).toISOString(),
    };
  }

  async bulkCreateInvitations(
    coachUserId: number,
    emails: string[],
    actorUserId = coachUserId,
  ) {
    await this.invitationPolicy.assertCanIssueInvitations(
      actorUserId,
      coachUserId,
    );
    const results = {
      successful: [] as string[],
      failed: [] as Array<{ email: string; error: string }>,
    };

    for (const email of emails) {
      try {
        await this.createInvitation(coachUserId, email, actorUserId);
        results.successful.push(email);
      } catch (error) {
        results.failed.push({
          email,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  async verifyInvitationToken(token: string) {
    const invitation = await this.prisma.athleteInvitation.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            userId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!invitation) {
      return null;
    }

    // A spent, rejected, or expired link can never claim an account.
    if (
      !isOpen(invitation.status) ||
      Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS
    ) {
      return null;
    }

    return invitation;
  }

  private async applyInvitation(
    tx: PrismaTx,
    invitationId: number,
    athleteUserId: number,
    expectedToken?: string,
  ) {
    const invitation = await tx.athleteInvitation.findUnique({
      where: { athleteInvitationId: invitationId },
    });
    if (!invitation || !isOpen(invitation.status)) {
      throw new BadRequestException('This invitation is no longer pending');
    }
    if (
      Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS ||
      (expectedToken !== undefined && invitation.token !== expectedToken) ||
      (expectedToken === undefined && invitation.email === null)
    ) {
      throw new BadRequestException('Invalid or expired invitation token');
    }

    const [recipient, coach] = await Promise.all([
      tx.user.findUnique({
        where: { userId: athleteUserId },
        select: {
          email: true,
          roles: true,
          athlete: { select: { athleteId: true } },
        },
      }),
      tx.user.findUnique({
        where: { userId: invitation.userId },
        select: { email: true, roles: true, onboardingCompleted: true },
      }),
    ]);
    if (!recipient?.athlete) throw new NotFoundException('Athlete not found');
    if (!coach) throw new NotFoundException('Coach not found');
    if (
      invitation.email !== null &&
      invitation.email.toLowerCase() !== recipient.email.toLowerCase()
    ) {
      throw new BadRequestException('This invitation is not for you');
    }
    if (coach.email.toLowerCase() === recipient.email.toLowerCase()) {
      throw new BadRequestException('You cannot accept your own invitation');
    }
    if (!coach.roles.includes(UserRole.COACH) || !coach.onboardingCompleted) {
      throw new ForbiddenException(
        'The invitation sender is no longer an onboarded coach',
      );
    }

    const existing = await tx.coachAthlete.findUnique({
      where: {
        userId_athleteId: {
          userId: invitation.userId,
          athleteId: recipient.athlete.athleteId,
        },
      },
    });
    if (!existing) {
      const maxAthletes = await this.featureAccessService.getMaxAthletes(
        invitation.userId,
      );
      if (maxAthletes !== null) {
        const currentCount = await tx.coachAthlete.count({
          where: { userId: invitation.userId },
        });
        if (currentCount + 1 > maxAthletes) {
          throw new BadRequestException2(
            'Coach has reached the maximum number of athletes for their subscription plan',
          );
        }
      }
    }

    const claimed = await tx.athleteInvitation.updateMany({
      where: {
        athleteInvitationId: invitationId,
        OR: OPEN_STATUSES,
        ...(expectedToken !== undefined && { token: expectedToken }),
      },
      data: { status: InvitationStatus.ACCEPTED, token: null },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This invitation is no longer pending');
    }
    if (!existing) {
      await tx.coachAthlete.create({
        data: {
          athleteId: recipient.athlete.athleteId,
          userId: invitation.userId,
        },
      });
    }
    if (!recipient.roles.includes(UserRole.ATHLETE)) {
      await tx.user.update({
        where: { userId: athleteUserId },
        data: { roles: [...recipient.roles, UserRole.ATHLETE] },
      });
    }
    return {
      coachUserId: invitation.userId,
      athleteId: recipient.athlete.athleteId,
    };
  }

  async consumeInvitation(token: string, athleteUserId: number, tx?: PrismaTx) {
    const apply = async (client: PrismaTx) => {
      const invitation = await client.athleteInvitation.findUnique({
        where: { token },
      });
      if (!invitation) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
      return this.applyInvitation(
        client,
        invitation.athleteInvitationId,
        athleteUserId,
        token,
      );
    };
    const linked = tx ? await apply(tx) : await this.serializable(apply);
    await this.reportLinked(linked.coachUserId, linked.athleteId);
  }

  async acceptToken(token: string, athleteUserId: number) {
    const invitation = await this.prisma.athleteInvitation.findUnique({
      where: { token },
      select: { athleteInvitationId: true },
    });
    if (!invitation) {
      throw new BadRequestException('Invalid or expired invitation token');
    }
    const linked = await this.serializable((tx) =>
      this.applyInvitation(
        tx,
        invitation.athleteInvitationId,
        athleteUserId,
        token,
      ),
    );
    await this.reportLinked(linked.coachUserId, linked.athleteId);
  }

  async acceptInvitation(athleteUserId: number, invitationId: number) {
    const linked = await this.serializable((tx) =>
      this.applyInvitation(tx, invitationId, athleteUserId),
    );
    await this.reportLinked(linked.coachUserId, linked.athleteId);
  }

  async rejectInvitation(athleteUserId: number, invitationId: number) {
    await this.serializable(async (tx) => {
      const [invitation, athlete] = await Promise.all([
        tx.athleteInvitation.findUnique({
          where: { athleteInvitationId: invitationId },
        }),
        tx.athlete.findUnique({
          where: { userId: athleteUserId },
          include: { user: { select: { email: true } } },
        }),
      ]);
      if (!invitation) throw new NotFoundException('Invitation not found');
      if (!athlete) throw new NotFoundException('Athlete not found');
      if (
        invitation.email === null ||
        invitation.email.toLowerCase() !== athlete.user.email.toLowerCase()
      ) {
        throw new BadRequestException('This invitation is not for you');
      }
      if (!isOpen(invitation.status)) {
        throw new BadRequestException('This invitation is no longer pending');
      }
      const updated = await tx.athleteInvitation.updateMany({
        where: { athleteInvitationId: invitationId, OR: OPEN_STATUSES },
        data: { status: InvitationStatus.REJECTED, token: null },
      });
      if (updated.count !== 1) {
        throw new BadRequestException('This invitation is no longer pending');
      }
    });
  }

  async rejectToken(token: string, athleteUserId: number) {
    await this.serializable(async (tx) => {
      const invitation = await tx.athleteInvitation.findUnique({
        where: { token },
      });
      const athlete = await tx.athlete.findUnique({
        where: { userId: athleteUserId },
        include: { user: { select: { email: true } } },
      });
      if (!invitation || !athlete) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
      if (
        !isOpen(invitation.status) ||
        Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS
      ) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
      if (
        invitation.email !== null &&
        invitation.email.toLowerCase() !== athlete.user.email.toLowerCase()
      ) {
        throw new BadRequestException('This invitation is not for you');
      }
      const updated = await tx.athleteInvitation.updateMany({
        where: { athleteInvitationId: invitation.athleteInvitationId, token },
        data: { status: InvitationStatus.REJECTED, token: null },
      });
      if (updated.count !== 1) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
    });
  }

  async getPendingInvitationsForAthlete(athleteUserId: number) {
    const athlete = await this.prisma.athlete.findUnique({
      where: { userId: athleteUserId },
      include: { user: true },
    });

    if (!athlete) {
      throw new NotFoundException('Athlete not found');
    }

    return await this.prisma.athleteInvitation.findMany({
      where: {
        email: athlete.user.email.toLowerCase(),
        OR: OPEN_STATUSES,
      },
      select: {
        athleteInvitationId: true,
        email: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            userId: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getSentInvitationsForCoach(coachUserId: number) {
    await this.invitationPolicy.assertCanIssueInvitations(coachUserId);
    return await this.prisma.athleteInvitation.findMany({
      where: {
        userId: coachUserId,
        OR: OPEN_STATUSES,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        athleteInvitationId: true,
        email: true,
        token: true,
        userId: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async cancelInvitation(coachUserId: number, invitationId: number) {
    const invitation = await this.prisma.athleteInvitation.findUnique({
      where: { athleteInvitationId: invitationId },
    });

    if (!invitation || invitation.userId !== coachUserId) {
      throw new NotFoundException('Invitation not found');
    }

    if (!isOpen(invitation.status)) {
      throw new BadRequestException(
        'This invitation can no longer be cancelled',
      );
    }

    await this.prisma.athleteInvitation.delete({
      where: { athleteInvitationId: invitationId },
    });
  }
}
