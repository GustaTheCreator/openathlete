import { z } from 'zod';

import { acquisitionSourceSchema } from './complete-onboarding.dto';

export const userDtoSchema = z
  .object({
    userId: z.number().int(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable(),
    roles: z.array(z.enum(['ATHLETE', 'COACH', 'SUPER_ADMIN'])),
    onboardingCompleted: z.boolean(),
    language: z.enum(['FR', 'EN', 'IT', 'ES', 'PT_BR']),
    timeZone: z.string().nullable(),
    trainingReminders: z.boolean(),
    calendarDisplay: z.json().nullable(),
    hiddenActivityTracks: z.json().nullable(),
    supportReminderDismissedAt: z.coerce.date().nullable(),
    supportReminderDismissCount: z.number().int(),
    supporterNudgeSeenAt: z.coerce.date().nullable(),
    emailTips: z.boolean(),
    emailRecap: z.boolean(),
    emailNewsConsentAt: z.coerce.date().nullable(),
    acquisitionSource: acquisitionSourceSchema.nullable(),
    createdAt: z.coerce.date(),
  })
  .strict();

export type UserDto = z.infer<typeof userDtoSchema>;

export const createAccountResponseDtoSchema = z
  .object({ userId: z.number().int() })
  .strict();
export type CreateAccountResponseDto = z.infer<
  typeof createAccountResponseDtoSchema
>;

export const updateAccountResponseDtoSchema = userDtoSchema.pick({
  firstName: true,
  lastName: true,
  gender: true,
  timeZone: true,
  trainingReminders: true,
  calendarDisplay: true,
  hiddenActivityTracks: true,
  supportReminderDismissedAt: true,
  supportReminderDismissCount: true,
  supporterNudgeSeenAt: true,
  emailTips: true,
  emailRecap: true,
  emailNewsConsentAt: true,
});
export type UpdateAccountResponseDto = z.infer<
  typeof updateAccountResponseDtoSchema
>;
