import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

const LEASE_MS = 5 * 60_000;
const RENEW_MS = 30_000;
const WAIT_MS = 60_000;
const POLL_MS = 250;

const COMMANDS = {
  acquire: `return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')`,
  assert: `if redis.call('GET', KEYS[1]) == ARGV[1] then return 1 else return 0 end`,
  renew: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
  release: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
};

const configuredClients = new WeakSet<object>();

@Injectable()
export class ProviderExportLockService {
  private readonly logger = new Logger(ProviderExportLockService.name);

  constructor(@InjectQueue('activity-import') private readonly queue: Queue) {}

  async withLock<T>(
    workoutId: number,
    work: (assertHeld: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const redis = await this.queue.client;
    if (!configuredClients.has(redis)) {
      for (const [name, lua] of Object.entries(COMMANDS)) {
        redis.defineCommand(`providerExportLock${name}`, {
          numberOfKeys: 1,
          lua,
        });
      }
      configuredClients.add(redis);
    }

    const key = `openathlete:provider-workout-export-lock:${workoutId}`;
    const owner = randomUUID();
    const deadline = Date.now() + WAIT_MS;
    while (true) {
      if (
        (await redis.runCommand('providerExportLockacquire', [
          key,
          owner,
          LEASE_MS,
        ])) === 'OK'
      )
        break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timed out waiting for workout export lock ${workoutId}`,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(POLL_MS, remaining)),
      );
    }

    let leaseFailure: Error | undefined;
    let renewal = Promise.resolve();
    const assertHeld = async () => {
      if (leaseFailure) throw leaseFailure;
      if (
        (await redis.runCommand('providerExportLockassert', [key, owner])) !== 1
      ) {
        leaseFailure = new Error(`Lost workout export lock ${workoutId}`);
        throw leaseFailure;
      }
    };
    const timer = setInterval(() => {
      renewal = renewal
        .then(async () => {
          if (leaseFailure) return;
          const renewed = await redis.runCommand('providerExportLockrenew', [
            key,
            owner,
            LEASE_MS,
          ]);
          if (renewed !== 1) {
            throw new Error(`Lost workout export lock ${workoutId}`);
          }
        })
        .catch((error: unknown) => {
          leaseFailure =
            error instanceof Error ? error : new Error(String(error));
        });
    }, RENEW_MS);

    try {
      await assertHeld();
      const result = await work(assertHeld);
      await assertHeld();
      return result;
    } finally {
      clearInterval(timer);
      await renewal;
      try {
        await redis.runCommand('providerExportLockrelease', [key, owner]);
      } catch (error) {
        this.logger.warn(
          `Failed to release workout export lock ${workoutId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
