import { DelayedError, Job } from 'bullmq';

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  ConnectorProvider,
  EventType,
  ProviderAccount,
} from '@openathlete/database';

import { AnalyticsService } from 'src/modules/analytics/analytics.service';
import { reportJobFailure } from 'src/modules/analytics/job-failure';

import { CoachActivityNoticeEvent } from '../../../events/coach-activity-notice.event';
import { ActivityDuplicateService } from '../../core/services/activity-duplicate.service';
import { PrismaService } from '../../prisma/services/prisma.service';
import {
  AFTER_DUPLICATE_DELAY_MS,
  ActivityDescriptionService,
} from '../../providers-sync/activity-description/activity-description.service';
import { ImportedActivity } from '../../providers-sync/base/provider-import.interface';
import { ProviderRateLimitError } from '../../providers-sync/errors/provider-rate-limit.error';
import { ProviderSyncLockService } from '../../providers-sync/provider-sync-lock.service';
import {
  CorosProviderService,
  GarminProviderService,
  PolarProviderService,
  StravaProviderService,
  SuuntoProviderService,
  WahooProviderService,
} from '../../providers-sync/providers';
import { ActivityImportJobData, QueueService } from '../queue.service';

const FIRST_ACTIVITIES_REPORTED = 5;

@Processor('activity-import', {
  concurrency: 3,
})
export class ActivityImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ActivityImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => StravaProviderService))
    private readonly stravaProviderService: StravaProviderService,
    @Inject(forwardRef(() => GarminProviderService))
    private readonly garminProviderService: GarminProviderService,
    @Inject(forwardRef(() => PolarProviderService))
    private readonly polarProviderService: PolarProviderService,
    @Inject(forwardRef(() => SuuntoProviderService))
    private readonly suuntoProviderService: SuuntoProviderService,
    @Inject(forwardRef(() => CorosProviderService))
    private readonly corosProviderService: CorosProviderService,
    @Inject(forwardRef(() => WahooProviderService))
    private readonly wahooProviderService: WahooProviderService,
    private readonly queueService: QueueService,
    @Inject(forwardRef(() => ActivityDuplicateService))
    private readonly duplicates: ActivityDuplicateService,
    private readonly providerLock: ProviderSyncLockService,
    @Optional() private readonly emitter?: EventEmitter2,
    @Optional() private readonly analytics?: AnalyticsService,
    @Optional()
    @Inject(forwardRef(() => ActivityDescriptionService))
    private readonly descriptions?: ActivityDescriptionService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ActivityImportJobData>, error: Error) {
    reportJobFailure(this.analytics, job, error);
    this.logger.error(
      `Job ${job.id} (${job.data?.activity?.externalId || 'unknown'}) failed: ${error.message}`,
      error.stack,
    );
  }

  // A history import brings thousands of activities: only its first ones say
  // something, that the account works
  private async reportImport(
    account: { athleteId: number; provider: string },
    bulkImport?: boolean,
  ) {
    if (!this.analytics?.enabled) return;
    if (bulkImport) {
      const imported = await this.prisma.event.count({
        where: { athleteId: account.athleteId, type: EventType.ACTIVITY },
      });
      if (imported > FIRST_ACTIVITIES_REPORTED) return;
    }
    await this.analytics.captureForAthlete(
      account.athleteId,
      'activity_imported',
      { provider: account.provider, bulk: Boolean(bulkImport) },
    );
  }

  /**
   * The athlete's activity from another source (another provider, an
   * uploaded file) recording the same workout. An activity this source saved
   * before goes on to its provider, which updates or returns it as today.
   */
  private async savedCopy(
    account: { athleteId: number; provider: ConnectorProvider },
    activity: ImportedActivity,
  ) {
    const known = await this.prisma.eventActivity.findUnique({
      where: { externalId: activity.externalId },
      select: { eventActivityId: true },
    });
    if (known) return null;
    return this.duplicates.findDuplicate(account.athleteId, {
      source: account.provider,
      // A queued activity comes back with its dates as strings
      startDate: new Date(activity.startDate),
      endDate: new Date(activity.endDate),
      movingTime: activity.duration ?? null,
    });
  }

  private importFromProvider(
    account: ProviderAccount,
    activity: ImportedActivity,
  ) {
    switch (account.provider) {
      case ConnectorProvider.STRAVA:
        return this.stravaProviderService.importActivity(account, activity);
      case ConnectorProvider.GARMIN:
        return this.garminProviderService.importActivity(account, activity);
      case ConnectorProvider.POLAR:
        return this.polarProviderService.importActivity(account, activity);
      case ConnectorProvider.SUUNTO:
        return this.suuntoProviderService.importActivity(account, activity);
      case ConnectorProvider.COROS:
        return this.corosProviderService.importActivity(account, activity);
      case ConnectorProvider.WAHOO:
        return this.wahooProviderService.importActivity(account, activity);
      default:
        throw new Error(
          `Provider ${account.provider} does not support activity import yet`,
        );
    }
  }

  async process(job: Job<ActivityImportJobData>, token?: string) {
    const { providerAccountId, activity, bulkImport } = job.data;

    try {
      await job.updateProgress(10);

      const account = await this.prisma.providerAccount.findUnique({
        where: {
          providerAccountId: providerAccountId,
        },
      });

      if (!account) {
        throw new Error(`Provider account ${providerAccountId} not found`);
      }

      if (account.status !== 'active') {
        throw new Error(
          `Provider account ${providerAccountId} is not active (status: ${account.status})`,
        );
      }

      if (!account.importActivitiesEnabled) {
        this.logger.debug(
          `Skipping import for provider account ${providerAccountId}: import disabled`,
        );
        return;
      }

      if (
        job.data.providerExternalUserId !== undefined &&
        job.data.providerExternalUserId !== account.externalUserId
      ) {
        return { success: true, skipped: 'provider-account-changed' };
      }

      // The cross-provider lookup and save must be serialized for an athlete.
      const imported = await this.providerLock.withActivityImportLock(
        account.athleteId,
        async () => {
          const copy = await this.savedCopy(account, activity);
          if (copy) return { copy };
          await job.updateProgress(30);
          return { result: await this.importFromProvider(account, activity) };
        },
      );
      if (imported.copy) {
        const { copy } = imported;
        this.logger.debug(
          `Skipping ${account.provider} activity ${activity.externalId}: event ${copy.eventId} from another source records the same workout`,
        );
        // The athlete records with a watch that also syncs here: the Strava
        // activity is described from the copy already saved
        if (
          account.provider === ConnectorProvider.STRAVA &&
          !bulkImport &&
          this.descriptions
        ) {
          await this.descriptions
            .schedule({
              athleteId: account.athleteId,
              stravaActivityId: activity.externalId,
              eventActivityId: copy.eventActivityId,
              startDate: new Date(activity.startDate),
              delayMs: AFTER_DUPLICATE_DELAY_MS,
            })
            .catch((error: unknown) =>
              this.logger.warn(
                `Could not queue the Strava description of ${activity.externalId}: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
        }
        return { success: true, skipped: 'duplicate', eventId: copy.eventId };
      }

      const { activity: savedActivity, created } = imported.result;

      // Only the import that saved the activity announces it: a webhook
      // retry or a later sync of the same activity finds it already there
      if (!bulkImport && created && this.emitter) {
        this.emitter.emit(
          CoachActivityNoticeEvent.SLUG,
          new CoachActivityNoticeEvent({
            eventId: savedActivity.eventId,
            kind: 'ACTIVITY',
            deliveryKey: `import:${savedActivity.eventId}`,
          }),
        );
      }
      if (created) await this.reportImport(account, bulkImport);
      await job.updateProgress(60);

      const activityWithStream = await this.prisma.eventActivity.findUnique({
        where: { eventActivityId: savedActivity.eventActivityId },
        select: { stream: true },
      });

      // Records are computed by the processing pipeline queued below
      await job.updateProgress(90);

      if (
        account.provider === ConnectorProvider.GARMIN &&
        !activityWithStream?.stream
      ) {
        return {
          success: true,
          eventActivityId: savedActivity.eventActivityId,
          eventId: savedActivity.eventId,
          waitingForStream: true,
        };
      }

      await this.queueService.addActivityProcessingJob(
        savedActivity.eventActivityId,
        savedActivity.eventId,
        bulkImport,
      );

      return {
        success: true,
        eventActivityId: savedActivity.eventActivityId,
        eventId: savedActivity.eventId,
      };
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        await job.moveToDelayed(Date.now() + error.retryAfterMs, token);
        throw new DelayedError();
      }
      this.logger.error(
        `Job ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
