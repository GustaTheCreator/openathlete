import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { SubscriptionModule } from '../subscription';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, SubscriptionModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
