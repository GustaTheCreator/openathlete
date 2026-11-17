import type { UserRole } from '../entities';

export type SportRole = Extract<UserRole, 'ATHLETE' | 'COACH'>;

export function canIssueInvitations(roles: readonly UserRole[]): boolean {
  return roles.includes('COACH') || roles.includes('SUPER_ADMIN');
}

export function getSportsRoles(roles: readonly UserRole[]): SportRole[] {
  return [...new Set(roles)].filter(
    (role): role is SportRole => role === 'ATHLETE' || role === 'COACH',
  );
}
