import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { ProviderAccount } from '@openathlete/database';

import { ImportedActivity } from '../providers-sync/base/provider-import.interface';

export interface ActivityImportJobData {
  providerAccountId: number;
  activity: ImportedActivity;
  bulkImport?: boolean;
  providerExternalUserId?: string | null;
}

export interface ProviderFullImportJobData {
  providerAccountId: number;
  history?: {
    startDate?: string;
    endDate: string;
    requestedAt: string;
    externalUserId: string | null;
    nextPage?: number;
    queuedActivities?: number;
  };
}

/** One entry of a Garmin ping or push notification */
export interface GarminNotificationJobData {
  /** The list key of the notification: activities, dailies, activityFiles... */
  summaryType: string;
  userId: string;
  /** Ping: where to pull the data. Push: absent, the entry is the data. */
  callbackURL?: string;
  entry: Record<string, unknown>;
}

/** A Suunto webhook, handled out of the request: Suunto waits 2 seconds */
export type SuuntoNotificationJobData =
  | { kind: 'workout'; username: string | null; workoutKey: string }
  | {
      kind: 'metrics';
      providerAccountId: number;
      /** Epoch milliseconds; the sync runs up to now */
      from: number;
    };

/** Polar work, out of the webhook and spread away from Polar's quota */
export type PolarNotificationJobData =
  | { kind: 'exercise'; providerAccountId: number; exerciseId: string }
  | { kind: 'sync'; providerAccountId: number }
  | { kind: 'metrics'; providerAccountId: number };

/** COROS has no webhooks: its activities and metrics are polled */
export type CorosSyncJobData =
  | { kind: 'sync'; providerAccountId: number }
  | { kind: 'metrics'; providerAccountId: number }
  | {
      kind: 'history-batch';
      providerAccountId: number;
      activities: ImportedActivity[];
      externalUserId?: string | null;
    };

const POLAR_WEBHOOK_SECRET_KEY = 'openathlete:polar:webhook-secret';

const WAHOO_OAUTH_CONSUME = `local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local login = cjson.decode(value)
if login.userId ~= tonumber(ARGV[1]) or login.challenge ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1])
return 1`;

/** Removal of an athlete's activities saved twice, from two sources */
export interface DuplicateActivitiesJobData {
  athleteId: number;
}

/** Writing OpenAthlete's analysis into a Strava activity's description */
export interface StravaDescriptionJobData {
  providerAccountId: number;
  stravaActivityId: string;
  /** The saved activity read, possibly a copy from another source */
  eventActivityId: number;
}

