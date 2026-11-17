import { describe, expect, it, vi } from 'vitest';

import { sportsRoleIdentityLabel } from './user-role.label-map';

vi.mock('@/paraglide/messages', () => ({
  m: {
    athlete: () => 'Athlete',
    coach: () => 'Coach',
    coach_and_athlete: () => 'Coach and athlete',
  },
}));

describe('sportsRoleIdentityLabel', () => {
  it.each([
    [['ATHLETE', 'COACH'], 'Coach and athlete'],
    [['COACH', 'ATHLETE', 'SUPER_ADMIN'], 'Coach and athlete'],
    [['ATHLETE'], null],
    [['COACH'], null],
    [['ATHLETE', 'SUPER_ADMIN'], null],
    [['SUPER_ADMIN'], null],
    [[], null],
  ] as const)(
    'formats only accounts with both sports roles: %j',
    (roles, label) => {
      expect(sportsRoleIdentityLabel(roles)).toBe(label);
    },
  );
});
