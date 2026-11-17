import { z } from 'zod';

import { coachInvitationPurposeSchema } from '../core/invite-coach.dto';

export const createInvitationLinkSchema = z.object({
  kind: z.enum(['ATHLETE', 'COACH']),
  purpose: coachInvitationPurposeSchema.optional(),
});
export type CreateInvitationLinkDto = z.infer<
  typeof createInvitationLinkSchema
>;

export const invitationTokenSchema = z.object({
  token: z.string().min(1).max(200),
});
export type InvitationTokenDto = z.infer<typeof invitationTokenSchema>;

export type InvitationPreviewDto = {
  valid: boolean;
  kind?: 'ATHLETE' | 'COACH';
  purpose?: 'PERSONAL' | 'COLLEAGUE' | 'SHARE' | 'TRANSFER';
  email?: string | null;
  inviterName?: string;
  expiresAt?: string;
};

export type InvitationLinkDto = { url: string; expiresAt: string };