export interface ActivityProcessingJobData {
  eventActivityId: number;
  eventId: number;
  bulkImport?: boolean;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('activity-import')
    private readonly activityImportQueue: Queue<ActivityImportJobData>,
    @InjectQueue('activity-processing')
    private readonly activityProcessingQueue: Queue<ActivityProcessingJobData>,
    @InjectQueue('provider-full-import')
    private readonly fullImportQueue: Queue<ProviderFullImportJobData>,
    @InjectQueue('garmin-notification')
    private readonly garminNotificationQueue: Queue<GarminNotificationJobData>,
    @InjectQueue('suunto-notification')
    private readonly suuntoNotificationQueue: Queue<SuuntoNotificationJobData>,
    @InjectQueue('polar-notification')
    private readonly polarNotificationQueue: Queue<PolarNotificationJobData>,
    @InjectQueue('coros-sync')
    private readonly corosSyncQueue: Queue<CorosSyncJobData>,
    @InjectQueue('duplicate-activities')
    private readonly duplicateActivitiesQueue: Queue<DuplicateActivitiesJobData>,
    @InjectQueue('strava-description')
    private readonly stravaDescriptionQueue: Queue<StravaDescriptionJobData>,
  ) {}

  async rememberWahooOAuth(
    state: string,
    userId: number,
    verifier: string,
  ): Promise<void> {
    const redis = await this.activityImportQueue.client;
    const saved = await redis.set(
      `openathlete:wahoo:oauth:${state}`,
      JSON.stringify({
        userId,
        challenge: createHash('sha256').update(verifier).digest('hex'),
      }),
      { EX: 600 },
    );
    if (!saved) throw new Error('Could not start Wahoo authorization');
  }

  async consumeWahooOAuth(
    state: string,
    userId: number,
    verifier: string,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
    const redis = await this.activityImportQueue.client;
    redis.defineCommand('consumeWahooOAuth', {
      numberOfKeys: 1,
      lua: WAHOO_OAUTH_CONSUME,
    });
    const result = await redis.runCommand('consumeWahooOAuth', [
      `openathlete:wahoo:oauth:${state}`,
      userId,
      createHash('sha256').update(verifier).digest('hex'),
    ]);
    return result === 1;
  }

  /**
   * One job per Strava activity: the import and a duplicate skip of the same
   * workout queue it once.
   */
  async addStravaDescriptionJob(
    data: StravaDescriptionJobData,
    delayMs: number,
  ): Promise<void> {
    await this.stravaDescriptionQueue.add('write', data, {
      jobId: `strava-description-${data.stravaActivityId}`,
      delay: delayMs,
    });
  }

  async addCorosSyncJob(providerAccountId: number, delayMs = 0): Promise<void> {
    await this.corosSyncQueue.add(
      'sync',
      { kind: 'sync', providerAccountId },
      {
        jobId: `coros-sync-${providerAccountId}-${Math.floor(Date.now() / 1_800_000)}`,
        delay: delayMs,
      },
    );
  }

  async addCorosMetricsJob(
    providerAccountId: number,
    delayMs = 0,
  ): Promise<void> {
    await this.corosSyncQueue.add(
      'metrics',
      { kind: 'metrics', providerAccountId },
      {
        jobId: `coros-metrics-${providerAccountId}-${Math.floor(Date.now() / 3_600_000)}`,
        delay: delayMs,
      },
    );
  }

  /** History comes in daily batches: see CorosProviderService.queueFullImport */
  async addCorosHistoryBatchJob(
    providerAccountId: number,
    activities: ImportedActivity[],
    delayMs: number,
    externalUserId: string | null,
  ): Promise<void> {
    await this.corosSyncQueue.add(
      'history-batch',
      { kind: 'history-batch', providerAccountId, activities, externalUserId },
      { delay: delayMs },
    );
  }

  /** Polar may notify an exercise twice: import it once */
  async addPolarExerciseJob(
    providerAccountId: number,
    exerciseId: string,
  ): Promise<void> {
    await this.polarNotificationQueue.add(
      'exercise',
      { kind: 'exercise', providerAccountId, exerciseId },
      { jobId: `polar-exercise-${exerciseId}` },
    );
  }

  async addPolarSyncJob(providerAccountId: number, delayMs = 0): Promise<void> {
    await this.polarNotificationQueue.add(
      'sync',
      { kind: 'sync', providerAccountId },
      {
        jobId: `polar-sync-${providerAccountId}-${Math.floor(Date.now() / 3_600_000)}-${delayMs}`,
        delay: delayMs,
      },
    );
  }

  /** The delay gathers the events of a watch sync into one request set */
  async addPolarMetricsJob(
    providerAccountId: number,
    delayMs = 60_000,
  ): Promise<void> {
    await this.polarNotificationQueue.add(
      'metrics',
      { kind: 'metrics', providerAccountId },
      {
        jobId: `polar-metrics-${providerAccountId}-${Math.floor((Date.now() + delayMs) / 60_000)}`,
        delay: delayMs,
      },
    );
  }

  /**
   * Polar shows a webhook's signing key once. The API verifies with what the
   * worker may have created, so the key lives in Redis, which both share.
   */
  async getPolarWebhookSecret(): Promise<string | null> {
    const redis = await this.polarNotificationQueue.client;
    return redis.get(POLAR_WEBHOOK_SECRET_KEY);
  }

  async setPolarWebhookSecret(secret: string): Promise<void> {
    const redis = await this.polarNotificationQueue.client;
    await redis.set(POLAR_WEBHOOK_SECRET_KEY, secret);
  }

  /** Suunto retries a webhook it thinks failed: import the workout once */
  async addSuuntoWorkoutJob(
    username: string | null,
    workoutKey: string,
  ): Promise<void> {
    await this.suuntoNotificationQueue.add(
      'workout',
      { kind: 'workout', username, workoutKey },
      { jobId: `suunto-workout-${workoutKey}` },
    );
  }

  /**
   * Sync an account's 24/7 data. Suunto sends a webhook per batch of
   * samples: the delay gathers a burst into one sync, which waiting jobs
   * with the same id join.
   */
  async addSuuntoMetricsJob(
    providerAccountId: number,
    from: number,
    delayMs = 60_000,
  ): Promise<void> {
    await this.suuntoNotificationQueue.add(
      'metrics',
      { kind: 'metrics', providerAccountId, from },
      {
        jobId: `suunto-metrics-${providerAccountId}-${Math.floor((Date.now() + delayMs) / 60_000)}`,
        delay: delayMs,
      },
    );
  }

  /**
   * Queue Garmin notifications, so the webhook answers within Garmin's 30
   * seconds and a restart loses none: callback URLs stay valid for 7 days
   * (activity files: 24 hours).
   */
  async addGarminNotificationJobs(
    notifications: GarminNotificationJobData[],
  ): Promise<void> {
    if (notifications.length === 0) return;
    await this.garminNotificationQueue.addBulk(
      notifications.map((data) => ({
        name: data.summaryType,
        data,
        // Garmin resends a notification it thinks failed: process it once
        opts: {
          jobId: `garmin-${createHash('sha256')
            .update(
              JSON.stringify([
                data.summaryType,
                data.userId,
                data.callbackURL ?? data.entry,
              ]),
            )
            .digest('hex')}`,
        },
      })),
    );
  }

  /**
   * Queue the historical import of a provider account. Listing years of
   * activities takes minutes and many rate-limited provider calls, so it runs
   * in the worker rather than in the HTTP request.
   */
  async addFullImportJob(
    providerAccountId: number,
    history?: ProviderFullImportJobData['history'],
  ): Promise<boolean> {
    const jobId = `full-import-${providerAccountId}`;
    // A finished job keeps its id until it expires: remove it so a new
    // import can be queued (an active one is left alone)
    const existing = await this.fullImportQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') {
        return false;
      }
      await existing.remove();
    }
    await this.fullImportQueue.add(
      'full-import',
      { providerAccountId, ...(history && { history }) },
      { jobId },
    );
    return true;
  }

  /**
   * Queue the removal of an athlete's duplicate activities. A removal
   * already waiting or running covers a second request.
   */
  async addDuplicateActivitiesJob(athleteId: number): Promise<void> {
    const jobId = `duplicate-activities-${athleteId}`;
    const existing = await this.duplicateActivitiesQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') return;
      await existing.remove();
    }
    await this.duplicateActivitiesQueue.add(
      'remove-duplicates',
      { athleteId },
      { jobId },
    );
  }

  private calculatePriority(startDate: string | Date): number {
    const activityDate = new Date(startDate);
    const now = new Date();
    const daysDiff = Math.max(
      0,
      Math.floor(
        (now.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    return Math.min(2097152, Math.min(daysDiff, 200) * 10000);
  }

  private async prepareActivityImportJob(
    account: ProviderAccount,
    activity: ImportedActivity,
    bulkImport: boolean,
  ) {
    const jobId = `import-${account.provider}-${activity.externalId}`;
    const existingJob = await this.activityImportQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state !== 'completed' && state !== 'failed') return null;
      await existingJob.remove();
    }

    return {
      name: 'import',
      data: {
        providerAccountId: account.providerAccountId,
        activity,
        bulkImport,
        providerExternalUserId: account.externalUserId,
      },
      opts: {
        priority: this.calculatePriority(activity.startDate),
        jobId,
      },
    };
  }

  async addActivityImportJob(
    account: ProviderAccount,
    activity: ImportedActivity,
    bulkImport = false,
  ): Promise<void> {
    try {
      const job = await this.prepareActivityImportJob(
        account,
        activity,
        bulkImport,
      );
      if (!job) return;
      await this.activityImportQueue.add(job.name, job.data, job.opts);
    } catch (error) {
      this.logger.error(
        `Failed to add activity import job for ${activity.externalId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async addActivityImportJobs(
    account: ProviderAccount,
    activities: ImportedActivity[],
    bulkImport = false,
  ): Promise<void> {
    try {
      const sortedActivities = [...activities].sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      );

      const jobsToAdd: NonNullable<
        Awaited<ReturnType<typeof this.prepareActivityImportJob>>
      >[] = [];

      for (const activity of sortedActivities) {
        const job = await this.prepareActivityImportJob(
          account,
          activity,
          bulkImport,
        );
        if (job) jobsToAdd.push(job);
      }

      if (jobsToAdd.length === 0) {
        return;
      }

      await this.activityImportQueue.addBulk(jobsToAdd);

      this.logger.log(
        `Added ${jobsToAdd.length} activity import jobs for provider ${account.provider}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to add activity import jobs for provider ${account.provider}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async addActivityProcessingJob(
    eventActivityId: number,
    eventId: number,
    bulkImport = false,
  ): Promise<void> {
    try {
      await this.activityProcessingQueue.add('process', {
        eventActivityId,
        eventId,
        bulkImport,
      });
    } catch (error) {
      this.logger.error(
        `Failed to add activity processing job for eventActivityId ${eventActivityId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getQueueStats() {
    const [importStats, processingStats] = await Promise.all([
      this.activityImportQueue.getJobCounts(),
      this.activityProcessingQueue.getJobCounts(),
    ]);

    return {
      'activity-import': importStats,
      'activity-processing': processingStats,
    };
  }
}
