import { subject } from '@casl/ability';

import { UserRole } from '@openathlete/database';

import { CaslAbilityFactory } from './casl-ability.factory';

describe('CaslAbilityFactory linked coach access', () => {
  const athlete = subject('Athlete', { athleteId: 20, userId: 30 } as never);
  const user = (roles: UserRole[]) => ({
    userId: 10,
    email: 'user@example.com',
    athlete: null,
    roles,
    coachAthletes: [{ athleteId: 20 }],
  });

  it('does not grant linked-coach access to an athlete-only account', async () => {
    const ability = await new CaslAbilityFactory().getFor({
      user: user([UserRole.ATHLETE]) as never,
    });
    expect(ability.can('read', athlete)).toBe(false);
  });

  it('grants linked-coach access to an account with the COACH role', async () => {
    const ability = await new CaslAbilityFactory().getFor({
      user: user([UserRole.COACH]) as never,
    });
    expect(ability.can('read', athlete)).toBe(true);
  });
});
