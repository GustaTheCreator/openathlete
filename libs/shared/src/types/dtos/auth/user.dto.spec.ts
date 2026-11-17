import { describe, expect, it } from 'vitest';

import {
  createAccountResponseDtoSchema,
  updateAccountResponseDtoSchema,
  userDtoSchema,
} from './user.dto';

describe('public user DTO', () => {
  it('accepts the fields returned by getMe and rejects private account fields', () => {
    const user = {
      userId: 1,
      email: 'athlete@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: null,
      roles: ['ATHLETE'],
      onboardingCompleted: true,
      language: 'EN',
      timeZone: 'Europe/Lisbon',
      trainingReminders: true,
      calendarDisplay: null,
      hiddenActivityTracks: null,
      supportReminderDismissedAt: null,
      supportReminderDismissCount: 0,
      supporterNudgeSeenAt: null,
      emailTips: true,
      emailRecap: true,
      emailNewsConsentAt: null,
      acquisitionSource: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    expect(userDtoSchema.safeParse(user).success).toBe(true);
    expect(
      userDtoSchema.safeParse({ ...user, password: 'private' }).success,
    ).toBe(false);
  });

  it('matches the create-account response', () => {
    expect(
      createAccountResponseDtoSchema.safeParse({ userId: 12 }).success,
    ).toBe(true);
    expect(
      createAccountResponseDtoSchema.safeParse({ userId: 12, email: 'private' })
        .success,
    ).toBe(false);
  });

  it('matches the update-account response fields', () => {
    const result = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: null,
      timeZone: null,
      trainingReminders: true,
      calendarDisplay: null,
      hiddenActivityTracks: null,
      supportReminderDismissedAt: null,
      supportReminderDismissCount: 0,
      supporterNudgeSeenAt: null,
      emailTips: true,
      emailRecap: true,
      emailNewsConsentAt: null,
    };
    expect(updateAccountResponseDtoSchema.safeParse(result).success).toBe(true);
    expect(
      updateAccountResponseDtoSchema.safeParse({ ...result, email: 'private' })
        .success,
    ).toBe(false);
  });
});
