import { retry, createRetry, withRetry, RetryxError, RetryxTimeoutError, CircuitBreaker, CircuitOpenError } from './retryx';

describe('retry', () => {
  it('returns result on first success', async () => {
    expect(await retry(() => Promise.resolve(42))).toBe(42);
  });

  it('retries on failure and succeeds eventually', async () => {
    let calls = 0;
    const result = await retry(
      async () => { calls++; if (calls < 3) throw new Error('not yet'); return 'done'; },
      { maxAttempts: 5, initialDelay: 0, jitter: 'none' }
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('throws RetryxError with allErrors after exhausting attempts', async () => {
    let calls = 0;
    const err = await retry(
      () => { calls++; return Promise.reject(new Error(`fail-${calls}`)); },
      { maxAttempts: 3, initialDelay: 0, jitter: 'none' }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(RetryxError);
    expect(err.attempts).toBe(3);
    expect(err.allErrors).toHaveLength(3);
    expect((err.allErrors[0] as Error).message).toBe('fail-1');
    expect((err.allErrors[2] as Error).message).toBe('fail-3');
  });

  it('stops retrying when retryIf returns false', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => { calls++; throw new TypeError('non-retryable'); },
        { maxAttempts: 5, initialDelay: 0, retryIf: (e) => !(e instanceof TypeError) }
      )
    ).rejects.toThrow(RetryxError);
    expect(calls).toBe(1);
  });

  it('retryIf receives RetryContext', async () => {
    const contexts: Array<{ attemptNumber: number; errors: unknown[] }> = [];
    await expect(
      retry(
        () => Promise.reject(new Error('x')),
        {
          maxAttempts: 3,
          initialDelay: 0,
          retryIf: (_e, ctx) => { contexts.push({ attemptNumber: ctx.attemptNumber, errors: ctx.errors }); return true; }
        }
      )
    ).rejects.toThrow();
    expect(contexts).toHaveLength(2);
    expect(contexts[0].attemptNumber).toBe(1);
    expect(contexts[1].errors).toHaveLength(2);
  });

  it('onRetry receives context with elapsedMs', async () => {
    const calls: number[] = [];
    await expect(
      retry(
        () => Promise.reject(new Error('x')),
        {
          maxAttempts: 3,
          initialDelay: 0,
          jitter: 'none',
          onRetry: (n, _e, _ms, ctx) => { calls.push(ctx.attemptNumber); }
        }
      )
    ).rejects.toThrow();
    expect(calls).toEqual([1, 2]);
  });

  it('timeoutMs throws RetryxTimeoutError', async () => {
    const err = await retry(
      () => new Promise((r) => setTimeout(r, 200)),
      { maxAttempts: 1, timeoutMs: 30 }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(RetryxTimeoutError);
    expect(err.timeoutMs).toBe(30);
    expect(err.attempt).toBe(1);
  });

  it('jitter: none — produces deterministic delays', async () => {
    const delays: number[] = [];
    await expect(
      retry(
        () => Promise.reject(new Error('x')),
        {
          maxAttempts: 4,
          initialDelay: 100,
          maxDelay: 10_000,
          factor: 2,
          jitter: 'none',
          onRetry: (_n, _e, ms) => delays.push(ms)
        }
      )
    ).rejects.toThrow();
    expect(delays).toEqual([100, 200, 400]);
  });

  it('jitter: full — delays within [0, cap]', async () => {
    const delays: number[] = [];
    await expect(
      retry(
        () => Promise.reject(new Error('x')),
        { maxAttempts: 4, initialDelay: 200, maxDelay: 10_000, factor: 2, jitter: 'full', onRetry: (_n, _e, ms) => delays.push(ms) }
      )
    ).rejects.toThrow();
    delays.forEach((d, i) => {
      const cap = Math.min(200 * Math.pow(2, i), 10_000);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(cap);
    });
  });

  it('createRetry merges defaults with overrides', async () => {
    const resilient = createRetry({ maxAttempts: 2, initialDelay: 0, jitter: 'none' });
    let calls = 0;
    await expect(resilient(async () => { calls++; throw new Error('fail'); })).rejects.toThrow(RetryxError);
    expect(calls).toBe(2);

    let calls2 = 0;
    await expect(resilient(async () => { calls2++; throw new Error('fail'); }, { maxAttempts: 1 })).rejects.toThrow(RetryxError);
    expect(calls2).toBe(1);
  });
});

describe('withRetry', () => {
  it('wraps a function to auto-retry', async () => {
    let calls = 0;
    const unreliable = async (x: number): Promise<number> => {
      calls++;
      if (calls < 3) throw new Error('not yet');
      return x * 2;
    };

    const resilient = withRetry(unreliable, { maxAttempts: 5, initialDelay: 0, jitter: 'none' });
    const result = await resilient(5);
    expect(result).toBe(10);
    expect(calls).toBe(3);
  });

  it('passes arguments correctly on each retry', async () => {
    let calls = 0;
    const fn = withRetry(async (a: string, b: number) => {
      calls++;
      if (calls < 2) throw new Error('fail');
      return `${a}-${b}`;
    }, { maxAttempts: 3, initialDelay: 0, jitter: 'none' });

    expect(await fn('hello', 42)).toBe('hello-42');
  });
});

describe('CircuitBreaker', () => {
  const makeBreaker = (overrides = {}) =>
    new CircuitBreaker({ failureThreshold: 3, successThreshold: 2, openDurationMs: 100, ...overrides });

  it('starts CLOSED and allows calls', async () => {
    const cb = makeBreaker();
    expect(cb.currentState).toBe('CLOSED');
    const result = await cb.run(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('opens after failureThreshold failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await cb.run(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.currentState).toBe('OPEN');
  });

  it('throws CircuitOpenError when OPEN', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await cb.run(() => Promise.reject(new Error('fail'))).catch(() => {});
    await expect(cb.run(() => Promise.resolve(1))).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after openDurationMs', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openDurationMs: 50 });
    await cb.run(() => Promise.reject(new Error('x'))).catch(() => {});
    expect(cb.currentState).toBe('OPEN');
    await new Promise((r) => setTimeout(r, 60));
    expect(cb.currentState).toBe('HALF_OPEN');
  });

  it('closes after successThreshold successes in HALF_OPEN', async () => {
    const states: string[] = [];
    const cb = makeBreaker({ failureThreshold: 1, openDurationMs: 50, successThreshold: 2, onStateChange: (_, to) => states.push(to) });
    await cb.run(() => Promise.reject(new Error('x'))).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));
    await cb.run(() => Promise.resolve(1));
    await cb.run(() => Promise.resolve(2));
    expect(cb.currentState).toBe('CLOSED');
    expect(states).toContain('HALF_OPEN');
    expect(states).toContain('CLOSED');
  });

  it('re-opens on failure in HALF_OPEN', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openDurationMs: 50 });
    await cb.run(() => Promise.reject(new Error('x'))).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));
    await cb.run(() => Promise.reject(new Error('x'))).catch(() => {});
    expect(cb.currentState).toBe('OPEN');
  });

  it('reset() returns to CLOSED', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await cb.run(() => Promise.reject(new Error('x'))).catch(() => {});
    cb.reset();
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.stats().failures).toBe(0);
  });

  it('stats() returns correct counts', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    await cb.run(() => Promise.resolve(1));
    await cb.run(() => Promise.reject(new Error('x'))).catch(() => {});
    const s = cb.stats();
    expect(s.calls).toBe(2);
    expect(s.failures).toBe(1);
  });
});
