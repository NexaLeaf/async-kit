import { TokenBucket, SlidingWindow, FixedWindow, CompositeLimiter, RateLimitError } from './ratelimitx';

// ─── TokenBucket ─────────────────────────────────────────────────────────────

describe('TokenBucket', () => {
  it('allows consumption when tokens are available', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1, refillInterval: 1000 });
    await expect(bucket.consume()).resolves.toBeUndefined();
    expect(bucket.available).toBe(4);
  });

  it('tryConsume returns false when no tokens left', () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1, refillInterval: 1000 });
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('consume() waits for tokens (does not throw)', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 2, refillInterval: 100 });
    bucket.tryConsume(); // drain
    // Should wait ~50ms for 1 token at refillRate=2/100ms
    const start = Date.now();
    await bucket.consume();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('consume() throws RateLimitError if count > capacity', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1, refillInterval: 1000 });
    await expect(bucket.consume(10)).rejects.toThrow(RateLimitError);
  });

  it('acquireOrThrow() throws immediately when exhausted', () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1, refillInterval: 1000 });
    bucket.tryConsume();
    expect(() => bucket.acquireOrThrow()).toThrow(RateLimitError);
  });

  it('acquireOrThrow() RateLimitError has full metadata', () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillInterval: 1000 });
    bucket.tryConsume(); bucket.tryConsume();
    try {
      bucket.acquireOrThrow();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).algorithm).toBe('token-bucket');
      expect((err as RateLimitError).limit).toBe(2);
      expect((err as RateLimitError).retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('refills tokens over time (no fractional loss)', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 50 });
    for (let i = 0; i < 5; i++) bucket.tryConsume();
    expect(bucket.available).toBe(0);
    await new Promise((r) => setTimeout(r, 55));
    expect(bucket.available).toBeGreaterThan(0);
  });

  it('reset() refills to capacity', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1, refillInterval: 1000 });
    for (let i = 0; i < 5; i++) bucket.tryConsume();
    bucket.reset();
    expect(bucket.available).toBe(5);
  });

  it('setCapacity() resizes and clamps tokens', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillInterval: 1000 });
    bucket.setCapacity(3);
    expect(bucket.available).toBe(3);
    expect(() => bucket.setCapacity(0)).toThrow(RangeError);
  });
});

// ─── SlidingWindow ────────────────────────────────────────────────────────────

describe('SlidingWindow', () => {
  it('allows requests within limit', () => {
    const win = new SlidingWindow({ windowMs: 1000, maxRequests: 3 });
    expect(win.tryAcquire()).toBe(true);
    expect(win.tryAcquire()).toBe(true);
    expect(win.tryAcquire()).toBe(true);
  });

  it('blocks requests over limit', () => {
    const win = new SlidingWindow({ windowMs: 1000, maxRequests: 2 });
    win.tryAcquire(); win.tryAcquire();
    expect(win.tryAcquire()).toBe(false);
  });

  it('acquire() throws RateLimitError with full metadata', () => {
    const win = new SlidingWindow({ windowMs: 1000, maxRequests: 1 });
    win.acquire();
    try {
      win.acquire();
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).algorithm).toBe('sliding-window');
      expect((err as RateLimitError).limit).toBe(1);
      expect((err as RateLimitError).current).toBe(1);
    }
  });

  it('waitAndAcquire() waits for window to expire', async () => {
    const win = new SlidingWindow({ windowMs: 50, maxRequests: 1 });
    win.tryAcquire();
    const start = Date.now();
    await win.waitAndAcquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('expires old timestamps (ring buffer correctness)', async () => {
    const win = new SlidingWindow({ windowMs: 50, maxRequests: 2 });
    win.tryAcquire(); win.tryAcquire();
    expect(win.tryAcquire()).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(win.tryAcquire()).toBe(true);
  });

  it('currentCount reports active requests', () => {
    const win = new SlidingWindow({ windowMs: 1000, maxRequests: 5 });
    win.tryAcquire(); win.tryAcquire();
    expect(win.currentCount).toBe(2);
  });

  it('handles high-volume ring buffer wrap-around', () => {
    const win = new SlidingWindow({ windowMs: 10_000, maxRequests: 100 });
    for (let i = 0; i < 100; i++) expect(win.tryAcquire()).toBe(true);
    expect(win.tryAcquire()).toBe(false);
    expect(win.currentCount).toBe(100);
  });
});

