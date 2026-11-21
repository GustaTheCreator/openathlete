import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { McpConnection } from '@openathlete/shared';

import { JwtUser } from 'src/modules/auth';
import { AuthUser } from 'src/modules/auth/decorators/user.decorator';

import { McpAuthService } from '../auth/mcp-auth.service';

@ApiTags('Activity Import')
@UseGuards(AuthGuard('jwt'))
@Controller('activity-import/connections')
export class ActivityImportConnectionsController {
  constructor(private readonly auth: McpAuthService) {}

  @Get()
  @ApiOperation({
    summary: 'Connected applications that can import activities',
  })
  list(@JwtUser() user: AuthUser): Promise<McpConnection[]> {
    return this.auth.listActivityImportConnections(user);
  }

  @Delete(':grantId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Disconnect an application that imports activities',
  })
  revoke(
    @JwtUser() user: AuthUser,
    @Param('grantId', ParseIntPipe) grantId: number,
  ): Promise<void> {
    return this.auth.revokeActivityImportConnection(user, grantId);
  }
}
