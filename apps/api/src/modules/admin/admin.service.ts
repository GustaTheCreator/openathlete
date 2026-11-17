import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  CoachInvitationPurpose,
  Prisma,
  UserRole,
} from '@openathlete/database';
import {
  AdminCreateCoachAthleteDto,
  AdminCreateInvitationDto,
  AdminInvitationDto,
  AdminUserDto,
} from '@openathlete/shared';

import { AthleteInvitationService } from '../auth/services/athlete-invitation.service';
import { CoachInvitationService } from '../auth/services/coach-invitation.service';
import { PrismaService } from '../prisma/services/prisma.service';
import { FeatureAccessService } from '../subscription';

const userSelect = {
  userId: true,
  email: true,
  firstName: true,
  lastName: true,
  roles: true,
  onboardingCompleted: true,
  athlete: { select: { athleteId: true } },
} satisfies Prisma.UserSelect;

const actorSelect = { roles: true } satisfies Prisma.UserSelect;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly athleteInvitations: AthleteInvitationService,
    private readonly coachInvitations: CoachInvitationService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  private async assertAdmin(
    actorUserId: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const actor = await db.user.findUnique({
      where: { userId: actorUserId },
      select: actorSelect,
    });
    if (!actor?.roles.includes(UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Super administrator access required');
    }
  }

  private toUser(
    user: Prisma.UserGetPayload<{ select: typeof userSelect }>,
  ): AdminUserDto {
    return {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      onboardingCompleted: user.onboardingCompleted,
      athleteId: user.athlete?.athleteId ?? null,
    };
  }

  async listUsers(actorUserId: number, search = '', limit = 50, offset = 0) {
    await this.assertAdmin(actorUserId);
    const where: Prisma.UserWhereInput = search
      ? {
          OR: ['email', 'firstName', 'lastName'].map((field) => ({
            [field]: { contains: search, mode: 'insensitive' },
          })),
        }
      : {};
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { userId: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users: users.map((user) => this.toUser(user)), total };
  }

  async updateRoles(actorUserId: number, userId: number, roles: UserRole[]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.assertAdmin(actorUserId, tx);
            const target = await tx.user.findUnique({
              where: { userId },
              select: userSelect,
            });
            if (!target) throw new NotFoundException('User not found');
            const nextRoles = [
              ...new Set(
                roles.includes(UserRole.COACH)
                  ? [...roles, UserRole.ATHLETE]
                  : roles,
              ),
            ];
            if (
              (nextRoles.includes(UserRole.ATHLETE) ||
                nextRoles.includes(UserRole.COACH)) &&
              !target.athlete
            ) {
              throw new ConflictException(
                'An existing athlete profile is required for sports roles',
              );
            }
            const changed =
              target.roles.length !== nextRoles.length ||
              target.roles.some((role) => !nextRoles.includes(role));
            if (!changed) return this.toUser(target);

            if (
              target.roles.includes(UserRole.SUPER_ADMIN) &&
              !nextRoles.includes(UserRole.SUPER_ADMIN)
            ) {
              const admins = await tx.user.count({
                where: { roles: { has: UserRole.SUPER_ADMIN } },
              });
              if (admins <= 1)
                throw new ConflictException(
                  'The last super administrator cannot be removed',
                );
            }
            if (
              target.roles.includes(UserRole.COACH) &&
              !nextRoles.includes(UserRole.COACH)
            ) {
              const [links, openInvitations, pendingRosterInvitations] =
                await Promise.all([
                  tx.coachAthlete.count({ where: { userId } }),
                  tx.athleteInvitation.count({
                    where: {
                      userId,
                      OR: [{ status: null }, { status: 'PENDING' }],
                    },
                  }),
                  tx.coachInvitation.count({
                    where: {
                      athleteUserId: userId,
                      status: 'PENDING',
                      purpose: {
                        in: [
                          CoachInvitationPurpose.SHARE,
                          CoachInvitationPurpose.TRANSFER,
                        ],
                      },
                    },
                  }),
                ]);
              if (links || openInvitations || pendingRosterInvitations)
                throw new ConflictException(
                  'Remove active coach links and invitations first',
                );
            }
            const updated = await tx.user.update({
              where: { userId },
              data: {
                roles: nextRoles,
                sessionVersion: { increment: 1 },
                authSessions: { deleteMany: {} },
              },
              select: userSelect,
            });
            return this.toUser(updated);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
    throw new ConflictException('Concurrent role change; retry the request');
  }

  private async associationRows() {
    const rows = await this.prisma.coachAthlete.findMany({
      select: {
        coachAthleteId: true,
        userId: true,
        user: { select: { email: true, firstName: true, lastName: true } },
        athleteId: true,
        athlete: {
          select: {
            userId: true,
            user: { select: { email: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { coachAthleteId: 'asc' },
    });
    return rows.map((row) => ({
      coachAthleteId: row.coachAthleteId,
      coachUserId: row.userId,
      coachEmail: row.user.email,
      coachName: `${row.user.firstName} ${row.user.lastName}`.trim(),
      athleteId: row.athleteId,
      athleteUserId: row.athlete.userId,
      athleteEmail: row.athlete.user.email,
      athleteName:
        `${row.athlete.user.firstName} ${row.athlete.user.lastName}`.trim(),
    }));
  }

  async listCoachAthletes(actorUserId: number) {
    await this.assertAdmin(actorUserId);
    const associations = await this.associationRows();
    return { associations, total: associations.length };
  }

  async createCoachAthlete(
    actorUserId: number,
    input: AdminCreateCoachAthleteDto,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await this.assertAdmin(actorUserId, tx);
            const coach = await tx.user.findUnique({
              where: { userId: input.coachUserId },
              select: { roles: true },
            });
            if (!coach) throw new NotFoundException('Coach not found');
            if (!coach.roles.includes(UserRole.COACH))
              throw new ConflictException('Selected user is not a coach');
            const athlete = await tx.athlete.findUnique({
              where: { athleteId: input.athleteId },
              select: { athleteId: true, userId: true },
            });
            if (!athlete)
              throw new NotFoundException('Athlete profile not found');
            if (athlete.userId === input.coachUserId)
              throw new ConflictException(
                'A user cannot coach their own athlete profile',
              );
            const existing = await tx.coachAthlete.findFirst({
              where: { userId: input.coachUserId, athleteId: input.athleteId },
            });
            if (existing)
              throw new ConflictException('Association already exists');

            const [maxAthletes, currentCount] = await Promise.all([
              this.featureAccess.getMaxAthletes(input.coachUserId),
              tx.coachAthlete.count({ where: { userId: input.coachUserId } }),
            ]);
            if (maxAthletes !== null && currentCount >= maxAthletes)
              throw new ConflictException('Coach athlete limit reached');
            await tx.coachAthlete.create({
              data: { userId: input.coachUserId, athleteId: input.athleteId },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002')
        )
          throw new ConflictException(
            'Concurrent association change; retry the request',
          );
        throw error;
      }
    }
    return this.listCoachAthletes(actorUserId);
  }

  async deleteCoachAthlete(actorUserId: number, coachAthleteId: number) {
    const { count } = await this.prisma.$transaction(async (tx) => {
      await this.assertAdmin(actorUserId, tx);
      return tx.coachAthlete.deleteMany({ where: { coachAthleteId } });
    });
    if (!count) throw new NotFoundException('Association not found');
    return this.listCoachAthletes(actorUserId);
  }

  private async invitationRows(): Promise<AdminInvitationDto[]> {
    const [athletes, coaches] = await Promise.all([
      this.prisma.athleteInvitation.findMany({
        select: {
          athleteInvitationId: true,
          email: true,
          status: true,
          userId: true,
          user: { select: { email: true } },
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.coachInvitation.findMany({
        select: {
          coachInvitationId: true,
          email: true,
          status: true,
          purpose: true,
          athleteIds: true,
          athleteUserId: true,
          athleteUser: { select: { email: true } },
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return [
      ...athletes.map((row) => ({
        kind: 'ATHLETE' as const,
        invitationId: row.athleteInvitationId,
        email: row.email,
        status: row.status,
        purpose: null,
        athleteIds: [],
        ownerUserId: row.userId,
        ownerEmail: row.user.email,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      ...coaches.map((row) => ({
        kind: 'COACH' as const,
        invitationId: row.coachInvitationId,
        email: row.email,
        status: row.status,
        purpose: row.purpose,
        athleteIds: row.athleteIds,
        ownerUserId: row.athleteUserId,
        ownerEmail: row.athleteUser.email,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listInvitations(actorUserId: number) {
    await this.assertAdmin(actorUserId);
    const invitations = await this.invitationRows();
    return { invitations, total: invitations.length };
  }

  async createInvitation(actorUserId: number, input: AdminCreateInvitationDto) {
    await this.assertAdmin(actorUserId);
    if (input.kind === 'ATHLETE')
      await this.athleteInvitations.createInvitation(
        input.ownerUserId,
        input.email,
        actorUserId,
      );
    else
      await this.coachInvitations.createInvitation(
        input.ownerUserId,
        input.email,
        actorUserId,
        { purpose: input.purpose },
      );
    return this.listInvitations(actorUserId);
  }

  async cancelInvitation(
    actorUserId: number,
    kind: 'ATHLETE' | 'COACH',
    invitationId: number,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertAdmin(actorUserId, tx);
      return kind === 'ATHLETE'
        ? tx.athleteInvitation.deleteMany({
            where: {
              athleteInvitationId: invitationId,
              OR: [{ status: null }, { status: 'PENDING' }],
            },
          })
        : tx.coachInvitation.deleteMany({
            where: { coachInvitationId: invitationId, status: 'PENDING' },
          });
    });
    if (!result.count)
      throw new NotFoundException('Actionable invitation not found');
    return this.listInvitations(actorUserId);
  }
}
