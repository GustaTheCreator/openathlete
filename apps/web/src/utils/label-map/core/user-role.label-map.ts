import { m } from '@/paraglide/messages';

import { SportRole } from '@openathlete/shared';

export const userRoleLabelMap: Record<SportRole, string> = {
  ATHLETE: m.athlete(),
  COACH: m.coach(),
};
