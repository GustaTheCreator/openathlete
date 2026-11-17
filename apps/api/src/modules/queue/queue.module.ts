import { Module, forwardRef } from '@nestjs/common';

import { CoreModule } from '../core/core.module';
import { ProvidersSyncModule } from '../providers-sync/providers-sync.module';
import { ActivityImportProcessor } from './processors/activity-import.processor';
import { ActivityProcessingProcessor } from './processors/activity-processing.processor';
import { CorosSyncProcessor } from './processors/coros-sync.processor';
import { DuplicateActivitiesProcessor } from './processors/duplicate-activities.processor';
import { GarminNotificationProcessor } from './processors/garmin-notification.processor';
import { PolarNotificationProcessor } from './processors/polar-notification.processor';
import { ProviderFullImportProcessor } from './processors/provider-full-import.processor';
import { StravaDescriptionProcessor } from './processors/strava-description.processor';
import { SuuntoNotificationProcessor } from './processors/suunto-notification.processor';
import { TrainingLoadEstimationProcessor } from './processors/training-load-estimation.processor';
import { QueueCoreModule } from './queue-core.module';
import { GapBackfillService } from './services/gap-backfill.service';
import { IntensityBackfillService } from './services/intensity-backfill.service';
import { RecordsBackfillService } from './services/records-backfill.service';

@Module({
  imports: [
    QueueCoreModule,
    forwardRef(() => CoreModule),
    forwardRef(() => ProvidersSyncModule),
  ],
  providers: [
    // Note: env is validated by envValidationSchema; processor providers are
    // intentionally absent from API-only deployments.
    ...(process.env.ENABLE_ACTIVITY_IMPORT === 'true'
      ? [
          ActivityImportProcessor,
          ProviderFullImportProcessor,
          GarminNotificationProcessor,
          SuuntoNotificationProcessor,
          PolarNotificationProcessor,
          CorosSyncProcessor,
          StravaDescriptionProcessor,
        ]
      : []),
    ...(process.env.ENABLE_ACTIVITY_PROCESSING === 'true'
      ? [
          ActivityProcessingProcessor,
          DuplicateActivitiesProcessor,
          RecordsBackfillService,
          GapBackfillService,
          IntensityBackfillService,
        ]
      : []),
    ...(process.env.ENABLE_TRAINING_LOAD_ESTIMATION === 'true'
      ? [TrainingLoadEstimationProcessor]
      : []),
  ],
})
export class QueueModule {}
