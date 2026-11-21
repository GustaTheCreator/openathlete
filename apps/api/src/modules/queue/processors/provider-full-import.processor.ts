import { Job, UnrecoverableError, Worker } from 'bullmq';

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  HttpException,
  Inject,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';

import { ConnectorProvider, ProviderAccount } from '@openathlete/database';

import { AnalyticsService } from 'src/modules/analytics/analytics.service';
import { reportJobFailure } from 'src/modules/analytics/job-failure';

import { PrismaService } from '../../prisma/services/prisma.service';
import { FullImportResult } from '../../providers-sync/base/base-provider.service';
import { ProviderRateLimitError } from '../../providers-sync/errors/provider-rate-limit.error';
import {
  CorosProviderService,
  GarminProviderService,
  PolarProviderService,
  StravaProviderService,
  SuuntoProviderService,
  WahooProviderService,
} from '../../providers-sync/providers';
import { ProviderFullImportJobData } from '../queue.service';

/**
 * Lists a provider account's activity history and queues one activity
 * import job per activity. Garmin instead requests a backfill, whose
 * activities arrive later through its webhooks.
 */
@Processor('provider-full-import', {
  concurrency: 2,
  // Spread out the history requests: Garmin answers 429 to a burst, such as
  // the backfill of every account at once (openathlete garmin-backfill)
  limiter: { max: 10, duration: 60_000 },
})
export class ProviderFullImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ProviderFullImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => StravaProviderService))
    private readonly stravaProviderService: StravaProviderService,
    @Inject(forwardRef(() => GarminProviderService))
    private readonly garminProviderService: GarminProviderService,
    @Inject(forwardRef(() => SuuntoProviderService))
    private readonly suuntoProviderService: SuuntoProviderService,
    @Inject(forwardRef(() => CorosProviderService))
    private readonly corosProviderService: CorosProviderService,
    @Inject(forwardRef(() => WahooProviderService))
    private readonly wahooProviderService: WahooProviderService,
    @Inject(forwardRef(() => PolarProviderService))
    private readonly polarProviderService: PolarProviderService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {
    super();
  }

  async process(job: Job<ProviderFullImportJobData>) {
    const { providerAccountId, history } = job.data;
    const account = await this.prisma.providerAccount.findUnique({
      where: { providerAccountId },
    });

    // Disconnected or import turned off since the request: nothing to do
    if (
      !account ||
      account.status !== 'active' ||
      !account.importActivitiesEnabled ||
      (history && account.externalUserId !== history.externalUserId)
    ) {
      if (account)
        await this.resetRequest(providerAccountId, history?.requestedAt);
      return { queuedActivities: 0, skipped: true };
    }
    if (
      history &&
      account.fullImportRequestedAt?.toISOString() !== history.requestedAt
    ) {
      return { queuedActivities: 0, skipped: true };
    }

    let result: FullImportResult;
    try {
      result = await this.runProviderImport(account, job);
    } catch (error) {
      // Out of quota: pause the whole queue, as the next accounts would be
      // refused too, and put the job back without spending an attempt
      if (error instanceof ProviderRateLimitError) {
        await this.worker.rateLimit(error.retryAfterMs);
        throw Worker.RateLimitError();
      }
      // A refused request (missing permission...) won't succeed on retry
      if (error instanceof HttpException && error.getStatus() < 500) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }

    if (history) {
      const updated = await this.prisma.providerAccount.updateMany({
        where: {
          providerAccountId,
          status: 'active',
          importActivitiesEnabled: true,
          externalUserId: history.externalUserId,
          fullImportRequestedAt: new Date(history.requestedAt),
        },
        data: { fullImportCompletedAt: new Date() },
      });
      if (!updated.count) {
        this.logger.warn(
          `Historical import for account ${providerAccountId} finished after the active request changed`,
        );
      }
    } else {
      await this.prisma.providerAccount.update({
        where: { providerAccountId },
        data: {
          // A Garmin backfill completes later, through webhooks
          fullImportCompletedAt: result.backfillRequested ? null : new Date(),
        },
      });
    }

    this.logger.log(
      `Historical ${account.provider} import for account ${providerAccountId}: ${
        result.backfillRequested
          ? 'backfill requested'
          : `${result.queuedActivities} activities queued`
      }`,
    );
    return result;
  }

  /** Once every attempt failed, let the user request the import again. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProviderFullImportJobData>, error: Error) {
    reportJobFailure(this.analytics, job, error);
    this.logger.error(
      `Historical import for account ${job.data.providerAccountId} failed (attempt ${job.attemptsMade}): ${error.message}`,
      error.stack,
    );
    if (
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1)
    ) {
      await this.resetRequest(
        job.data.providerAccountId,
        job.data.history?.requestedAt,
      );
    }
  }

  private runProviderImport(
    account: ProviderAccount,
    job: Job<ProviderFullImportJobData>,
  ): Promise<FullImportResult> {
    const { history } = job.data;
    const options = history && {
      startDate: history.startDate ? new Date(history.startDate) : undefined,
      endDate: new Date(history.endDate),
    };
    switch (account.provider) {
      case ConnectorProvider.STRAVA:
        return this.stravaProviderService.queueFullImport(account, options);
      case ConnectorProvider.GARMIN:
        return this.garminProviderService.queueFullImport(account, options);
      case ConnectorProvider.SUUNTO:
        return this.suuntoProviderService.queueFullImport(account, options);
      case ConnectorProvider.COROS:
        return this.corosProviderService.queueFullImport(account, options);
      case ConnectorProvider.POLAR:
        return this.polarProviderService.queueFullImport(account, options);
      case ConnectorProvider.WAHOO: {
        if (!history) {
          throw new UnrecoverableError('Wahoo history range is missing');
        }
        return this.wahooProviderService.queueFullImport(
          account,
          history,
          async (progress) => {
            await job.updateData({
              ...job.data,
              history: { ...history, ...progress },
            });
          },
        );
      }
      default:
        throw new Error(
          `Historical import is not available for ${account.provider}`,
        );
    }
  }

  private async resetRequest(
    providerAccountId: number,
    requestAnchor?: string,
  ) {
    await this.prisma.providerAccount.updateMany({
      where: {
        providerAccountId,
        fullImportCompletedAt: null,
        ...(requestAnchor && {
          fullImportRequestedAt: new Date(requestAnchor),
        }),
      },
      data: { fullImportRequestedAt: null },
    });
  }
}
