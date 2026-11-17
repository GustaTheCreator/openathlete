import { z } from 'zod';

export const COACH_INVITATION_PURPOSES = ['PERSONAL', 'COLLEAGUE'] as const;
export const coachInvitationPurposeSchema = z.enum(COACH_INVITATION_PURPOSES);

export const inviteCoachSchema = z.object({
  email: z.string().email(),
  purpose: coachInvitationPurposeSchema.optional(),
});

export type InviteCoachDto = z.infer<typeof inviteCoachSchema>;
