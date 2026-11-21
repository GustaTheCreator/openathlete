import axios, { isAxiosError } from 'axios';
import * as crypto from 'node:crypto';

import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import {
  ConnectorProvider,
  EventActivity,
  EventType,
  Prisma,
  ProviderAccount,
  SportType,
} from '@openathlete/database';
import { ActivityStream, ApiEnvSchemaType } from '@openathlete/shared';

import { streamUpdate } from 'src/modules/core/helpers/activity-corrections';

import { ActivityFileParserService } from '../../core/helpers/activity-file-parser.service';
import { compressActivityStream } from '../../core/helpers/activity-stream';
import { fitSport } from '../../core/helpers/manual-fit-import';
import {
  roundCadence,
  roundDistance,
  roundEnergy,
  roundHeartrate,
  roundPower,
  roundSpeed,
} from '../../core/helpers/round-activity-values';
import { PrismaService } from '../../prisma/services/prisma.service';
import { QueueService } from '../../queue/queue.service';
import type { ProviderFullImportJobData } from '../../queue/queue.service';
import { BaseProviderService, OAuthConfig } from '../base';
import {
  ImportOptions,
  ImportResult,
  ImportedActivity,
  ProviderImportCapability,
} from '../base/provider-import.interface';
import { providerRedirectUri } from '../base/provider-urls';
import { ProviderRateLimitError } from '../errors/provider-rate-limit.error';

const API_BASE = 'https://api.wahooligan.com/v1';
const AUTH_BASE = 'https://api.wahooligan.com/oauth';
const SCOPES = [
  'user_read',
  'workouts_read',
  'workouts_write',
  'plans_read',
  'plans_write',
];
const PAGE_SIZE = 30;
const SYNC_WINDOW_DAYS = 7;
const MAX_FIT_BYTES = 64 * 1024 * 1024;
const REFRESH_SKEW_MS = 30_000;

type WahooTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

type WahooWorkout = {
  id: number | string;
  name?: string;
  starts?: string;
  workout_type_id?: number;
  workout_summary?: {
    id?: number | string;
    name?: string;
    distance_accum?: number;
    duration_active_accum?: number;
    duration_total_accum?: number;
    ascent_accum?: number;
    calories_accum?: number;
    heart_rate_avg?: number;
    heart_rate_max?: number;
    avg_heart_rate?: number;
    max_heart_rate?: number;
    power_avg?: number;
    power_max?: number;
    avg_power?: number;
    cadence_avg?: number;
    avg_cadence?: number;
    speed_avg?: number;
    avg_speed?: number;
    file?: { url?: string };
  } | null;
  [key: string]: unknown;
};

function workoutList(value: unknown): {
  workouts: WahooWorkout[];
  total?: number;
} {
  const response = value as {
    workouts?: WahooWorkout[];
    data?: WahooWorkout[] | { workouts?: WahooWorkout[] };
    total?: number;
    meta?: { pagination?: { total?: number } };
  };
  const workouts = Array.isArray(response?.workouts)
    ? response.workouts
    : Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.data?.workouts)
        ? response.data.workouts
        : [];
  return {
    workouts,
    total: response?.total ?? response?.meta?.pagination?.total,
  };
}

function workoutFromResponse(value: unknown): WahooWorkout | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Record<string, unknown>;
  const data =
    response.data && typeof response.data === 'object'
      ? (response.data as Record<string, unknown>)
      : undefined;
  const candidate = response.workout ?? data?.workout ?? data ?? value;
  return candidate && typeof candidate === 'object'
    ? (candidate as WahooWorkout)
    : null;
}

function wahooSport(workoutTypeId: unknown): SportType {
  const id = finite(workoutTypeId);
  return id !== undefined &&
    [0, 11, 12, 13, 14, 15, 16, 61, 64, 68].includes(id)
    ? SportType.CYCLING
    : SportType.OTHER;
}

function validVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function rateLimitDelay(error: unknown): number | undefined {
  if (!isAxiosError(error)) return undefined;
  const reset = Number(error.response?.headers?.['x-ratelimit-reset']);
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined;
}

