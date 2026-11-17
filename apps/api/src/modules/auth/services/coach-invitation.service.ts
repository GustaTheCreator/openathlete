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

import {
  CoachInvitationPurpose,
  InvitationStatus,
  Prisma,
  UserRole,
} from '@openathlete/database';
import {
  ApiEnvSchemaType,
  InvitationLinkDto,
  SubscriptionPlan,
  getMaxAthletes,
} from '@openathlete/shared';

import { SendEmailEvent } from 'src/events';
import { AnalyticsService } from 'src/modules/analytics/analytics.service';
import {
  PrismaService,
  type PrismaTx,
} from 'src/modules/prisma/services/prisma.service';
import { FeatureAccessService } from 'src/modules/subscription';

import { InvitationPolicyService } from './invitation-policy.service';

/**
 * Whether the invitation is for this coach. One sent before the coach had
 * an account has no coachUserId: it names them by email until they answer.
 */
const isFor = (
  invitation: { coachUserId: number | null; email: string | null },
  coach: { userId: number; email: string },
) =>
  invitation.coachUserId === coach.userId ||
  (invitation.coachUserId === null &&
    invitation.email !== null &&
    invitation.email.toLowerCase() === coach.email.toLowerCase());

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CoachInvitationService {
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
      invited_by: 'athlete',
    });
    await this.analytics?.captureForAthlete(athleteId, 'coach_linked', {
      invited_by: 'athlete',
    });
  }

  async generateInvitationToken(): Promise<string> {
    return randomUUID();
  }

  async createInvitation(
    athleteUserId: number,
    email: string,
    actorUserId = athleteUserId,
    options: {
      purpose?: 'PERSONAL' | 'COLLEAGUE';
    } = {},
  ) {
    await this.invitationPolicy.assertCanIssueInvitations(
      actorUserId,
      athleteUserId,
    );
    const purpose = options.purpose ?? CoachInvitationPurpose.PERSONAL;
    const normalizedEmail = email.toLowerCase();

    const athleteUser = await this.prisma.user.findUnique({
      where: { userId: athleteUserId },
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

    if (!athleteUser) {
      throw new NotFoundException('Athlete not found');
    }

    if (actorUserId === athleteUserId && !athleteUser.onboardingCompleted) {
      throw new ForbiddenException('Complete onboarding before inviting');
    }

    if (!Array.isArray(athleteUser.roles)) {
      throw new ForbiddenException('Invalid account roles');
    }

    const athlete = await this.prisma.athlete.findUnique({
      where: { userId: athleteUserId },
    });
    if (!athlete) throw new NotFoundException('Athlete not found');

    if (athleteUser.email.toLowerCase() === normalizedEmail) {
      throw new BadRequestException('You cannot invite yourself');
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      // Check if coach is already linked to this athlete
      const existingLink =
        purpose === CoachInvitationPurpose.PERSONAL
          ? await this.prisma.coachAthlete.findFirst({
              where: {
                athleteId: athlete.athleteId,
                userId: existingUser.userId,
              },
            })
          : null;

      if (existingLink) {
        throw new ConflictException('This coach is already linked to you');
      }

      // Check if there's already a pending invitation for this email from this athlete
      const existingInvitation = await this.prisma.coachInvitation.findFirst({
        where: {
          email: normalizedEmail,
          athleteUserId: athleteUserId,
          purpose,
          status: InvitationStatus.PENDING,
        },
      });

      if (existingInvitation) {
        throw new ConflictException(
          'An invitation has already been sent to this email',
        );
      }

      // Create invitation with PENDING status (user exists, needs to accept)
      const invitation = await this.prisma.coachInvitation.create({
        data: {
          email: normalizedEmail,
          athleteUserId: athleteUserId,
          coachUserId: existingUser.userId,
          purpose,
          status: InvitationStatus.PENDING,
        },
      });

      const invitationUrl = `${this.configService.get('APP_URL')}/dashboard/settings?tab=invitations`;

      // Send invitation email (coach exists, needs to accept)
      this.eventEmitter.emit(
        SendEmailEvent.SLUG,
        new SendEmailEvent({
          type: 'coach-invitation-existing',
          to: normalizedEmail,
          params: {
            athleteName: `${athleteUser.firstName} ${athleteUser.lastName}`,
            url: invitationUrl,
            purpose,
          },
        }),
      );

      await this.analytics?.capture(athleteUserId, 'coach_invited');

      return invitation;
    } else {
      // User doesn't exist, create invitation with token for account creation
      // Check if there's already a pending invitation for this email from this athlete
      const existingInvitation = await this.prisma.coachInvitation.findFirst({
        where: {
          email: normalizedEmail,
          athleteUserId: athleteUserId,
          purpose,
          status: InvitationStatus.PENDING,
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
          await this.prisma.coachInvitation.delete({
            where: {
              coachInvitationId: existingInvitation.coachInvitationId,
            },
          });
        }
      }

      const token = await this.generateInvitationToken();

      const invitation = await this.prisma.coachInvitation.create({
        data: {
          email: normalizedEmail,
          token,
          athleteUserId: athleteUserId,
          purpose,
          status: InvitationStatus.PENDING,
        },
      });

      const invitationUrl = `${this.configService.get('APP_URL')}/auth/create-account?coach-invitation=${token}`;

      // Send invitation email (coach doesn't exist, needs to create account)
      this.eventEmitter.emit(
        SendEmailEvent.SLUG,
        new SendEmailEvent({
          type: 'coach-invitation-new',
          to: normalizedEmail,
          params: {
            athleteName: `${athleteUser.firstName} ${athleteUser.lastName}`,
            url: invitationUrl,
            purpose,
          },
          // Used when the invitee has no account yet
          language: athleteUser.language,
        }),
      );

      await this.analytics?.capture(athleteUserId, 'coach_invited');

      return invitation;
    }
  }

  async verifyInvitationToken(token: string) {
    const invitation = await this.prisma.coachInvitation.findUnique({
      where: { token },
      include: {
        athleteUser: {
          select: {
            userId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // A link works once: an accepted or refused invitation is spent
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      return null;
    }

    // Check if invitation is still valid (7 days)
    if (Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS)
      return null;

    return invitation;
  }

  async createOpenInvitationLink(
    athleteUserId: number,
    purpose: CoachInvitationPurpose = CoachInvitationPurpose.PERSONAL,
    actorUserId = athleteUserId,
  ): Promise<InvitationLinkDto> {
    await this.invitationPolicy.assertCanIssueInvitations(
      actorUserId,
      athleteUserId,
    );
    const owner = await this.prisma.user.findUnique({
      where: { userId: athleteUserId },
      select: {
        roles: true,
        onboardingCompleted: true,
        athlete: { select: { athleteId: true } },
      },
    });
    if (!owner || !owner.athlete)
      throw new NotFoundException('Athlete not found');
    if (!owner.onboardingCompleted || !owner.roles.includes(UserRole.COACH)) {
      throw new ForbiddenException('Only onboarded coaches can invite');
    }
    const cutoff = new Date(Date.now() - INVITATION_TTL_MS);
    const invitation = await this.serializable(async (tx) => {
      const existing = await tx.coachInvitation.findFirst({
        where: {
          athleteUserId,
          email: null,
          purpose,
          status: InvitationStatus.PENDING,
          token: { not: null },
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return existing;
      return tx.coachInvitation.create({
        data: {
          athleteUserId,
          email: null,
          token: await this.generateInvitationToken(),
          purpose,
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

  async createRosterInvitation(
    athleteUserId: number,
    email: string,
    operation: 'SHARE' | 'TRANSFER',
    athleteIds: number[],
    actorUserId = athleteUserId,
  ) {
    await this.invitationPolicy.assertCanIssueInvitations(
      actorUserId,
      athleteUserId,
    );
    if (
      athleteIds.length === 0 ||
      athleteIds.length > 100 ||
      new Set(athleteIds).size !== athleteIds.length
    ) {
      throw new BadRequestException(
        'Select between 1 and 100 distinct athletes',
      );
    }
    const normalizedEmail = email.toLowerCase();
    const purpose =
      operation === 'SHARE'
        ? CoachInvitationPurpose.SHARE
        : CoachInvitationPurpose.TRANSFER;
    const result = await this.serializable(async (tx) => {
      const owner = await tx.user.findUnique({
        where: { userId: athleteUserId },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          language: true,
          roles: true,
          onboardingCompleted: true,
        },
      });
      if (!owner) throw new NotFoundException('User not found');
      if (!owner.roles.includes(UserRole.COACH) || !owner.onboardingCompleted) {
        throw new ForbiddenException(
          'Only onboarded coaches can share athletes',
        );
      }
      if (owner.email.toLowerCase() === normalizedEmail) {
        throw new BadRequestException('You cannot invite yourself');
      }
      const links = await tx.coachAthlete.findMany({
        where: { userId: athleteUserId, athleteId: { in: athleteIds } },
        select: { athleteId: true },
      });
      if (links.length !== athleteIds.length) {
        throw new ForbiddenException('You do not coach every selected athlete');
      }
      const duplicate = await tx.coachInvitation.findFirst({
        where: {
          athleteUserId,
          email: normalizedEmail,
          purpose,
          status: InvitationStatus.PENDING,
          createdAt: { gte: new Date(Date.now() - INVITATION_TTL_MS) },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'An invitation has already been sent to this email',
        );
      }
      const recipient = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { userId: true },
      });
      const invitation = await tx.coachInvitation.create({
        data: {
          email: normalizedEmail,
          token: recipient ? null : await this.generateInvitationToken(),
          athleteUserId,
          coachUserId: recipient?.userId,
          purpose,
          athleteIds,
          status: InvitationStatus.PENDING,
        },
      });
      return {
        invitation,
        athleteName: `${owner.firstName} ${owner.lastName}`.trim(),
      };
    });

    const { invitation, athleteName } = result;
    const url = invitation.token
      ? `${this.configService.getOrThrow('APP_URL')}/auth/create-account?coach-invitation=${invitation.token}`
      : `${this.configService.getOrThrow('APP_URL')}/dashboard/settings?tab=invitations`;
    this.eventEmitter.emit(
      SendEmailEvent.SLUG,
      new SendEmailEvent({
        type: invitation.token
          ? 'coach-invitation-new'
          : 'coach-invitation-existing',
        to: normalizedEmail,
        params: {
          athleteName,
          url,
          purpose,
          athleteCount: athleteIds.length,
        },
      }),
    );
    await this.analytics?.capture(athleteUserId, 'coach_invited');
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

  private async recipient(tx: PrismaTx, coachUserId: number) {
    const coach = await tx.user.findUnique({
      where: { userId: coachUserId },
      select: { userId: true, email: true },
    });
    if (!coach) throw new NotFoundException('User not found');
    return coach;
  }

  private async withAthleteNames<
    T extends { purpose: CoachInvitationPurpose; athleteIds: number[] },
  >(invitations: T[]) {
    const ids = [
      ...new Set(
        invitations
          .filter(
            ({ purpose }) =>
              purpose === CoachInvitationPurpose.SHARE ||
              purpose === CoachInvitationPurpose.TRANSFER,
          )
          .flatMap(({ athleteIds }) => athleteIds),
      ),
    ];
    const athletes = ids.length
      ? await this.prisma.athlete.findMany({
          where: { athleteId: { in: ids } },
          select: {
            athleteId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const byId = new Map(
      athletes.map((athlete) => [athlete.athleteId, athlete]),
    );
    return invitations.map((invitation) => ({
      ...invitation,
      athleteNames:
        invitation.purpose === CoachInvitationPurpose.SHARE ||
        invitation.purpose === CoachInvitationPurpose.TRANSFER
          ? invitation.athleteIds.flatMap((athleteId) => {
              const athlete = byId.get(athleteId);
              return athlete ? [{ athleteId, ...athlete.user }] : [];
            })
          : [],
    }));
  }

  private async applyInvitation(
    tx: PrismaTx,
    invitationId: number,
    coachUserId: number,
    expectedToken?: string,
    newAccount = false,
  ) {
    const invitation = await tx.coachInvitation.findUnique({
      where: { coachInvitationId: invitationId },
    });
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is no longer pending');
    }
    if (
      Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS ||
      (expectedToken !== undefined && invitation.token !== expectedToken) ||
      (expectedToken === undefined &&
        invitation.email === null &&
        invitation.coachUserId === null)
    ) {
      throw new BadRequestException('Invalid or expired invitation token');
    }

    const [recipient, sender] = await Promise.all([
      tx.user.findUnique({
        where: { userId: coachUserId },
        select: {
          email: true,
          roles: true,
          athlete: { select: { athleteId: true } },
        },
      }),
      tx.user.findUnique({
        where: { userId: invitation.athleteUserId },
        select: {
          email: true,
          roles: true,
          onboardingCompleted: true,
          athlete: { select: { athleteId: true } },
        },
      }),
    ]);
    if (!recipient) throw new NotFoundException('User not found');
    if (!recipient.athlete) {
      throw new NotFoundException('Athlete profile not found');
    }
    if (!sender) throw new NotFoundException('Invitation sender not found');
    if (invitation.coachUserId && invitation.coachUserId !== coachUserId) {
      throw new BadRequestException('This invitation is not for you');
    }
    if (
      invitation.email !== null &&
      invitation.email.toLowerCase() !== recipient.email.toLowerCase()
    ) {
      throw new BadRequestException('This invitation is not for you');
    }
    if (recipient.email.toLowerCase() === sender.email.toLowerCase()) {
      throw new BadRequestException('You cannot accept your own invitation');
    }
    let athleteIds: number[] = [];
    if (invitation.purpose === CoachInvitationPurpose.PERSONAL) {
      if (!sender.athlete) throw new NotFoundException('Athlete not found');
      athleteIds = [sender.athlete.athleteId];
    } else if (
      invitation.purpose === CoachInvitationPurpose.SHARE ||
      invitation.purpose === CoachInvitationPurpose.TRANSFER
    ) {
      if (
        !sender.roles.includes(UserRole.COACH) ||
        !sender.onboardingCompleted
      ) {
        throw new ForbiddenException(
          'The invitation sender is no longer an onboarded coach',
        );
      }
      athleteIds = invitation.athleteIds;
      const senderLinks = await tx.coachAthlete.findMany({
        where: {
          userId: invitation.athleteUserId,
          athleteId: { in: athleteIds },
        },
        select: { athleteId: true },
      });
      if (senderLinks.length !== athleteIds.length) {
        throw new ConflictException('The sender no longer coaches this roster');
      }
    }

    const currentLinks = athleteIds.length
      ? await tx.coachAthlete.findMany({
          where: { userId: coachUserId, athleteId: { in: athleteIds } },
          select: { athleteId: true },
        })
      : [];
    const currentIds = new Set(currentLinks.map((link) => link.athleteId));
    const newAthleteIds = athleteIds.filter((id) => !currentIds.has(id));

    if (newAthleteIds.length) {
      let maxAthletes: number | null;
      try {
        maxAthletes =
          await this.featureAccessService.getMaxAthletes(coachUserId);
      } catch (error) {
        if (!(newAccount && error instanceof NotFoundException)) throw error;
        maxAthletes = getMaxAthletes(SubscriptionPlan.FREE);
      }
      if (maxAthletes !== null) {
        const currentCount = await tx.coachAthlete.count({
          where: { userId: coachUserId },
        });
        if (currentCount + newAthleteIds.length > maxAthletes) {
          throw new BadRequestException2(
            'You have reached the maximum number of athletes for your subscription plan',
          );
        }
      }
    }

    const claimed = await tx.coachInvitation.updateMany({
      where: {
        coachInvitationId: invitationId,
        status: InvitationStatus.PENDING,
        ...(expectedToken !== undefined && { token: expectedToken }),
      },
      data: {
        status: InvitationStatus.ACCEPTED,
        coachUserId,
        token: null,
      },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This invitation is no longer pending');
    }
    if (newAthleteIds.length) {
      await tx.coachAthlete.createMany({
        data: newAthleteIds.map((athleteId) => ({
          athleteId,
          userId: coachUserId,
        })),
      });
    }
    if (invitation.purpose === CoachInvitationPurpose.TRANSFER) {
      await tx.coachAthlete.deleteMany({
        where: {
          userId: invitation.athleteUserId,
          athleteId: { in: athleteIds },
        },
      });
    }
    const currentRoles = await tx.user.findUniqueOrThrow({
      where: { userId: coachUserId },
      select: { roles: true },
    });
    const roles = Array.from(
      new Set([...currentRoles.roles, UserRole.ATHLETE, UserRole.COACH]),
    );
    if (roles.length !== currentRoles.roles.length) {
      await tx.user.update({ where: { userId: coachUserId }, data: { roles } });
    }
    return newAthleteIds;
  }

  async consumeInvitation(token: string, coachUserId: number, tx?: PrismaTx) {
    const apply = async (client: PrismaTx) => {
      const invitation = await client.coachInvitation.findUnique({
        where: { token },
      });
      if (
        !invitation ||
        invitation.status !== InvitationStatus.PENDING ||
        Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS
      ) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
      if (
        tx &&
        (invitation.purpose === CoachInvitationPurpose.SHARE ||
          invitation.purpose === CoachInvitationPurpose.TRANSFER)
      ) {
        const recipient = await client.user.findUnique({
          where: { userId: coachUserId },
          select: { email: true },
        });
        if (
          !recipient ||
          (invitation.email !== null &&
            invitation.email.toLowerCase() !== recipient.email.toLowerCase())
        ) {
          throw new BadRequestException('This invitation is not for you');
        }
        const reserved = await client.coachInvitation.updateMany({
          where: {
            coachInvitationId: invitation.coachInvitationId,
            token,
            status: InvitationStatus.PENDING,
          },
          data: { coachUserId, token: null },
        });
        if (reserved.count !== 1) {
          throw new BadRequestException('This invitation is no longer pending');
        }
        return [];
      }
      return this.applyInvitation(
        client,
        invitation.coachInvitationId,
        coachUserId,
        token,
        Boolean(tx),
      );
    };
    const linked = tx ? await apply(tx) : await this.serializable(apply);
    for (const athleteId of linked) {
      await this.reportLinked(coachUserId, athleteId);
    }
  }

  async acceptToken(token: string, coachUserId: number) {
    const linked = await this.serializable(async (tx) => {
      const invitation = await tx.coachInvitation.findUnique({
        where: { token },
      });
      if (!invitation) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
      return this.applyInvitation(
        tx,
        invitation.coachInvitationId,
        coachUserId,
        token,
      );
    });
    for (const athleteId of linked) {
      await this.reportLinked(coachUserId, athleteId);
    }
  }

  async acceptInvitation(coachUserId: number, invitationId: number) {
    const linked = await this.serializable((tx) =>
      this.applyInvitation(tx, invitationId, coachUserId),
    );
    for (const athleteId of linked) {
      await this.reportLinked(coachUserId, athleteId);
    }
  }

  async rejectInvitation(coachUserId: number, invitationId: number) {
    await this.serializable(async (tx) => {
      const invitation = await tx.coachInvitation.findUnique({
        where: { coachInvitationId: invitationId },
      });
      if (!invitation) throw new NotFoundException('Invitation not found');
      const coach = await this.recipient(tx, coachUserId);
      if (!isFor(invitation, coach)) {
        throw new BadRequestException('This invitation is not for you');
      }
      if (invitation.status !== InvitationStatus.PENDING) {
        throw new BadRequestException('This invitation is no longer pending');
      }
      await tx.coachInvitation.updateMany({
        where: {
          coachInvitationId: invitationId,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.REJECTED, coachUserId, token: null },
      });
    });
  }

  async rejectToken(token: string, coachUserId: number) {
    await this.serializable(async (tx) => {
      const invitation = await tx.coachInvitation.findUnique({
        where: { token },
      });
      if (
        !invitation ||
        invitation.status !== InvitationStatus.PENDING ||
        Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS
      ) {
        throw new BadRequestException('Invalid or expired invitation token');
      }
      const coach = await this.recipient(tx, coachUserId);
      if (
        (invitation.coachUserId !== null &&
          invitation.coachUserId !== coachUserId) ||
        (invitation.email !== null &&
          invitation.email.toLowerCase() !== coach.email.toLowerCase())
      ) {
        throw new BadRequestException('This invitation is not for you');
      }
      await tx.coachInvitation.updateMany({
        where: { coachInvitationId: invitation.coachInvitationId, token },
        data: { status: InvitationStatus.REJECTED, coachUserId, token: null },
      });
    });
  }

  async getPendingInvitationsForCoach(coachUserId: number) {
    const coach = await this.recipient(this.prisma, coachUserId);
    const invitations = await this.prisma.coachInvitation.findMany({
      where: {
        status: InvitationStatus.PENDING,
        OR: [
          { coachUserId },
          { coachUserId: null, email: coach.email.toLowerCase() },
        ],
      },
      select: {
        coachInvitationId: true,
        email: true,
        status: true,
        purpose: true,
        athleteIds: true,
        createdAt: true,
        athleteUser: {
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
    return this.withAthleteNames(invitations);
  }

  async getSentInvitationsForAthlete(athleteUserId: number) {
    await this.invitationPolicy.assertCanIssueInvitations(athleteUserId);
    const invitations = await this.prisma.coachInvitation.findMany({
      where: {
        athleteUserId: athleteUserId,
        status: InvitationStatus.PENDING,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        coachInvitationId: true,
        email: true,
        token: true,
        purpose: true,
        athleteIds: true,
        athleteUserId: true,
        coachUserId: true,
        status: true,
        createdAt: true,
      },
    });
    return this.withAthleteNames(invitations);
  }

  async cancelInvitationByAthlete(athleteUserId: number, invitationId: number) {
    const invitation = await this.prisma.coachInvitation.findUnique({
      where: { coachInvitationId: invitationId },
    });

    if (!invitation || invitation.athleteUserId !== athleteUserId) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        'This invitation can no longer be cancelled',
      );
    }

    await this.prisma.coachInvitation.delete({
      where: { coachInvitationId: invitationId },
    });
  }
}
