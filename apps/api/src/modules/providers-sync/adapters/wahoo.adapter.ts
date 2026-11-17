import { Injectable } from '@nestjs/common';

import {
  ConnectorProvider,
  MetricType,
  SportType,
} from '@openathlete/database';
import type { NormalizedWorkout } from '@openathlete/shared';
import {
  calculateWorkoutDuration,
  mapPrismaWorkoutToDto,
} from '@openathlete/shared';

import { PrismaService } from '../../prisma/services/prisma.service';
import type { SuuntoZone } from '../mapping/suunto-guide.mapper';
import { mapWorkoutDtoToWahooPlan } from '../mapping/wahoo-plan.mapper';
import type { WahooPlan } from '../mapping/wahoo-plan.mapper';
import type {
  DeletePlannedWorkoutInput,
  ProviderAdapter,
  UpsertPlannedWorkoutInput,
  UpsertPlannedWorkoutResult,
} from '../provider-adapter.interface';
import { WahooProviderService } from '../providers/wahoo.provider.service';

const REFERENCE_METRICS: MetricType[] = [
  MetricType.FTP_CYCLING,
  MetricType.CRITICAL_POWER_CYCLING,
  MetricType.HR_MAX,
  MetricType.HR_REST,
  MetricType.HR_RESERVE,
];
const CYCLING_SPORTS = new Set<SportType>([
  SportType.CYCLING,
  SportType.MOUNTAIN_BIKE_RIDE,
  SportType.GRAVEL_RIDE,
  SportType.E_BIKE_RIDE,
  SportType.E_MOUNTAIN_BIKE_RIDE,
  SportType.VIRTUAL_RIDE,
]);
const WAHOO_EPOCH = Date.UTC(2020, 0, 1);
const stableToken = (athleteId: number, workoutId: number) =>
  `openathlete-${athleteId}-${workoutId}`;

interface WahooRecord {
  id?: string | number;
  external_id?: string;
  workout_token?: string;
  workout_summary?: unknown;
  [key: string]: unknown;
}
interface WahooListResponse {
  plans?: WahooRecord[];
  workouts?: WahooRecord[];
  data?: WahooRecord[];
  total?: number;
  meta?: { pagination?: { total?: number } };
}
const records = (
  value: WahooListResponse | WahooRecord[],
  key: 'plans' | 'workouts',
): WahooRecord[] =>
  Array.isArray(value)
    ? value
    : Array.isArray(value[key])
      ? value[key]!
      : Array.isArray(value.data)
        ? value.data
        : [];
const idOf = (value: WahooRecord | null | undefined): string | null =>
  value?.id === undefined || value.id === null ? null : String(value.id);
const statusCode = (error: unknown): number | undefined =>
  error instanceof Error &&
  'status' in error &&
  typeof error.status === 'number'
    ? error.status
    : undefined;