@Injectable()
export class WahooProviderService
  extends BaseProviderService
  implements ProviderImportCapability
{
  protected readonly provider = ConnectorProvider.WAHOO;

  protected get oauthConfig(): OAuthConfig {
    return {
      authorizationUrl: `${AUTH_BASE}/authorize`,
      tokenUrl: `${AUTH_BASE}/token`,
      clientId: this.configService.get('WAHOO_CLIENT_ID') || '',
      // Wahoo's public PKCE app has no client secret.
      clientSecret: '',
      redirectUri: providerRedirectUri(
        this.configService.get('WAHOO_REDIRECT_URI'),
        this.configService.get('APP_URL'),
        'wahoo',
      ),
      scopes: SCOPES,
    };
  }

  constructor(
    prisma: PrismaService,
    configService: ConfigService<ApiEnvSchemaType, true>,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    private readonly activityFileParserService: ActivityFileParserService,
  ) {
    super(prisma, configService);
  }

  getAuthorizationUriWithPKCE(): {
    uri: string;
    codeVerifier: string;
    state: string;
  } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const { clientId, redirectUri } = this.oauthConfig;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    return {
      uri: `${AUTH_BASE}/authorize?${params.toString()}`,
      codeVerifier: verifier,
      state,
    };
  }

  private async requestToken(
    form: Record<string, string>,
  ): Promise<WahooTokenResponse> {
    try {
      const { data } = await axios.post<WahooTokenResponse>(
        this.oauthConfig.tokenUrl,
        new URLSearchParams({
          client_id: this.oauthConfig.clientId,
          ...form,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 30_000,
        },
      );
      if (
        typeof data?.access_token !== 'string' ||
        !data.access_token.trim() ||
        typeof data.refresh_token !== 'string' ||
        !data.refresh_token.trim() ||
        typeof data.expires_in !== 'number' ||
        !Number.isFinite(data.expires_in) ||
        data.expires_in <= 0 ||
        (data.scope !== undefined && typeof data.scope !== 'string')
      ) {
        throw new Error('Wahoo returned an incomplete token response');
      }
      return data;
    } catch (error) {
      if (isAxiosError(error)) {
        const status = error.response?.status;
        const invalidGrant =
          status === 400 &&
          (error.response?.data as { error?: unknown } | undefined)?.error ===
            'invalid_grant';
        throw Object.assign(
          new Error(`Wahoo token request failed (${status ?? 'network'})`),
          { status, invalidGrant },
        );
      }
      throw error;
    }
  }

  async connect(
    code: string,
    codeVerifier: string,
    athleteId: number,
  ): Promise<ProviderAccount> {
    if (!validVerifier(codeVerifier)) {
      throw new Error('Invalid Wahoo code verifier');
    }
    const tokens = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.oauthConfig.redirectUri,
    });
    if (tokens.scope) {
      const granted = new Set(tokens.scope.split(/\s+/).filter(Boolean));
      if (SCOPES.some((scope) => !granted.has(scope))) {
        throw new Error(
          'Wahoo did not grant all requested integration permissions',
        );
      }
    }
    const response = await axios
      .get<{ id?: number | string }>(`${API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
        },
        timeout: 30_000,
      })
      .catch((error: unknown) => {
        throw this.safeApiError(error, 'user lookup');
      });
    if (response.data?.id === undefined || response.data.id === null) {
      throw new Error('Wahoo user response did not contain an id');
    }
    const account = await this.saveProviderAccount({
      athleteId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      oauthCodeVerifier: codeVerifier,
      expiresIn: tokens.expires_in,
      scopes: tokens.scope ?? SCOPES.join(' '),
      externalUserId: String(response.data.id),
    });
    return account;
  }

  async disconnect(account: ProviderAccount): Promise<boolean> {
    let remoteRevoked = false;
    try {
      await this.makeApiRequest(account, 'DELETE', '/v1/permissions');
      remoteRevoked = true;
    } catch (error) {
      const status = (error as Error & { status?: number })?.status;
      this.logger.warn(
        `Wahoo remote disconnect failed for account ${account.providerAccountId} (${status ?? 'network'}); local access was revoked`,
      );
    } finally {
      await this.prisma.providerAccount.updateMany({
        where: {
          providerAccountId: account.providerAccountId,
          status: 'active',
          oauthCodeVerifier: account.oauthCodeVerifier,
        },
        data: { status: 'revoked', disconnectedByUser: true },
      });
    }
    return remoteRevoked;
  }

  private safeApiError(error: unknown, action: string): Error {
    if (isAxiosError(error)) {
      if (error.response?.status === 429) {
        return new ProviderRateLimitError('Wahoo', rateLimitDelay(error));
      }
      if (error.response?.status === 401)
        return Object.assign(
          new Error(`Wahoo authorization failed during ${action}`),
          { status: 401 },
        );
      return Object.assign(
        new Error(
          `Wahoo ${action} failed (${error.response?.status ?? 'network'})`,
        ),
        { status: error.response?.status },
      );
    }
    return error instanceof Error ? error : new Error(`Wahoo ${action} failed`);
  }

  private async refreshForRequest(account: ProviderAccount): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    response: WahooTokenResponse | null;
  }> {
    if (account.status !== 'active')
      throw new Error('Wahoo account is not active');
    if (
      account.expiresAt &&
      account.expiresAt.getTime() > Date.now() + REFRESH_SKEW_MS
    ) {
      return {
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        expiresAt: account.expiresAt,
        response: null,
      };
    }
    if (!account.refreshToken || !account.oauthCodeVerifier) {
      throw new Error(
        'Wahoo account cannot refresh without its OAuth verifier',
      );
    }

    const refreshed = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      code_verifier: account.oauthCodeVerifier,
    });
    return {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      response: refreshed,
    };
  }

  async makeApiRequest<T>(
    account: ProviderAccount,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: Record<string, unknown>,
  ): Promise<T> {
    if (!/^\/v1\/[A-Za-z0-9/_?&=.%~-]*$/.test(path) || path.includes('..')) {
      throw new Error('Wahoo API path must be relative to /v1');
    }
    if (account.status !== 'active')
      throw new Error('Wahoo account is not active');

    const isFresh = Boolean(
      account.expiresAt &&
      account.expiresAt.getTime() > Date.now() + REFRESH_SKEW_MS,
    );
    let current = account;
    if (!isFresh) {
      // Serialize refresh across processes and commit the new pair before an
      // API request can invalidate Wahoo's previous pair.
      const refreshResult = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(119657734, ${account.providerAccountId}::int)`;
          const latest = await tx.providerAccount.findUnique({
            where: { providerAccountId: account.providerAccountId },
          });
          if (!latest || latest.status !== 'active')
            throw new Error('Wahoo account is not active');
          if (
            latest.expiresAt &&
            latest.expiresAt.getTime() > Date.now() + REFRESH_SKEW_MS
          ) {
            return { account: latest, rejected: false };
          }
          const observedGeneration = {
            providerAccountId: latest.providerAccountId,
            status: 'active' as const,
            accessToken: latest.accessToken,
            refreshToken: latest.refreshToken,
            oauthCodeVerifier: latest.oauthCodeVerifier,
          };
          let refreshed: Awaited<ReturnType<typeof this.refreshForRequest>>;
          try {
            refreshed = await this.refreshForRequest(latest);
          } catch (error) {
            const refreshError = error as Error & {
              status?: number;
              invalidGrant?: boolean;
            };
            if (refreshError.status === 401 || refreshError.invalidGrant) {
              const revoked = await tx.providerAccount.updateMany({
                where: observedGeneration,
                data: { status: 'revoked' },
              });
              if (revoked.count > 0) {
                // Return so Prisma commits revocation; throwing here rolls it back.
                return { account: latest, rejected: true };
              }
              const reconnected = await tx.providerAccount.findUnique({
                where: { providerAccountId: latest.providerAccountId },
              });
              if (reconnected?.status === 'active') {
                return { account: reconnected, rejected: false };
              }
              return { account: latest, rejected: true };
            }
            throw error;
          }
          const updated = await tx.providerAccount.updateMany({
            where: observedGeneration,
            data: {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
            },
          });
          if (updated.count > 0) {
            return {
              account: {
                ...latest,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: refreshed.expiresAt,
              },
              rejected: false,
            };
          }
          const reconnected = await tx.providerAccount.findUnique({
            where: { providerAccountId: latest.providerAccountId },
          });
          if (reconnected?.status === 'active') {
            return { account: reconnected, rejected: false };
          }
          return { account: latest, rejected: true };
        },
        { maxWait: 10_000, timeout: 45_000 },
      );
      if (refreshResult.rejected) {
        throw new Error('Wahoo refresh was rejected; reconnect the account');
      }
      current = refreshResult.account;
    }

    let retries = 0;
    while (true) {
      const failedToken = current.accessToken;
      try {
        return await this.requestWithToken<T>(failedToken, method, path, data);
      } catch (error) {
        if ((error as Error & { status?: number })?.status !== 401) throw error;
        let latest = await this.prisma.providerAccount.findUnique({
          where: { providerAccountId: current.providerAccountId },
        });
        if (latest?.status === 'active' && latest.accessToken !== failedToken) {
          if (retries >= 2)
            throw new Error('Wahoo credentials changed; retry the request');
          current = latest;
          retries++;
          continue;
        }
        const revoked = await this.prisma.providerAccount.updateMany({
          where: {
            providerAccountId: current.providerAccountId,
            status: 'active',
            accessToken: failedToken,
            refreshToken: current.refreshToken,
            oauthCodeVerifier: current.oauthCodeVerifier,
          },
          data: { status: 'revoked' },
        });
        if (revoked.count > 0) {
          throw new Error('Wahoo authorization failed; reconnect the account');
        }
        latest = await this.prisma.providerAccount.findUnique({
          where: { providerAccountId: current.providerAccountId },
        });
        if (
          latest?.status === 'active' &&
          latest.accessToken !== failedToken &&
          retries < 2
        ) {
          current = latest;
          retries++;
          continue;
        }
        throw new Error(
          'Wahoo authorization failed or credentials changed; retry the request',
        );
      }
    }
  }

  private async requestWithToken<T>(
    accessToken: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: Record<string, unknown>,
  ): Promise<T> {
    const formData = data
      ? new URLSearchParams(
          Object.entries(data).flatMap(([key, value]) => {
            if (value === undefined || value === null) return [];
            if (!['string', 'number', 'boolean'].includes(typeof value)) {
              throw new Error('Wahoo form values must be primitive');
            }
            return [[key, String(value)]];
          }),
        ).toString()
      : undefined;
    try {
      const response = await axios.request<T>({
        method,
        url: `https://api.wahooligan.com${path}`,
        data: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(formData && {
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        },
        timeout: 30_000,
      });
      return response.data;
    } catch (error) {
      throw this.safeApiError(error, path);
    }
  }

  private toImportedActivity(
    workout: WahooWorkout,
    athleteId: number,
  ): ImportedActivity | null {
    const summary = workout.workout_summary;
    const startDate = workout.starts ? new Date(workout.starts) : null;
    if (!summary || !startDate || !Number.isFinite(startDate.getTime()))
      return null;
    const duration =
      finite(summary.duration_active_accum) ??
      finite(summary.duration_total_accum) ??
      0;
    const { file: _file, ...safeSummary } = summary;
    return {
      externalId: `wahoo:${athleteId}:${String(workout.id)}`,
      name: summary.name || workout.name || 'Wahoo activity',
      startDate,
      endDate: new Date(startDate.getTime() + duration * 1000),
      sport: wahooSport(workout.workout_type_id),
      distance: finite(summary.distance_accum),
      duration,
      raw: { ...workout, workout_summary: safeSummary },
    };
  }

  async importActivities(
    account: ProviderAccount,
    options?: ImportOptions,
  ): Promise<ImportedActivity[]> {
    const activities: ImportedActivity[] = [];
    let page = 1;
    const startDate =
      options?.startDate ??
      new Date(Date.now() - SYNC_WINDOW_DAYS * 86_400_000);
    const endDate = options?.endDate ?? new Date();
    while (true) {
      const response = await this.makeApiRequest<unknown>(
        account,
        'GET',
        `/v1/workouts?page=${page}&per_page=${PAGE_SIZE}`,
      );
      const { workouts, total } = workoutList(response);
      for (const workout of workouts) {
        const activity = this.toImportedActivity(workout, account.athleteId);
        if (!activity) continue;
        if (activity.startDate > endDate) continue;
        if (activity.startDate < startDate)
          return activities.slice(0, options?.limit);
        activities.push(activity);
        if (options?.limit && activities.length >= options.limit)
          return activities;
      }
      if (
        workouts.length < PAGE_SIZE ||
        (total !== undefined && page * PAGE_SIZE >= total)
      )
        break;
      page++;
    }
    return activities;
  }

  private async queueMissingActivities(
    account: ProviderAccount,
    activities: ImportedActivity[],
    bulkImport = false,
  ): Promise<number> {
    if (!activities.length) return 0;
    const known = await this.prisma.eventActivity.findMany({
      where: {
        provider: ConnectorProvider.WAHOO,
        event: { athleteId: account.athleteId },
        externalId: { in: activities.map(({ externalId }) => externalId) },
      },
      select: { externalId: true },
    });
    const existingIds = new Set(known.map(({ externalId }) => externalId));
    const missing = activities.filter(
      ({ externalId }) => !existingIds.has(externalId),
    );
    if (missing.length)
      await this.queueService.addActivityImportJobs(
        account,
        missing,
        bulkImport,
      );
    return missing.length;
  }

  async queueFullImport(
    account: ProviderAccount,
    history: NonNullable<ProviderFullImportJobData['history']>,
    checkpoint: (progress: {
      nextPage: number;
      queuedActivities: number;
    }) => Promise<void>,
  ) {
    const startDate = history.startDate ? new Date(history.startDate) : null;
    const endDate = new Date(history.endDate);
    if (
      !Number.isFinite(endDate.getTime()) ||
      (startDate &&
        (!Number.isFinite(startDate.getTime()) || startDate > endDate))
    ) {
      throw new Error('Wahoo history date range is invalid');
    }
    if (
      !history.externalUserId ||
      history.externalUserId !== account.externalUserId
    ) {
      throw new Error('Wahoo account identity changed; restart the import');
    }

    let page = history.nextPage ?? 1;
    let queuedActivities = history.queuedActivities ?? 0;
    while (true) {
      const response = await this.makeApiRequest<unknown>(
        account,
        'GET',
        `/v1/workouts?page=${page}&per_page=${PAGE_SIZE}`,
      );
      const { workouts, total } = workoutList(response);
      let reachedStart = false;
      const activities: ImportedActivity[] = [];
      for (const workout of workouts) {
        const workoutStart = workout.starts ? new Date(workout.starts) : null;
        if (
          startDate &&
          workoutStart &&
          Number.isFinite(workoutStart.getTime()) &&
          workoutStart < startDate
        ) {
          reachedStart = true;
          break;
        }
        const activity = this.toImportedActivity(workout, account.athleteId);
        if (!activity) continue;
        if (activity.startDate > endDate) continue;
        activities.push(activity);
      }

      queuedActivities += await this.queueMissingActivities(
        account,
        activities,
        true,
      );

      page++;
      await checkpoint({ nextPage: page, queuedActivities });
      if (
        reachedStart ||
        workouts.length < PAGE_SIZE ||
        (total !== undefined && (page - 1) * PAGE_SIZE >= total)
      ) {
        break;
      }
    }
    return { queuedActivities };
  }

  private async fetchFit(
    account: ProviderAccount,
    externalId: string,
  ): Promise<ArrayBuffer | null> {
    const prefix = `wahoo:${account.athleteId}:`;
    const workoutId = externalId.startsWith(prefix)
      ? externalId.slice(prefix.length)
      : '';
    if (!workoutId || !/^[A-Za-z0-9_-]+$/.test(workoutId)) {
      throw new Error('Wahoo activity identifier is invalid');
    }
    const response = await this.makeApiRequest<unknown>(
      account,
      'GET',
      `/v1/workouts/${encodeURIComponent(workoutId)}`,
    );
    const detail = workoutFromResponse(response);
    if (!detail?.workout_summary)
      throw new Error('Wahoo workout response is incomplete');
    const urlValue = detail.workout_summary.file?.url;
    if (!urlValue) return null;
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new Error('Wahoo FIT URL is invalid');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'cdn.wahooligan.com' ||
      (url.port !== '' && url.port !== '443') ||
      url.username ||
      url.password
    ) {
      throw new Error('Wahoo FIT URL host is not allowed');
    }
    try {
      const fileResponse = await axios.get<ArrayBuffer>(url.toString(), {
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: MAX_FIT_BYTES,
        maxBodyLength: MAX_FIT_BYTES,
        maxRedirects: 0,
      });
      return fileResponse.data;
    } catch (error) {
      throw this.safeApiError(error, 'FIT download');
    }
  }

  async importActivity(
    account: ProviderAccount,
    activity: ImportedActivity,
  ): Promise<ImportResult> {
    if (account.status !== 'active')
      throw new Error('Wahoo account is not active');
    const ownership = { event: { athleteId: account.athleteId } };
    const existing = await this.prisma.eventActivity.findFirst({
      where: {
        ...ownership,
        provider: ConnectorProvider.WAHOO,
        externalId: activity.externalId,
      },
    });
    if (existing) return { activity: existing, created: false };

    const fit = await this.fetchFit(account, activity.externalId);
    const parsed = fit
      ? await this.activityFileParserService
          .parseByFileType(fit, 'FIT')
          .catch(() => {
            throw new Error('Wahoo FIT file could not be parsed');
          })
      : null;
    const summary = (activity.raw as WahooWorkout).workout_summary;
    const calories = finite(summary?.calories_accum);
    const averageHeartrate = finite(
      summary?.heart_rate_avg ?? summary?.avg_heart_rate,
    );
    const maxHeartrate = finite(
      summary?.heart_rate_max ?? summary?.max_heart_rate,
    );
    const averageWatts = finite(summary?.power_avg ?? summary?.avg_power);
    const maxWatts = finite(summary?.power_max);
    const averageCadence = finite(summary?.cadence_avg ?? summary?.avg_cadence);
    const duration = activity.duration ?? 0;
    const distance = activity.distance ?? 0;
    const number = (...keys: string[]): number | undefined => {
      for (const key of keys) {
        const value = finite(parsed?.fit?.sessions?.[0]?.[key]);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    const actualDuration = number('totalTimerTime') ?? duration;
    const actualDistance = number('totalDistance') ?? distance;
    const sessionSport = parsed?.fit?.sessions?.[0];
    const sport = sessionSport
      ? (fitSport(sessionSport.sport, sessionSport.subSport) as SportType)
      : (activity.sport as SportType);
    let saved: EventActivity;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            athleteId: account.athleteId,
            name: activity.name,
            type: EventType.ACTIVITY,
            startDate: new Date(activity.startDate),
            endDate: new Date(
              new Date(activity.startDate).getTime() + actualDuration * 1000,
            ),
          },
        });
        return tx.eventActivity.create({
          data: {
            eventId: event.eventId,
            provider: ConnectorProvider.WAHOO,
            externalId: activity.externalId,
            distance: roundDistance(actualDistance),
            movingTime: Math.round(actualDuration),
            averageSpeed:
              actualDuration > 0
                ? (roundSpeed(actualDistance / actualDuration) ?? 0)
                : 0,
            maxSpeed:
              roundSpeed(number('enhancedMaxSpeed', 'maxSpeed') ?? 0) ?? 0,
            averageCadence:
              number('avgCadence') ??
              (averageCadence !== undefined
                ? roundCadence(averageCadence)
                : null),
            averageWatts:
              number('avgPower') ??
              (averageWatts !== undefined ? roundPower(averageWatts) : null),
            maxWatts:
              number('maxPower') ??
              (maxWatts !== undefined ? roundPower(maxWatts) : null),
            elevationGain:
              number('totalAscent') ?? finite(summary?.ascent_accum) ?? 0,
            kilojoules:
              calories !== undefined ? roundEnergy(calories * 4.184) : null,
            averageHeartrate:
              number('avgHeartRate') ??
              (averageHeartrate !== undefined
                ? roundHeartrate(averageHeartrate)
                : null),
            maxHeartrate: number('maxHeartRate')
              ? roundHeartrate(number('maxHeartRate')!)
              : maxHeartrate !== undefined
                ? roundHeartrate(maxHeartrate)
                : null,
            sport,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.eventActivity.findFirst({
          where: {
            ...ownership,
            provider: ConnectorProvider.WAHOO,
            externalId: activity.externalId,
          },
        });
        if (winner) return { activity: winner, created: false };
      }
      throw error;
    }
    if (parsed?.stream && Object.keys(parsed.stream).length > 0) {
      await this.prisma.eventActivity.update({
        where: { eventActivityId: saved.eventActivityId },
        data: await streamUpdate(
          this.prisma,
          saved.eventActivityId,
          compressActivityStream(parsed.stream as ActivityStream),
        ),
      });
    }
    return { activity: saved, created: true };
  }

  @Cron('*/30 * * * *', { timeZone: 'UTC' })
  async queuePeriodicSync(): Promise<void> {
    if (
      this.configService.get('ENABLE_ACTIVITY_IMPORT') !== true ||
      !this.configService.get('WAHOO_CLIENT_ID')
    )
      return;
    const accounts = await this.prisma.providerAccount.findMany({
      where: {
        provider: ConnectorProvider.WAHOO,
        status: 'active',
        importActivitiesEnabled: true,
      },
      select: { providerAccountId: true },
    });
    for (const { providerAccountId } of accounts) {
      try {
        const account = await this.prisma.providerAccount.findUnique({
          where: { providerAccountId },
        });
        if (!account || account.status !== 'active') continue;
        const activities = await this.importActivities(account, {
          startDate: new Date(Date.now() - SYNC_WINDOW_DAYS * 86_400_000),
        });
        if (activities.length) {
          await this.queueMissingActivities(account, activities);
        }
      } catch (error) {
        this.logger.warn(
          `Wahoo sync failed for account ${providerAccountId}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }
}
