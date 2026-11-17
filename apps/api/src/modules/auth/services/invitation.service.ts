import { BadRequestException, Injectable } from '@nestjs/common';

import { InvitationLinkDto } from '@openathlete/shared';

import { AthleteInvitationService } from './athlete-invitation.service';
import { CoachInvitationService } from './coach-invitation.service';

@Injectable()
export class InvitationService {
  constructor(
    private readonly athleteInvitationService: AthleteInvitationService,
    private readonly coachInvitationService: CoachInvitationService,
  ) {}

  async lookup(token: string) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
      return null;
    }
    const athleteInvitation =
      await this.athleteInvitationService.verifyInvitationToken(token);
    if (athleteInvitation)
      return { kind: 'ATHLETE' as const, invitation: athleteInvitation };
    const coachInvitation =
      await this.coachInvitationService.verifyInvitationToken(token);
    return coachInvitation
      ? { kind: 'COACH' as const, invitation: coachInvitation }
      : null;
  }

  async preview(token: string) {
    const result = await this.lookup(token);
    if (!result) return { valid: false as const };
    const { invitation, kind } = result;
    const inviter =
      kind === 'ATHLETE' ? invitation.user : invitation.athleteUser;
    return {
      valid: true as const,
      kind,
      ...(kind === 'COACH' ? { purpose: invitation.purpose } : {}),
      email: invitation.email,
      inviterName: `${inviter.firstName} ${inviter.lastName}`.trim(),
      expiresAt: new Date(
        invitation.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  }

  async verifyInvitationToken(token: string) {
    const result = await this.lookup(token);
    return result?.invitation ?? null;
  }

  createLink(
    kind: 'ATHLETE' | 'COACH',
    ownerUserId: number,
    actorUserId: number,
    purpose?: 'PERSONAL' | 'COLLEAGUE',
  ): Promise<InvitationLinkDto> {
    return kind === 'ATHLETE'
      ? this.athleteInvitationService.createOpenInvitationLink(
          ownerUserId,
          actorUserId,
        )
      : this.coachInvitationService.createOpenInvitationLink(
          ownerUserId,
          purpose ?? 'PERSONAL',
          actorUserId,
        );
  }

  async accept(token: string, userId: number) {
    const result = await this.lookup(token);
    if (!result)
      throw new BadRequestException('Invalid or expired invitation token');
    if (result.kind === 'ATHLETE') {
      await this.athleteInvitationService.acceptToken(token, userId);
    } else {
      await this.coachInvitationService.acceptToken(token, userId);
    }
  }

  async reject(token: string, userId: number) {
    const result = await this.lookup(token);
    if (!result)
      throw new BadRequestException('Invalid or expired invitation token');
    if (result.kind === 'ATHLETE') {
      await this.athleteInvitationService.rejectToken(token, userId);
    } else {
      await this.coachInvitationService.rejectToken(token, userId);
    }
  }
}
