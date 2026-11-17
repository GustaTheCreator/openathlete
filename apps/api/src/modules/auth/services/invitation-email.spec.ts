import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { UserRole } from '@openathlete/database';
import { ApiEnvSchemaType, EmailId } from '@openathlete/shared';

import { SendEmailEvent } from 'src/events';
import { PrismaService } from 'src/modules/prisma/services/prisma.service';
import { FeatureAccessService } from 'src/modules/subscription';

import { AthleteInvitationService } from './athlete-invitation.service';
import { CoachInvitationService } from './coach-invitation.service';

// The inviter, then nobody with the invitee's email
const inviter = {
  userId: 1,
  email: 'inviter@example.com',
  firstName: 'Ana',
  lastName: 'Lopez',
  language: 'ES',
  roles: [UserRole.COACH],
  onboardingCompleted: true,
};

function setup(
  roles: UserRole[] = [UserRole.COACH],
  onboardingCompleted = true,
) {
  const emitter = { emit: jest.fn() };
  const invitations = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ invitationId: 9 }),
  };
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ ...inviter, roles, onboardingCompleted })
        .mockResolvedValueOnce(null),
    },
    athlete: { findUnique: jest.fn().mockResolvedValue({ athleteId: 1 }) },
    athleteInvitation: invitations,
    coachInvitation: invitations,
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'APP_URL' ? 'http://localhost' : undefined),
  } as unknown as ConfigService<ApiEnvSchemaType, true>;
  const args = [
    prisma,
    config,
    emitter as unknown as EventEmitter2,
    {} as FeatureAccessService,
    {
      assertCanIssueInvitations: jest.fn(async () => {
        if (!roles.includes(UserRole.COACH)) {
          throw new ForbiddenException('Only coaches can send invitations');
        }
        if (!onboardingCompleted) {
          throw new ForbiddenException('Complete onboarding before inviting');
        }
      }),
    } as never,
  ] as const;
  const email = () => {
    const [slug, event] = emitter.emit.mock.calls[0] as [
      string,
      SendEmailEvent<EmailId>,
    ];
    expect(slug).toBe(SendEmailEvent.SLUG);
    return event.payload;
  };
  return {
    athleteInvitations: new AthleteInvitationService(...args),
    coachInvitations: new CoachInvitationService(...args),
    email,
    emitter,
    invitations,
  };
}

describe("invitations to someone without an account use the inviter's language", () => {
  it('from a coach', async () => {
    const { athleteInvitations, email } = setup();
    await athleteInvitations.createInvitation(1, 'new@example.com');
    expect(email()).toMatchObject({
      type: 'athlete-invitation',
      to: 'new@example.com',
      language: 'ES',
    });
  });

  it('from an athlete', async () => {
    const { coachInvitations, email } = setup();
    await coachInvitations.createInvitation(1, 'new@example.com');
    expect(email()).toMatchObject({
      type: 'coach-invitation-new',
      to: 'new@example.com',
      language: 'ES',
    });
  });
});

describe('invitation creation requires the persisted COACH role', () => {
  it('rejects athlete-only users before creating or emailing invitations', async () => {
    const athleteSetup = setup([UserRole.ATHLETE]);

    await expect(
      athleteSetup.athleteInvitations.createInvitation(1, 'new@example.com'),
    ).rejects.toThrow('Only coaches can send invitations');

    const coachSetup = setup([UserRole.ATHLETE]);
    await expect(
      coachSetup.coachInvitations.createInvitation(1, 'new@example.com'),
    ).rejects.toThrow('Only coaches can send invitations');

    for (const { emitter, invitations } of [athleteSetup, coachSetup]) {
      expect(invitations.create).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
    }
  });

  it('rejects accounts with both roles until onboarding is complete', async () => {
    const athleteSetup = setup([UserRole.ATHLETE, UserRole.COACH], false);
    const coachSetup = setup([UserRole.ATHLETE, UserRole.COACH], false);

    await expect(
      athleteSetup.athleteInvitations.createInvitation(1, 'new@example.com'),
    ).rejects.toThrow('Complete onboarding before inviting');
    await expect(
      coachSetup.coachInvitations.createInvitation(1, 'new@example.com'),
    ).rejects.toThrow('Complete onboarding before inviting');

    for (const { emitter, invitations } of [athleteSetup, coachSetup]) {
      expect(invitations.create).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
    }
  });
});
