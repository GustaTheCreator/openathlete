import { describe, expect, it } from 'vitest';

import {
  CoachInvitationPurpose,
  InvitationStatus,
  UserRole,
} from '@openathlete/database';

import {
  adminCreateInvitationDtoSchema,
  adminInvitationDtoSchema,
  adminUpdateUserRolesDtoSchema,
  adminUserDtoSchema,
} from './admin.dto';

describe('admin DTO schemas', () => {
  it('accepts supported role and safe invitation metadata literals', () => {
    expect(
      adminUserDtoSchema.safeParse({
        userId: 1,
        email: 'athlete@example.test',
        firstName: 'Athlete',
        lastName: 'One',
        roles: [UserRole.ATHLETE, UserRole.COACH],
        onboardingCompleted: true,
        athleteId: 5,
      }).success,
    ).toBe(true);
    expect(
      adminInvitationDtoSchema.safeParse({
        kind: 'COACH',
        invitationId: 3,
        email: null,
        status: InvitationStatus.PENDING,
        purpose: CoachInvitationPurpose.TRANSFER,
        athleteIds: [5],
        ownerUserId: 2,
        ownerEmail: 'owner@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).success,
    ).toBe(true);
  });

  it('rejects unsupported roles and administrative roster purposes', () => {
    expect(
      adminUpdateUserRolesDtoSchema.safeParse({ roles: ['OWNER'] }).success,
    ).toBe(false);
    expect(adminUpdateUserRolesDtoSchema.safeParse({ roles: [] }).success).toBe(
      false,
    );
    expect(
      adminCreateInvitationDtoSchema.safeParse({
        kind: 'COACH',
        ownerUserId: 2,
        email: 'coach@example.test',
        purpose: 'SHARE',
      }).success,
    ).toBe(false);
  });

  it('accepts only personal or colleague purpose on admin coach invitations', () => {
    expect(
      adminCreateInvitationDtoSchema.safeParse({
        kind: 'COACH',
        ownerUserId: 2,
        email: 'coach@example.test',
        purpose: 'COLLEAGUE',
      }).success,
    ).toBe(true);
  });
});
