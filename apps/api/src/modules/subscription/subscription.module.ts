import { Module } from '@nestjs/common';

import { UserTypeGuard } from '../auth/guards/user-type.guard';
import { AppleStoreService } from './apple/apple-store.service';
import { AppleNotificationsController } from './controllers/apple-notifications.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { FeatureAccessGuard } from './guards/feature-access.guard';
import { FeatureAccessService } from './services/feature-access.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionService } from './services/subscription.service';

@Module({
  controllers: [
    SubscriptionController,
    StripeWebhookController,
    AppleNotificationsController,
  ],
  providers: [
    StripeService,
    AppleStoreService,
    SubscriptionService,
    FeatureAccessService,
    FeatureAccessGuard,
    UserTypeGuard,
  ],
  exports: [
    SubscriptionService,
    StripeService,
    FeatureAccessService,
    FeatureAccessGuard,
  ],
})
export class SubscriptionModule {}
