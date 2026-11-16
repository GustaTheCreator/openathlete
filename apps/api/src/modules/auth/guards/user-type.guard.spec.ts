import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '@openathlete/database';

import { AthleteController } from 'src/modules/core/controllers/athlete.controller';

import { UserTypeGuard } from './user-type.guard';

describe('invitation role access', () => {
  const guard = new UserTypeGuard(new Reflector());
  const invokeFor = (
    handler:
      AthleteController['inviteAthlete'] | AthleteController['inviteCoach'],
    roles: UserRole[] | null,
  ) => {
    const context = {
      getHandler: () => handler,
      getClass: () => AthleteController,
      switchToHttp: () => ({
        getRequest: () => ({ user: roles && { roles } }),
      }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  };

  it('allows any registered coach to send either invitation', () => {
    expect(
      invokeFor(AthleteController.prototype.inviteAthlete, [UserRole.COACH]),
    ).toBe(true);
    expect(
      invokeFor(AthleteController.prototype.inviteCoach, [UserRole.COACH]),
    ).toBe(true);
  });

  it('denies athlete-only accounts and anonymous callers', () => {
    for (const handler of [
      AthleteController.prototype.inviteAthlete,
      AthleteController.prototype.inviteCoach,
    ]) {
      expect(invokeFor(handler, [UserRole.ATHLETE])).toBe(false);
      expect(invokeFor(handler, null)).toBe(false);
    }
  });

  it('denies authenticated accounts with missing or malformed role data', () => {
    const handler = AthleteController.prototype.inviteAthlete;
    for (const roles of [undefined, null, 'COACH', {}] as const) {
      expect(invokeFor(handler, roles as unknown as UserRole[] | null)).toBe(
        false,
      );
    }
  });
});
