import { AxiosError } from 'axios';
import { createHash } from 'node:crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';

import type { NormalizedWorkout } from '@openathlete/shared';

import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/services/prisma.service';
import {
  CorosAdapter,
  GarminAdapter,
  SuuntoAdapter,
  WahooAdapter,
} from './adapters';
import { mapToCoros, mapToGarmin, mapToSuunto } from './mapping';
import type { ProviderAdapter } from './provider-adapter.interface';
import { ProviderSyncLockService } from './provider-sync-lock.service';

type ProviderKey = 'garmin' | 'suunto' | 'coros' | 'wahoo';
type ProviderEnum = 'GARMIN' | 'SUUNTO' | 'COROS' | 'WAHOO';

function providerKeyToEnum(provider: ProviderKey): ProviderEnum {
  switch (provider) {
    case 'garmin':
      return 'GARMIN';
    case 'suunto':
      return 'SUUNTO';
    case 'coros':
      return 'COROS';
    case 'wahoo':
      return 'WAHOO';
  }
}

@Injectable()
export class ProviderExportService {
  private readonly logger = new Logger(ProviderExportService.name);

  private readonly adapters: Record<ProviderKey, ProviderAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    garminAdapter: GarminAdapter,
    suuntoAdapter: SuuntoAdapter,
    corosAdapter: CorosAdapter,
    wahooAdapter: WahooAdapter,
    private readonly exportLock: ProviderSyncLockService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {
    this.adapters = {
      garmin: garminAdapter,
      suunto: suuntoAdapter,
      coros: corosAdapter,
      wahoo: wahooAdapter,
    } as const;
  }

  private computeHash(date: string, normalized: NormalizedWorkout): string {
    const json = JSON.stringify({ date, normalized });
    return createHash('sha256').update(json).digest('hex');
  }

  private mapPayload(
    provider: ProviderKey,
    date: string,
    normalized: NormalizedWorkout,
  ) {
    switch (provider) {
      case 'garmin':
        return mapToGarmin(date, normalized);
      case 'suunto':
        return mapToSuunto(date, normalized);
      case 'coros':
        return mapToCoros(date, normalized);
      case 'wahoo':
        return { date, ...normalized };
    }
  }

  async upsertPlannedExport(params: {
    athleteId: number;
    provider: ProviderKey;
    workoutId: number;
    date: string; // YYYY-MM-DD (UTC)
    normalized: NormalizedWorkout;
    previousExternalId?: string;
  }): Promise<{ skipped: boolean; externalId?: string }> {
    return this.exportLock.withLock(params.workoutId, (assertHeld) =>
      this.upsertPlannedExportLocked(params, assertHeld),
    );
  }

