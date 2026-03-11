import { Limitx, createLimit, LimitxTimeoutError, LimitxAbortError } from './limitx';
import type { Task } from './limitx';

describe('Limitx', () => {
  it('runs tasks up to concurrency limit', async () => {
    const limiter = new Limitx({ concurrency: 2 });
    const order: number[] = [];
    const tasks = [1, 2, 3].map((n) =>
      limiter.run(async () => { order.push(n); await tick(10); return n; })
    );
    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toContain(1);
  });

  it('queues excess tasks when at capacity — maxActive = concurrency', async () => {
    const limiter = new Limitx({ concurrency: 1 });
    let maxActive = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        limiter.run(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await tick(5);
          active--;
        })
      )
    );
    expect(maxActive).toBe(1);
  });

  it('reports activeCount and pendingCount', async () => {
    const limiter = new Limitx({ concurrency: 1 });
    const p = limiter.run(() => tick(50));
    await tick(5);
    expect(limiter.activeCount).toBe(1);
    expect(limiter.pendingCount).toBe(0);
    await p;
  });

  it('counts() returns atomic snapshot', async () => {
    const limiter = new Limitx({ concurrency: 1 });
    const p = limiter.run(() => tick(50));
    void limiter.run(() => tick(50)); // queued
    await tick(5);
    const { active, pending, total } = limiter.counts();
    expect(active).toBe(1);
    expect(pending).toBe(1);
    expect(total).toBe(2);
    await p;
  });

  it('throws RangeError for concurrency < 1', () => {
    expect(() => new Limitx({ concurrency: 0 })).toThrow(RangeError);
  });

  it('propagates task errors', async () => {
    const limiter = new Limitx({ concurrency: 2 });
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('drain() resolves when all tasks finish (event-driven, no polling)', async () => {
    const limiter = new Limitx({ concurrency: 2 });
    const started: number[] = [];
    for (let i = 0; i < 5; i++) {
      const idx = i;
      void limiter.run(async () => { started.push(idx); await tick(10); });
    }
    await limiter.drain();
    expect(started).toHaveLength(5);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it('drain() resolves immediately when idle', async () => {
    const limiter = new Limitx({ concurrency: 3 });
    await expect(limiter.drain()).resolves.toBeUndefined();
  });

  it('priority queue runs higher-priority tasks first', async () => {
    const limiter = new Limitx({ concurrency: 1 });
    const order: number[] = [];

    // Fill the single slot so subsequent tasks queue
    const blocker = limiter.run(() => tick(30));

    void limiter.run(async () => { order.push(1); }, { priority: 1 });
    void limiter.run(async () => { order.push(10); }, { priority: 10 });
    void limiter.run(async () => { order.push(5); }, { priority: 5 });

    await blocker;
    await limiter.drain();

    expect(order).toEqual([10, 5, 1]);
  });

  it('pause() stops dequeuing; resume() restarts it', async () => {
    const limiter = new Limitx({ concurrency: 2 });
    limiter.pause();
    expect(limiter.isPaused).toBe(true);

    const results: number[] = [];
    void limiter.run(async () => { results.push(1); return 1; });
    void limiter.run(async () => { results.push(2); return 2; });

    await tick(20);
    expect(results).toEqual([]); // nothing ran while paused

    limiter.resume();
    await limiter.drain();
    expect(results.sort()).toEqual([1, 2]);
    expect(limiter.isPaused).toBe(false);
  });

  it('clear() cancels queued tasks with LimitxAbortError', async () => {
    const limiter = new Limitx({ concurrency: 1 });
    // Fill the slot
    const blocker = limiter.run(() => tick(50));

    const cancelled = limiter.run(() => Promise.resolve(99));
    await tick(5);
    const count = limiter.clear();

    expect(count).toBe(1);
    await expect(cancelled).rejects.toThrow(LimitxAbortError);
    await blocker;
  });

  it('timeoutMs rejects task with LimitxTimeoutError', async () => {
    const limiter = new Limitx({ concurrency: 2 });
    await expect(
      limiter.run(() => tick(200), { timeoutMs: 30 })
    ).rejects.toThrow(LimitxTimeoutError);
  });

  it('runAll() returns results in submission order', async () => {
    const limiter = new Limitx({ concurrency: 3 });
    const results = await limiter.runAll(
      [3, 1, 2].map((n) => async () => { await tick(n * 5); return n; })
    );
    expect(results).toEqual([3, 1, 2]);
  });

  it('createLimit factory exposes .limiter', async () => {
    const limit = createLimit(3);
    const result = await limit(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(limit.limiter).toBeInstanceOf(Limitx);
    await limit.limiter.drain();
  });

  it('onError callback is called on failure', async () => {
    const errors: unknown[] = [];
    const limiter = new Limitx({ concurrency: 2, onError: (e) => errors.push(e) });
    await expect(limiter.run(() => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(errors).toHaveLength(1);
  });
});

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Satisfy unused import lint rule
const _unused: Task<unknown> = () => Promise.resolve();
void _unused;