// ─── FixedWindow ──────────────────────────────────────────────────────────────

describe('FixedWindow', () => {
  it('allows requests within limit', () => {
    const fw = new FixedWindow({ windowMs: 1000, maxRequests: 3 });
    expect(fw.tryAcquire()).toBe(true);
    expect(fw.tryAcquire()).toBe(true);
    expect(fw.tryAcquire()).toBe(true);
  });

  it('blocks requests over limit', () => {
    const fw = new FixedWindow({ windowMs: 1000, maxRequests: 2 });
    fw.tryAcquire(); fw.tryAcquire();
    expect(fw.tryAcquire()).toBe(false);
  });

  it('acquire() throws RateLimitError', () => {
    const fw = new FixedWindow({ windowMs: 1000, maxRequests: 1 });
    fw.acquire();
    expect(() => fw.acquire()).toThrow(RateLimitError);
  });

  it('RateLimitError has algorithm=fixed-window', () => {
    const fw = new FixedWindow({ windowMs: 1000, maxRequests: 1 });
    fw.acquire();
    try { fw.acquire(); } catch (err) {
      expect((err as RateLimitError).algorithm).toBe('fixed-window');
    }
  });

  it('resets after windowMs', async () => {
    const fw = new FixedWindow({ windowMs: 50, maxRequests: 2 });
    fw.tryAcquire(); fw.tryAcquire();
    expect(fw.tryAcquire()).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(fw.tryAcquire()).toBe(true);
  });

  it('calls onWindowReset callback', async () => {
    const resets: number[] = [];
    const fw = new FixedWindow({ windowMs: 50, maxRequests: 10, onWindowReset: (t) => resets.push(t) });
    fw.tryAcquire();
    await new Promise((r) => setTimeout(r, 60));
    fw.tryAcquire(); // triggers tick + reset
    expect(resets.length).toBeGreaterThanOrEqual(1);
  });

  it('reset() manually resets count', () => {
    const fw = new FixedWindow({ windowMs: 1000, maxRequests: 2 });
    fw.tryAcquire(); fw.tryAcquire();
    fw.reset();
    expect(fw.currentCount).toBe(0);
    expect(fw.tryAcquire()).toBe(true);
  });

  it('windowResetMs is positive', () => {
    const fw = new FixedWindow({ windowMs: 1000, maxRequests: 5 });
    expect(fw.windowResetMs).toBeGreaterThan(0);
    expect(fw.windowResetMs).toBeLessThanOrEqual(1000);
  });

  it('waitAndAcquire() waits for window to reset', async () => {
    const fw = new FixedWindow({ windowMs: 50, maxRequests: 1 });
    fw.acquire();
    const start = Date.now();
    await fw.waitAndAcquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

// ─── CompositeLimiter ─────────────────────────────────────────────────────────

describe('CompositeLimiter', () => {
  it('requires at least one limiter', () => {
    expect(() => new CompositeLimiter([])).toThrow(RangeError);
  });

  it('allows when all limiters pass', () => {
    const cl = new CompositeLimiter([
      new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 1000 }),
      new SlidingWindow({ windowMs: 1000, maxRequests: 5 }),
    ]);
    expect(cl.tryAcquire()).toBe(true);
  });

  it('blocks when any limiter is exhausted', () => {
    const cl = new CompositeLimiter([
      new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1000 }),
      new SlidingWindow({ windowMs: 1000, maxRequests: 1 }),
    ]);
    cl.tryAcquire(); // uses up the sliding window slot
    expect(cl.tryAcquire()).toBe(false);
  });

  it('waitAndAcquire() eventually acquires', async () => {
    const fw = new FixedWindow({ windowMs: 50, maxRequests: 1 });
    const cl = new CompositeLimiter([fw]);
    cl.tryAcquire(); // exhaust
    const start = Date.now();
    await cl.waitAndAcquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