  private async upsertPlannedExportLocked(
    params: {
      athleteId: number;
      provider: ProviderKey;
      workoutId: number;
      date: string;
      normalized: NormalizedWorkout;
      previousExternalId?: string;
    },
    assertHeld: () => Promise<void>,
  ): Promise<{ skipped: boolean; externalId?: string }> {
    await assertHeld();
    const { athleteId, provider, workoutId, date, normalized } = params;
    const currentWorkout = await this.prisma.workout.findUnique({
      where: { workoutId },
      select: {
        eventTraining: {
          select: { event: { select: { athleteId: true, startDate: true } } },
        },
      },
    });
    const currentEvent = currentWorkout?.eventTraining.event;
    const currentDate = currentEvent?.startDate
      ? new Date(currentEvent.startDate)
      : null;
    currentDate?.setUTCHours(0, 0, 0, 0);
    if (
      !currentEvent ||
      currentEvent.athleteId !== athleteId ||
      currentDate?.toISOString().slice(0, 10) !== date
    ) {
      return { skipped: true };
    }

    const providerEnum = providerKeyToEnum(provider);
    const plannedDate = new Date(`${date}T00:00:00.000Z`);
    const adapter = this.adapters[provider];

    const contentHash = this.computeHash(date, normalized);
    const payload = this.mapPayload(provider, date, normalized);

    const staleExports = await this.prisma.providerWorkoutExport.findMany({
      where: {
        athleteId: athleteId,
        provider: providerEnum,
        workoutId: workoutId,
        NOT: { plannedDate: plannedDate },
      },
    });

    // The session moved to another day: remove it from the old one
    for (const stale of staleExports) {
      if (adapter.deletePlannedWorkout) {
        try {
          await assertHeld();
          await adapter.deletePlannedWorkout({
            athleteId,
            externalId: stale.externalId,
            scheduleId: stale.scheduleId,
            date: stale.plannedDate.toISOString().split('T')[0],
          });
        } catch (err) {
          this.logger.warn(
            `Failed to delete stale planned workout for provider ${provider} workout ${workoutId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      }

      await assertHeld();
      await this.prisma.providerWorkoutExport.deleteMany({
        where: {
          providerWorkoutExportId: stale.providerWorkoutExportId,
        },
      });
    }

    // A session described in text only has nothing a watch could follow
    if (
      normalized.steps.length === 0 ||
      adapter.canExport?.(normalized) === false
    ) {
      this.logger.debug(
        `Skip export (nothing to send) athlete=${athleteId} provider=${provider} workout=${workoutId} date=${date}`,
      );
      return { skipped: true };
    }

    const key = {
      athleteId_provider_workoutId_plannedDate: {
        athleteId: athleteId,
        provider: providerEnum,
        workoutId: workoutId,
        plannedDate: plannedDate,
      },
    };

    // Unchanged since its last successful export: nothing to send. Checked
    // before the record is marked pending, which would hide the success
    const existing = await this.prisma.providerWorkoutExport.findUnique({
      where: key,
    });
    if (
      existing?.status === 'success' &&
      existing.contentHash === contentHash
    ) {
      this.logger.debug(
        `Skip export (unchanged) athlete=${athleteId} provider=${provider} workout=${workoutId} date=${date}`,
      );
      return { skipped: true, externalId: existing.externalId ?? undefined };
    }

    await assertHeld();
    const record = await this.prisma.providerWorkoutExport.upsert({
      where: key,
      create: {
        athleteId: athleteId,
        provider: providerEnum,
        workoutId: workoutId,
        plannedDate: plannedDate,
        status: 'pending',
        contentHash: contentHash,
        rawPayload: payload as object,
      },
      update: {
        contentHash: contentHash,
        rawPayload: payload as object,
        status: 'pending',
        errorCode: null,
        errorMessage: null,
      },
    });

    try {
      const previousScheduleId = record.scheduleId ?? undefined;

      await assertHeld();
      // shortcut: a provider can create remotely before lease loss, so retries may repeat a call; reconcile provider state if idempotency becomes available.
      const result = await adapter.upsertPlannedWorkout({
        athleteId,
        workoutId,
        date,
        normalized,
        previousExternalId: record.externalId ?? params.previousExternalId,
        previousScheduleId,
      });

      // updateMany: a concurrent deletion of the export is not an error
      await assertHeld();
      await this.prisma.providerWorkoutExport.updateMany({
        where: {
          providerWorkoutExportId: record.providerWorkoutExportId,
        },
        data: {
          externalId: result.externalId,
          status: 'success',
          lastSyncAt: new Date(),
          attemptCount: { increment: 1 },
          scheduleId: result.scheduleId ?? null,
        },
      });
      await assertHeld();
      await this.analytics?.captureForAthlete(
        athleteId,
        'workout_sent_to_device',
        { provider: providerEnum, is_update: Boolean(record.externalId) },
      );

      return { skipped: false, externalId: result.externalId };
    } catch (err) {
      await assertHeld();
      await this.prisma.providerWorkoutExport.updateMany({
        where: {
          providerWorkoutExportId: record.providerWorkoutExportId,
        },
        data: {
          status: 'failed',
          lastSyncAt: new Date(),
          attemptCount: { increment: 1 },
          errorCode: err instanceof AxiosError ? err.code : null,
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        },
      });
      throw err;
    }
  }

  async deleteExportsForWorkout(params: { workoutId: number }): Promise<void>;
  async deleteExportsForWorkout<T>(
    params: { workoutId: number },
    afterDelete: () => Promise<T>,
  ): Promise<T>;
  async deleteExportsForWorkout<T>(
    params: { workoutId: number },
    afterDelete?: () => Promise<T>,
  ): Promise<void | T> {
    return this.exportLock.withLock(params.workoutId, async (assertHeld) => {
      await assertHeld();
      const exports = await this.prisma.providerWorkoutExport.findMany({
        where: { workoutId: params.workoutId },
      });

      for (const exp of exports) {
        const providerKey = exp.provider.toLowerCase() as ProviderKey;
        const adapter = this.adapters[providerKey];

        if (adapter?.deletePlannedWorkout) {
          try {
            await assertHeld();
            await adapter.deletePlannedWorkout({
              athleteId: exp.athleteId,
              externalId: exp.externalId,
              scheduleId: exp.scheduleId,
              date: exp.plannedDate.toISOString().split('T')[0],
            });
          } catch (err) {
            this.logger.warn(
              `Failed to delete planned workout for provider ${exp.provider} workout ${exp.workoutId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }
        }
      }

      await assertHeld();
      await this.prisma.providerWorkoutExport.deleteMany({
        where: { workoutId: params.workoutId },
      });
      await assertHeld();
      return afterDelete ? afterDelete() : undefined;
    });
  }
}
