import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { UserRole } from '@openathlete/database';
import {
  adminCreateCoachAthleteDtoSchema,
  adminCreateInvitationDtoSchema,
  adminUpdateUserRolesDtoSchema,
} from '@openathlete/shared';

import { JwtUser, UserTypes } from '../auth/decorators';
import { UserTypeGuard } from '../auth/guards';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), UserTypeGuard)
@UserTypes([UserRole.SUPER_ADMIN])
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(
    @JwtUser() actor: { userId: number },
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parse = (raw: string | undefined, fallback: number, max?: number) => {
      if (raw === undefined) return fallback;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || (max && value > max)) {
        throw new BadRequestException('Invalid pagination');
      }
      return value;
    };
    return this.admin.listUsers(
      actor.userId,
      search?.trim() || undefined,
      parse(limit, 50, 100),
      parse(offset, 0),
    );
  }

  @Patch('users/:id/roles')
  updateRoles(
    @JwtUser() actor: { userId: number },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const parsed = adminUpdateUserRolesDtoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updateRoles(actor.userId, id, parsed.data.roles);
  }

  @Get('coach-athletes')
  coachAthletes(@JwtUser() actor: { userId: number }) {
    return this.admin.listCoachAthletes(actor.userId);
  }

  @Post('coach-athletes')
  createCoachAthlete(
    @JwtUser() actor: { userId: number },
    @Body() body: unknown,
  ) {
    const parsed = adminCreateCoachAthleteDtoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.createCoachAthlete(actor.userId, parsed.data);
  }

  @Delete('coach-athletes/:id')
  deleteCoachAthlete(
    @JwtUser() actor: { userId: number },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.admin.deleteCoachAthlete(actor.userId, id);
  }

  @Get('invitations')
  invitations(@JwtUser() actor: { userId: number }) {
    return this.admin.listInvitations(actor.userId);
  }

  @Post('invitations')
  createInvitation(
    @JwtUser() actor: { userId: number },
    @Body() body: unknown,
  ) {
    const parsed = adminCreateInvitationDtoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.createInvitation(actor.userId, parsed.data);
  }

  @Delete('invitations/:kind/:id')
  deleteInvitation(
    @JwtUser() actor: { userId: number },
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (kind !== 'ATHLETE' && kind !== 'COACH') {
      throw new BadRequestException('Invalid invitation kind');
    }
    return this.admin.cancelInvitation(actor.userId, kind, id);
  }
}
