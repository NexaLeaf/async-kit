import { Pipeline, pipeline, parallel, parallelSettled, sequence, PipelineStepError, PipelineTimeoutError } from './flowx';

// ─── Pipeline ────────────────────────────────────────────────────────────────

describe('Pipeline', () => {
  it('runs a single step', async () => {
    expect(await pipeline<number>().pipe((n) => n * 2).run(5)).toBe(10);
  });

  it('chains multiple steps', async () => {
    const result = await pipeline<string>()
      .pipe((s) => s.trim())
      .pipe((s) => s.toUpperCase())
      .pipe((s) => `[${s}]`)
      .run('  hello  ');
    expect(result).toBe('[HELLO]');
  });

  it('supports async steps', async () => {
    const result = await pipeline<number>()
      .pipe(async (n) => { await tick(1); return n + 1; })
      .run(9);
    expect(result).toBe(10);
  });

  it('passes StepContext into each step', async () => {
    const contexts: Array<{ stepIndex: number; stepName: string | undefined }> = [];
    await pipeline<number>()
      .pipe({ name: 'double', fn: (n, ctx) => { contexts.push({ stepIndex: ctx.stepIndex, stepName: ctx.stepName }); return n * 2; } })
      .pipe((n, ctx) => { contexts.push({ stepIndex: ctx.stepIndex, stepName: ctx.stepName }); return n + 1; })
      .run(3);
    expect(contexts[0]).toEqual({ stepIndex: 0, stepName: 'double' });
    expect(contexts[1]).toEqual({ stepIndex: 1, stepName: undefined });
  });

  it('calls onStepComplete with index, name, and result', async () => {
    const completed: Array<{ i: number; name: string | undefined; r: unknown }> = [];
    await pipeline<number>()
      .pipe({ name: 'triple', fn: (n) => n * 3 })
      .run(4, { onStepComplete: (i, name, r) => completed.push({ i, name, r }) });
    expect(completed).toEqual([{ i: 0, name: 'triple', r: 12 }]);
  });

  it('wraps errors in PipelineStepError with context', async () => {
    const err = await pipeline<number>()
      .pipe((_n) => { throw new Error('inner'); })
      .run(5)
      .catch((e) => e);
    expect(err).toBeInstanceOf(PipelineStepError);
    expect(err.stepIndex).toBe(0);
    expect(err.inputValue).toBe(5);
    expect((err.cause as Error).message).toBe('inner');
  });

  it('tap() passes value through unchanged', async () => {
    const seen: number[] = [];
    const result = await pipeline<number>()
      .pipe((n) => n * 2)
      .tap((n) => { seen.push(n); })
      .pipe((n) => n + 1)
      .run(3);
    expect(result).toBe(7);
    expect(seen).toEqual([6]);
  });

  it('pipeWithFallback() calls fallback on step error', async () => {
    const result = await pipeline<number>()
      .pipeWithFallback(
        (_n) => { throw new Error('oops'); },
        (err, input) => {
          expect(err).toBeInstanceOf(PipelineStepError);
          return (input as number) * -1;
        }
      )
      .run(7);
    expect(result).toBe(-7);
  });

  it('pipeWithFallback() passes through when step succeeds', async () => {
    const result = await pipeline<number>()
      .pipeWithFallback(
        (n) => n * 3,
        () => -999
      )
      .run(4);
    expect(result).toBe(12);
  });

  it('aborts between steps via AbortSignal', async () => {
    const controller = new AbortController();
    const p = pipeline<number>()
      .pipe(async (n) => { await tick(20); return n + 1; })
      .pipe((n) => n + 1)
      .run(0, { signal: controller.signal });

    setTimeout(() => controller.abort(), 10);

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stepTimeoutMs throws PipelineStepError wrapping PipelineTimeoutError', async () => {
    const err = await pipeline<number>()
      .pipe(async (_n) => { await tick(200); return 1; })
      .run(0, { stepTimeoutMs: 30 })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PipelineStepError);
    expect(err.cause).toBeInstanceOf(PipelineTimeoutError);
    expect((err.cause as PipelineTimeoutError).timeoutMs).toBe(30);
  });

  it('per-step timeoutMs on NamedStep overrides global', async () => {
    const err = await pipeline<number>()
      .pipe({ name: 'slow', fn: async (_n) => { await tick(200); return 1; }, timeoutMs: 30 })
      .run(0)
      .catch((e) => e);
    expect(err).toBeInstanceOf(PipelineStepError);
    expect((err.cause as PipelineTimeoutError).stepName).toBe('slow');
  });

  it('stepCount excludes fallback records', () => {
    const p = pipeline<number>()
      .pipe((n) => n)
      .pipeWithFallback((n) => n, () => 0)
      .tap(() => {});
    expect(p.stepCount).toBe(3);
  });

  it('toArray() returns step metadata', () => {
    const p = pipeline<number>()
      .pipe({ name: 'first', fn: (n) => n })
      .pipe((n) => n);
    expect(p.toArray()).toEqual([
      { index: 0, name: 'first', timeoutMs: undefined },
      { index: 1, name: undefined, timeoutMs: undefined },
    ]);
  });
});

// ─── parallel ────────────────────────────────────────────────────────────────

describe('parallel', () => {
  it('runs tasks concurrently and preserves order', async () => {
    const results = await parallel([
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(10);
      active--;
      return 1;
    });
    await parallel(tasks, { concurrency: 2 });
    expect(maxActive).toBe(2);
  });

  it('rejects if any task throws', async () => {
    await expect(parallel([
      () => Promise.resolve(1),
      () => Promise.reject(new Error('fail')),
    ])).rejects.toThrow('fail');
  });
});

// ─── parallelSettled ─────────────────────────────────────────────────────────

describe('parallelSettled', () => {
  it('returns settled results for all tasks', async () => {
    const results = await parallelSettled([
      () => Promise.resolve(1),
      () => Promise.reject(new Error('oops')),
      () => Promise.resolve(3),
    ]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });

  it('respects concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 4 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(10);
      active--;
      return 1;
    });
    await parallelSettled(tasks, { concurrency: 2 });
    expect(maxActive).toBe(2);
  });
});

// ─── sequence ────────────────────────────────────────────────────────────────

describe('sequence', () => {
  it('reduces items sequentially', async () => {
    expect(await sequence([1, 2, 3, 4], 0, (acc, n) => acc + n)).toBe(10);
  });

  it('passes correct index', async () => {
    const indices: number[] = [];
    await sequence(['a', 'b', 'c'], '', (acc, _, i) => { indices.push(i); return acc; });
    expect(indices).toEqual([0, 1, 2]);
  });

  it('aborts on signal', async () => {
    const controller = new AbortController();
    let processed = 0;
    controller.abort();
    await expect(
      sequence([1, 2, 3], 0, async (acc, n) => { processed++; return acc + n; }, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(processed).toBe(0);
  });
});

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
