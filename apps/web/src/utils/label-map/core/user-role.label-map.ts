import { m } from '@/paraglide/messages';

import {
  type SportRole,
  type UserRole,
  getSportsRoles,
} from '@openathlete/shared';

export const userRoleLabelMap: Record<SportRole, string> = {
  ATHLETE: m.athlete(),
  COACH: m.coach(),
};

/** Identifies accounts that hold both sports roles without folding in administration. */
export function sportsRoleIdentityLabel(
  roles: readonly UserRole[] | null | undefined,
): string | null {
  const sportsRoles = getSportsRoles(roles ?? []);
  return sportsRoles.includes('ATHLETE') && sportsRoles.includes('COACH')
    ? m.coach_and_athlete()
    : null;
}