@Injectable()
export class WahooAdapter implements ProviderAdapter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wahooProviderService: WahooProviderService,
  ) {}

  getProvider(): 'wahoo' {
    return 'wahoo';
  }

  canExport(normalized: NormalizedWorkout): boolean {
    return CYCLING_SPORTS.has(normalized.sport);
  }

  private findAccount(athleteId: number) {
    return this.prisma.providerAccount.findFirst({
      where: { athleteId, provider: ConnectorProvider.WAHOO, status: 'active' },
    });
  }

  private async buildPlan(
    input: UpsertPlannedWorkoutInput,
  ): Promise<{ plan: WahooPlan; estimatedSeconds: number }> {
    const workout = await this.prisma.workout.findUnique({
      where: { workoutId: input.workoutId },
      include: {
        steps: {
          include: {
            targets: true,
            repeatBlock: {
              include: {
                childSteps: {
                  include: { targets: true },
                  orderBy: { orderIndex: 'asc' },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!workout) throw new Error('Workout not found');
    const [metrics, zones] = await Promise.all([
      this.prisma.athleteMetric.findMany({
        where: { athleteId: input.athleteId, type: { in: REFERENCE_METRICS } },
        orderBy: [{ type: 'asc' }, { date: 'desc' }],
        distinct: ['type'],
        select: { type: true, value: true },
      }),
      this.prisma.trainingZone.findMany({
        where: { athleteId: input.athleteId },
        select: {
          trainingZoneId: true,
          type: true,
          values: { select: { min: true, max: true, sports: true } },
        },
      }),
    ]);
    const dto = mapPrismaWorkoutToDto(workout);
    const metricValues = Object.fromEntries(
      metrics.map((metric) => [metric.type, { value: metric.value }]),
    );
    const estimatedSeconds = calculateWorkoutDuration(
      dto,
      metricValues,
      input.normalized.sport,
    );
    if (estimatedSeconds === null || estimatedSeconds <= 0) {
      throw new Error(
        'Wahoo schedule duration cannot be estimated from this workout and athlete metrics',
      );
    }
    return {
      plan: mapWorkoutDtoToWahooPlan(
        dto,
        input.normalized.sport,
        input.normalized.title ?? null,
        input.normalized.sport === SportType.VIRTUAL_RIDE,
        { metrics: metricValues, zones: zones as SuuntoZone[] },
        input.normalized.description,
      ),
      estimatedSeconds,
    };
  }

  private async listAll(
    account: NonNullable<Awaited<ReturnType<WahooAdapter['findAccount']>>>,
    collection: 'plans' | 'workouts',
  ): Promise<WahooRecord[]> {
    const all: WahooRecord[] = [];
    for (let page = 1; ; page++) {
      const result = await this.wahooProviderService.makeApiRequest<
        WahooListResponse | WahooRecord[]
      >(account, 'GET', `/v1/${collection}?page=${page}&per_page=30`);
      const batch = records(result, collection);
      all.push(...batch);
      const total = Array.isArray(result)
        ? undefined
        : (result.total ?? result.meta?.pagination?.total);
      if (
        !batch.length ||
        (total !== undefined && all.length >= total) ||
        batch.length < 30
      )
        break;
    }
    return all;
  }

  private async findPlan(
    account: NonNullable<Awaited<ReturnType<WahooAdapter['findAccount']>>>,
    token: string,
  ): Promise<WahooRecord | null> {
    try {
      const result = await this.wahooProviderService.makeApiRequest<
        WahooListResponse | WahooRecord[]
      >(account, 'GET', `/v1/plans?external_id=${encodeURIComponent(token)}`);
      return (
        records(result, 'plans').find((plan) => plan.external_id === token) ??
        null
      );
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
    return null;
  }

  private async findScheduled(
    account: NonNullable<Awaited<ReturnType<WahooAdapter['findAccount']>>>,
    token: string,
  ): Promise<WahooRecord | null> {
    return (
      (await this.listAll(account, 'workouts')).find(
        (item) => item.workout_token === token,
      ) ?? null
    );
  }

  private async summaryExists(
    account: NonNullable<Awaited<ReturnType<WahooAdapter['findAccount']>>>,
    workoutId: string,
  ): Promise<boolean> {
    try {
      const record =
        await this.wahooProviderService.makeApiRequest<WahooRecord>(
          account,
          'GET',
          `/v1/workouts/${encodeURIComponent(workoutId)}`,
        );
      return Boolean(record.workout_summary);
    } catch (error) {
      if (statusCode(error) === 404) return false;
      throw error;
    }
  }

  async upsertPlannedWorkout(
    input: UpsertPlannedWorkoutInput,
  ): Promise<UpsertPlannedWorkoutResult> {
    if (!this.canExport(input.normalized))
      throw new Error('Wahoo structured plans support cycling workouts only');
    const account = await this.findAccount(input.athleteId);
    if (!account) throw new Error('No active Wahoo account found for athlete');
    const { plan, estimatedSeconds } = await this.buildPlan(input);
    const token = stableToken(input.athleteId, input.workoutId);
    const todayCode = Math.floor(
      (Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ) -
        WAHOO_EPOCH) /
        86400000,
    );
    const dayOffset =
      Math.floor(
        (Date.parse(`${input.date}T00:00:00Z`) - WAHOO_EPOCH) / 86400000,
      ) - todayCode;
    if (dayOffset < 0 || dayOffset > 6)
      throw new Error(
        'Wahoo only exposes planned workouts from today through six days ahead',
      );
    const previousPlanId = input.previousExternalId;
    const previousWorkoutId = input.previousScheduleId;
    let oldSchedule = previousWorkoutId
      ? { id: previousWorkoutId }
      : await this.findScheduled(account, token);
    if (oldSchedule?.id) {
      try {
        const known =
          await this.wahooProviderService.makeApiRequest<WahooRecord>(
            account,
            'GET',
            `/v1/workouts/${encodeURIComponent(String(oldSchedule.id))}`,
          );
        if (known.workout_token !== token)
          throw new Error(
            'Refusing to modify a Wahoo workout not created by OpenAthlete',
          );
      } catch (error) {
        if (statusCode(error) === 404) oldSchedule = null;
        else throw error;
      }
    }
    if (
      oldSchedule?.id &&
      (await this.summaryExists(account, String(oldSchedule.id)))
    ) {
      throw new Error('Wahoo workout is completed and cannot be updated');
    }
    let savedPlan = previousPlanId
      ? await this.findPlanById(account, previousPlanId)
      : await this.findPlan(account, token);
    if (savedPlan && savedPlan.external_id !== token)
      throw new Error(
        'Refusing to modify a Wahoo plan not created by OpenAthlete',
      );
    const planData = {
      'plan[file]': `data:application/json;base64,${Buffer.from(JSON.stringify(plan)).toString('base64')}`,
      'plan[filename]': `${token}.json`,
      'plan[external_id]': token,
      'plan[provider_updated_at]': new Date().toISOString(),
    };
    if (savedPlan?.id) {
      await this.wahooProviderService.makeApiRequest(
        account,
        'PUT',
        `/v1/plans/${encodeURIComponent(String(savedPlan.id))}`,
        planData,
      );
    } else {
      const created =
        await this.wahooProviderService.makeApiRequest<WahooRecord>(
          account,
          'POST',
          '/v1/plans',
          planData,
        );
      const createdId = idOf(created);
      savedPlan = createdId
        ? { id: createdId }
        : await this.findPlan(account, token);
    }
    if (!savedPlan?.id)
      throw new Error('Wahoo did not return or expose the saved plan id');

    const dayCode = Math.floor(
      (Date.parse(`${input.date}T00:00:00Z`) - WAHOO_EPOCH) / 86400000,
    );
    const start = new Date(`${input.date}T12:00:00Z`).toISOString();
    const durationMinutes = Math.ceil(estimatedSeconds / 60);
    const workoutData = {
      'workout[name]': plan.header.name,
      'workout[workout_token]': token,
      'workout[workout_type_id]':
        input.normalized.sport === SportType.VIRTUAL_RIDE ? 12 : 0,
      'workout[starts]': start,
      'workout[day_code]': dayCode,
      'workout[minutes]': durationMinutes,
      'workout[plan_id]': String(savedPlan.id),
    };
    let schedule: WahooRecord;
    if (oldSchedule?.id) {
      schedule = await this.wahooProviderService.makeApiRequest<WahooRecord>(
        account,
        'PUT',
        `/v1/workouts/${encodeURIComponent(String(oldSchedule.id))}`,
        workoutData,
      );
    } else {
      schedule = await this.wahooProviderService.makeApiRequest<WahooRecord>(
        account,
        'POST',
        '/v1/workouts',
        workoutData,
      );
      if (!idOf(schedule))
        schedule = (await this.findScheduled(account, token)) ?? schedule;
    }
    const scheduleId = idOf(schedule) ?? String(oldSchedule?.id ?? '');
    if (!scheduleId)
      throw new Error(
        'Wahoo did not return or expose the scheduled workout id',
      );
    return { externalId: String(savedPlan.id), scheduleId };
  }

  async deletePlannedWorkout(input: DeletePlannedWorkoutInput): Promise<void> {
    const account = await this.findAccount(input.athleteId);
    if (!account || !input.externalId) return;
    const tokenPrefix = `openathlete-${input.athleteId}-`;
    const planRecord = await this.findPlanById(account, input.externalId);
    if (
      planRecord &&
      !String(planRecord.external_id ?? '').startsWith(tokenPrefix)
    )
      return;
    const token = planRecord ? String(planRecord.external_id) : null;
    const workout = input.scheduleId
      ? { id: input.scheduleId }
      : token
        ? await this.findScheduled(account, token)
        : null;
    if (workout?.id) {
      let known: WahooRecord;
      try {
        known = await this.wahooProviderService.makeApiRequest<WahooRecord>(
          account,
          'GET',
          `/v1/workouts/${encodeURIComponent(String(workout.id))}`,
        );
      } catch (error) {
        if (statusCode(error) === 404) known = {};
        else throw error;
      }
      const ownedToken = known.workout_token;
      if (ownedToken && !ownedToken.startsWith(tokenPrefix)) return;
      if (token && ownedToken !== token) return;
      if (!token && !ownedToken) return;
      if (!ownedToken) return;
      if (await this.summaryExists(account, String(workout.id))) return;
      try {
        await this.wahooProviderService.makeApiRequest(
          account,
          'DELETE',
          `/v1/workouts/${encodeURIComponent(String(workout.id))}`,
        );
      } catch (error) {
        if (statusCode(error) !== 404) throw error;
      }
    }
    if (!planRecord) return;
    try {
      await this.wahooProviderService.makeApiRequest(
        account,
        'DELETE',
        `/v1/plans/${encodeURIComponent(String(planRecord.id))}`,
      );
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
  }

  private async findPlanById(
    account: NonNullable<Awaited<ReturnType<WahooAdapter['findAccount']>>>,
    id: string,
  ): Promise<WahooRecord | null> {
    try {
      return await this.wahooProviderService.makeApiRequest<WahooRecord>(
        account,
        'GET',
        `/v1/plans/${encodeURIComponent(id)}`,
      );
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }
}
