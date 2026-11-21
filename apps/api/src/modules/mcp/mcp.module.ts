import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { CoreModule } from '../core';
import { OAuthClientsService } from './auth/oauth-clients.service';
import { OAuthTokensModule } from './auth/oauth-tokens.module';
import { MCP_FEATURES_ENABLED, OAuthService } from './auth/oauth.service';
import { ActivityImportConnectionsController } from './controllers/activity-import-connections.controller';
import { OAuthController } from './controllers/oauth.controller';
import { WellKnownController } from './controllers/well-known.controller';

/** OAuth stays mounted for the separate activity file import resource. */
@Module({
  imports: [AuthModule, CoreModule, OAuthTokensModule],
  controllers: [
    ActivityImportConnectionsController,
    OAuthController,
    WellKnownController,
  ],
  providers: [
    OAuthClientsService,
    OAuthService,
    { provide: MCP_FEATURES_ENABLED, useValue: false },
  ],
})
export class McpModule {}
