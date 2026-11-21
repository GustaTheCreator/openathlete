import { Module } from '@nestjs/common';

import { AiModule } from '../ai';
import { AuthModule } from '../auth';
import { CoreModule } from '../core/core.module';
import { SubscriptionModule } from '../subscription';
import { WebSocketModule } from '../websocket/websocket.module';
import { EventGenerationService } from './services/event-generation.service';
import { EventModificationService } from './services/event-modification.service';

@Module({
  imports: [
    AiModule,
    AuthModule,
    CoreModule,
    SubscriptionModule,
    WebSocketModule,
  ],
  controllers: [],
  providers: [EventGenerationService, EventModificationService],
})
export class AgentModule {}
