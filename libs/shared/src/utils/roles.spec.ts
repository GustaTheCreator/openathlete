import { describe, expect, it } from 'vitest';

import { canIssueInvitations, getSportsRoles } from './roles';

describe('role capabilities', () => {
  it.each([
    { roles: [], expected: false },
    { roles: ['ATHLETE'], expected: false },
    { roles: ['COACH'], expected: true },
    { roles: ['ATHLETE', 'COACH'], expected: true },
    { roles: ['SUPER_ADMIN'], expected: true },
  ] as const)(
    'checks invitation issuance for $roles',
    ({ roles, expected }) => {
      expect(canIssueInvitations(roles)).toBe(expected);
    },
  );

  it('keeps administrative permissions out of the sports spaces', () => {
    expect(getSportsRoles(['SUPER_ADMIN'])).toEqual([]);
    expect(getSportsRoles(['ATHLETE', 'COACH', 'SUPER_ADMIN'])).toEqual([
      'ATHLETE',
      'COACH',
    ]);
  });
});
