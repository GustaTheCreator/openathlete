import { QueueService } from './queue.service';

function setup() {
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    defineCommand: jest.fn(),
    runCommand: jest.fn().mockResolvedValue(0),
  };
  const service = new QueueService(
    { client: Promise.resolve(redis) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, redis };
}

describe('Wahoo server-side OAuth transaction', () => {
  const state = 's'.repeat(43);

  it('stores a short-lived flow without the raw verifier', async () => {
    const { service, redis } = setup();
    await service.rememberWahooOAuth(state, 7, 'private-verifier');
    const args = redis.set.mock.calls[0] as unknown[];
    expect(args.slice(2)).toEqual([{ EX: 600 }]);
    expect(args[1]).not.toContain('private-verifier');
  });

  it('accepts the owner and verifier only once, with an atomic consume', async () => {
    const { service, redis } = setup();
    await service.rememberWahooOAuth(state, 7, 'verifier');
    redis.runCommand.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await service.consumeWahooOAuth(state, 7, 'verifier')).toBe(true);
    expect(await service.consumeWahooOAuth(state, 7, 'verifier')).toBe(false);
    expect(redis.runCommand).toHaveBeenCalledTimes(2);
    expect(redis.defineCommand).toHaveBeenCalledWith(
      'consumeWahooOAuth',
      expect.objectContaining({ numberOfKeys: 1 }),
    );
  });

  it('rejects a changed account, a changed verifier and expired state', async () => {
    for (const [userId, verifier] of [
      [8, 'verifier'],
      [7, 'wrong'],
    ] as const) {
      const { service, redis } = setup();
      await service.rememberWahooOAuth(state, 7, 'verifier');
      expect(await service.consumeWahooOAuth(state, userId, verifier)).toBe(
        false,
      );
      expect(redis.runCommand).toHaveBeenCalledWith('consumeWahooOAuth', [
        expect.any(String),
        userId,
        expect.any(String),
      ]);
    }
    expect(await setup().service.consumeWahooOAuth(state, 7, 'verifier')).toBe(
      false,
    );
  });
});
