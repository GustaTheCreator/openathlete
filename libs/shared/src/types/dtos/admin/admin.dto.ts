import { z } from 'zod';

const userRoleSchema = z.enum(['ATHLETE', 'COACH', 'SUPER_ADMIN']);
const invitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
const coachInvitationPurposeSchema = z.enum([
  'PERSONAL',
  'COLLEAGUE',
  'SHARE',
  'TRANSFER',
]);

export const adminUserDtoSchema = z.object({
  userId: z.number().int(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  roles: z.array(userRoleSchema),
  onboardingCompleted: z.boolean(),
  athleteId: z.number().int().nullable(),
});
export type AdminUserDto = z.infer<typeof adminUserDtoSchema>;

export const adminUsersResponseDtoSchema = z.object({
  users: z.array(adminUserDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AdminUsersResponseDto = z.infer<typeof adminUsersResponseDtoSchema>;

export const adminUpdateUserRolesDtoSchema = z.object({
  roles: z.array(userRoleSchema).min(1).max(3),
});
export type AdminUpdateUserRolesDto = z.infer<
  typeof adminUpdateUserRolesDtoSchema
>;

export const adminCoachAthleteDtoSchema = z.object({
  coachAthleteId: z.number().int(),
  coachUserId: z.number().int(),
  coachEmail: z.string(),
  coachName: z.string(),
  athleteId: z.number().int(),
  athleteUserId: z.number().int(),
  athleteEmail: z.string(),
  athleteName: z.string(),
});
export type AdminCoachAthleteDto = z.infer<typeof adminCoachAthleteDtoSchema>;

export const adminCoachAthletesResponseDtoSchema = z.object({
  associations: z.array(adminCoachAthleteDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AdminCoachAthletesResponseDto = z.infer<
  typeof adminCoachAthletesResponseDtoSchema
>;

export const adminCreateCoachAthleteDtoSchema = z.object({
  coachUserId: z.number().int().positive(),
  athleteId: z.number().int().positive(),
});
export type AdminCreateCoachAthleteDto = z.infer<
  typeof adminCreateCoachAthleteDtoSchema
>;

export const adminInvitationDtoSchema = z.object({
  kind: z.enum(['ATHLETE', 'COACH']),
  invitationId: z.number().int(),
  email: z.string().nullable(),
  status: invitationStatusSchema.nullable(),
  purpose: coachInvitationPurposeSchema.nullable(),
  athleteIds: z.array(z.number().int()),
  ownerUserId: z.number().int(),
  ownerEmail: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AdminInvitationDto = z.infer<typeof adminInvitationDtoSchema>;

export const adminInvitationsResponseDtoSchema = z.object({
  invitations: z.array(adminInvitationDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AdminInvitationsResponseDto = z.infer<
  typeof adminInvitationsResponseDtoSchema
>;

export const adminCreateInvitationDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ATHLETE'),
    ownerUserId: z.number().int().positive(),
    email: z.string().email().max(254),
  }),
  z.object({
    kind: z.literal('COACH'),
    ownerUserId: z.number().int().positive(),
    email: z.string().email().max(254),
    purpose: z.enum(['PERSONAL', 'COLLEAGUE']).optional(),
  }),
]);
export type AdminCreateInvitationDto = z.infer<
  typeof adminCreateInvitationDtoSchema
>;
