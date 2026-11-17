import { z } from 'zod';

export const rosterInvitationSchema = z.object({
  email: z.string().email(),
  operation: z.enum(['SHARE', 'TRANSFER']),
  athleteIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});

export type RosterInvitationDto = z.infer<typeof rosterInvitationSchema>;
