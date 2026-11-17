import { ProviderExportLockService } from './provider-export-lock.service';

function setup() {
  const leases = new Map<string, { owner: string; expiresAt: number }>();
  const redis = {
    defineCommand: jest.fn(),
    runCommand: jest.fn(async (command: string, args: unknown[]) => {
      const [keyValue, ownerValue, ttlValue] = args;
      const key = String(keyValue);
      const owner = String(ownerValue);
      const current = leases.get(key);
      if (command === 'providerExportLockacquire') {
        if (current && current.expiresAt > Date.now()) return null;
        leases.set(key, { owner, expiresAt: Date.now() + Number(ttlValue) });
        return 'OK';
      }
      if (!current || current.expiresAt <= Date.now()) return 0;
      if (command === 'providerExportLockassert') {
        return current.owner === owner ? 1 : 0;
      }
      if (command === 'providerExportLockrenew') {
        if (current.owner !== owner) return 0;
        current.expiresAt = Date.now() + Number(ttlValue);
        return 1;
      }
      if (command === 'providerExportLockrelease') {
        if (current.owner !== owner) return 0;
        leases.delete(key);
        return 1;
      }
      throw new Error(`Unexpected Redis command: ${command}`);
    }),
  };
  const service = new ProviderExportLockService({
    client: Promise.resolve(redis),
  } as never);
  return { service, redis, leases };
}

describe('ProviderExportLockService', () => {
  it('waits for the current owner, then acquires the released lease', async () => {
    const { service, redis } = setup();
    let allowFirstToFinish!: () => void;
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => (firstEntered = resolve));
    const blocked = new Promise<void>(
      (resolve) => (allowFirstToFinish = resolve),
    );
    const first = service.withLock(9, async () => {
      firstEntered();
      await blocked;
    });
    await entered;

    let secondRan = false;
    const second = service.withLock(9, async (assertHeld) => {
      await assertHeld();
      secondRan = true;
    });
    allowFirstToFinish();
    await Promise.all([first, second]);

    expect(secondRan).toBe(true);
    expect(
      redis.runCommand.mock.calls.filter(
        ([command]) => command === 'providerExportLockacquire',
      ),
    ).toHaveLength(3);
  });

  it('reclaims an expired orphaned lease', async () => {
    const { service, leases } = setup();
    const key = 'openathlete:provider-workout-export-lock:14';
    leases.set(key, { owner: 'crashed-process', expiresAt: Date.now() - 1 });
    const work = jest.fn();

    await service.withLock(14, async () => work());

    expect(work).toHaveBeenCalledTimes(1);
    expect(leases.has(key)).toBe(false);
  });

  it('times out on a contended lease instead of silently skipping work', async () => {
    jest.useFakeTimers();
    const { service, redis } = setup();
    redis.runCommand.mockImplementation(async (command: string) =>
      command === 'providerExportLockacquire' ? null : 0,
    );

    const work = service.withLock(10, async () => undefined);
    const rejected = expect(work).rejects.toThrow(
      'Timed out waiting for workout export lock 10',
    );
    try {
      await jest.advanceTimersByTimeAsync(60_000);
      await rejected;
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails held checks after ownership changes and never releases another owner', async () => {
    const { service, leases } = setup();
    const key = 'openathlete:provider-workout-export-lock:11';

    await expect(
      service.withLock(11, async (assertHeld) => {
        leases.set(key, {
          owner: 'replacement-owner',
          expiresAt: Date.now() + 60_000,
        });
        await assertHeld();
      }),
    ).rejects.toThrow('Lost workout export lock 11');

    expect(leases.get(key)?.owner).toBe('replacement-owner');
  });

  it('fails closed when the lease renewal fails', async () => {
    jest.useFakeTimers();
    const { service, redis } = setup();
    const runCommand = redis.runCommand.getMockImplementation();
    if (!runCommand) throw new Error('Expected Redis command implementation');
    redis.runCommand.mockImplementation(async (command, args) =>
      command === 'providerExportLockrenew' ? 0 : runCommand(command, args),
    );
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const blocked = new Promise<void>((resolve) => (finish = resolve));
    const work = service.withLock(12, async () => {
      entered();
      await blocked;
    });
    const rejected = expect(work).rejects.toThrow(
      'Lost workout export lock 12',
    );

    try {
      await started;
      await jest.advanceTimersByTimeAsync(30_000);
      finish();
      await rejected;
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves a work error when lease cleanup fails', async () => {
    const { service, redis } = setup();
    const runCommand = redis.runCommand.getMockImplementation();
    if (!runCommand) throw new Error('Expected Redis command implementation');
    redis.runCommand.mockImplementation(async (command, args) => {
      if (command === 'providerExportLockrelease') {
        throw new Error('Redis cleanup failed');
      }
      return runCommand(command, args);
    });
    const workError = new Error('provider failed');

    await expect(
      service.withLock(13, async () => {
        throw workError;
      }),
    ).rejects.toBe(workError);
  });
});
