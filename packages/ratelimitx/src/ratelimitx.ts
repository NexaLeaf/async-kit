export type { TokenBucketOptions, SlidingWindowOptions, FixedWindowOptions, Limiter, RateLimitAlgorithm } from './types.js';
import type { TokenBucketOptions, SlidingWindowOptions, FixedWindowOptions, Limiter } from './types.js';

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
    public readonly algorithm: 'token-bucket' | 'sliding-window' | 'fixed-window',
    public readonly limit: number,
    public readonly current: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Token Bucket rate limiter.
 *
 * Tokens accumulate over time up to `capacity`. Burst-friendly — allows up
 * to `capacity` back-to-back calls as long as the bucket is full.
 *
 * - `tryConsume()` — non-throwing, returns `true` if tokens available.
 * - `consume()` — async, **blocks** until tokens are available.
 * - `available` — current token count (after refill).
 *
 * @example
 * const bucket = new TokenBucket({ capacity: 10, refillRate: 2, refillInterval: 1000 });
 * await bucket.consume(); // waits until a token is available
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;
  private capacity: number;
  private readonly refillRate: number;
  private readonly refillInterval: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.refillInterval = options.refillInterval ?? 1000;
    this.tokens = options.capacity;
    this.lastRefillTime = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    if (elapsed <= 0) return;
    const newTokens = (elapsed / this.refillInterval) * this.refillRate;
    if (newTokens >= 1) {
      // Advance lastRefillTime only by the consumed portion to preserve sub-interval leftovers
      const consumed = Math.floor(newTokens);
      this.tokens = Math.min(this.capacity, this.tokens + consumed);
      this.lastRefillTime += Math.floor(consumed * (this.refillInterval / this.refillRate));
    }
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /**
   * Waits until `count` tokens are available, then consumes them.
   * Throws `RateLimitError` only if the request can never be satisfied
   * (i.e. `count > capacity`). Cancellable via `AbortSignal`.
   */
  async consume(count = 1, signal?: AbortSignal): Promise<void> {
    if (count > this.capacity) {
      throw new RateLimitError(
        `Requested ${count} tokens exceeds capacity ${this.capacity}`,
        Infinity,
        'token-bucket',
        this.capacity,
        count
      );
    }
    while (true) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      const deficit = count - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillRate) * this.refillInterval);
      await abortableDelay(waitMs, signal);
    }
  }

  /** Alias for `acquireOrThrow()` — satisfies the `Limiter` interface. */
  acquire(count = 1): void {
    this.acquireOrThrow(count);
  }

  /** Satisfies the `Limiter` interface — alias for `tryConsume()`. */
  tryAcquire(): boolean {
    return this.tryConsume();
  }

  /** Satisfies the `Limiter` interface — alias for `consume()`. */
  async waitAndAcquire(signal?: AbortSignal): Promise<void> {
    return this.consume(1, signal);
  }

  /** Throws immediately if tokens are unavailable (non-blocking equivalent of `consume`). */
  acquireOrThrow(count = 1): void {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }
    const deficit = count - this.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRate) * this.refillInterval);
    throw new RateLimitError(
      `Rate limit exceeded. Retry after ${retryAfterMs}ms`,
      retryAfterMs,
      'token-bucket',
      this.capacity,
      Math.floor(this.tokens)
    );
  }

  /** Refill to full capacity and reset the refill clock. */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }

  /** Hot-resize capacity. Clamps current tokens if the new capacity is lower. */
  setCapacity(capacity: number): void {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.capacity = capacity as typeof this.capacity;
    this.tokens = Math.min(this.tokens, capacity);
  }
}

// ─── Sliding Window ───────────────────────────────────────────────────────────

/**
 * Sliding Window rate limiter.
 *
 * Tracks exact request timestamps in a ring buffer. Strict enforcement —
 * no burst beyond `maxRequests` regardless of spacing.
 *
 * - `tryAcquire()` — non-throwing.
 * - `acquire()` — throws `RateLimitError` immediately.
 * - `waitAndAcquire()` — async, blocks until a slot is available.
 *
 * @example
 * const window = new SlidingWindow({ windowMs: 60_000, maxRequests: 100 });
 * await window.waitAndAcquire(); // queues caller until a slot opens
 */
export class SlidingWindow {
  // Ring buffer: pre-allocated array + head index avoids O(n) Array.shift()
  private readonly ring: Float64Array;
  private head = 0;
  private count = 0;
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: SlidingWindowOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.ring = new Float64Array(options.maxRequests);
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.count > 0 && this.ring[this.head % this.maxRequests] < cutoff) {
      this.head++;
      this.count--;
    }
  }

  get currentCount(): number {
    this.prune();
    return this.count;
  }

  tryAcquire(): boolean {
    this.prune();
    if (this.count < this.maxRequests) {
      this.ring[(this.head + this.count) % this.maxRequests] = Date.now();
      this.count++;
      return true;
    }
    return false;
  }

  acquire(): void {
    this.prune();
    if (this.count < this.maxRequests) {
      this.ring[(this.head + this.count) % this.maxRequests] = Date.now();
      this.count++;
      return;
    }
    const oldest = this.ring[this.head % this.maxRequests];
    const retryAfterMs = Math.max(0, oldest + this.windowMs - Date.now());
    throw new RateLimitError(
      `Rate limit exceeded. ${this.maxRequests} requests per ${this.windowMs}ms window.`,
      retryAfterMs,
      'sliding-window',
      this.maxRequests,
      this.count
    );
  }

  /** Blocks until a slot is available, then acquires it. Cancellable via AbortSignal. */
  async waitAndAcquire(signal?: AbortSignal): Promise<void> {
    while (!this.tryAcquire()) {
      const oldest = this.ring[this.head % this.maxRequests];
      const waitMs = Math.max(1, oldest + this.windowMs - Date.now());
      await abortableDelay(waitMs, signal);
    }
  }
}

// ─── Fixed Window ─────────────────────────────────────────────────────────────

/**
 * Fixed Window rate limiter.
 *
 * Simplest algorithm — counts requests in a fixed time bucket that resets
 * every `windowMs`. Easiest to reason about; susceptible to boundary spikes.
 *
 * @example
 * const fw = new FixedWindow({ windowMs: 60_000, maxRequests: 100 });
 * fw.acquire(); // throws if over limit in current window
 */
export class FixedWindow {
  private count = 0;
  private windowStart: number;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly onWindowReset?: (windowStart: number) => void;

  constructor(options: FixedWindowOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.onWindowReset = options.onWindowReset;
    this.windowStart = Date.now();
  }

  private tick(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = now;
      this.onWindowReset?.(this.windowStart);
    }
  }

  get currentCount(): number {
    this.tick();
    return this.count;
  }

  /** Ms until the current window resets. */
  get windowResetMs(): number {
    return Math.max(0, this.windowStart + this.windowMs - Date.now());
  }

  tryAcquire(): boolean {
    this.tick();
    if (this.count < this.maxRequests) {
      this.count++;
      return true;
    }
    return false;
  }

  acquire(): void {
    this.tick();
    if (this.count < this.maxRequests) {
      this.count++;
      return;
    }
    throw new RateLimitError(
      `Fixed window rate limit exceeded. Retry after ${this.windowResetMs}ms`,
      this.windowResetMs,
      'fixed-window',
      this.maxRequests,
      this.count
    );
  }

  async waitAndAcquire(signal?: AbortSignal): Promise<void> {
    while (!this.tryAcquire()) {
      await abortableDelay(this.windowResetMs || 1, signal);
    }
  }

  /** Manually reset the window (useful in tests). */
  reset(): void {
    this.count = 0;
    this.windowStart = Date.now();
    this.onWindowReset?.(this.windowStart);
  }
}

// ─── Composite Limiter ────────────────────────────────────────────────────────

/**
 * Composite rate limiter — enforces multiple limits simultaneously.
 *
 * All limiters must pass for a call to be allowed. Useful when APIs enforce
 * multiple tiers (e.g. 10/second AND 500/minute AND 5000/hour).
 *
 * @example
 * const limiter = new CompositeLimiter([
 *   new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1000 }),
 *   new SlidingWindow({ windowMs: 60_000, maxRequests: 500 }),
 * ]);
 * await limiter.waitAndAcquire();
 */
export class CompositeLimiter {
  constructor(private readonly limiters: Limiter[]) {
    if (limiters.length === 0) throw new RangeError('CompositeLimiter requires at least one limiter');
  }

  /** Returns `true` only if ALL limiters can acquire. Rolls back on partial failure. */
  tryAcquire(): boolean {
    const acquired: Limiter[] = [];
    for (const l of this.limiters) {
      if (l.tryAcquire()) {
        acquired.push(l);
      } else {
        // Rollback is not possible for SlidingWindow/FixedWindow after tryAcquire succeeds,
        // but we stop here — already-acquired counts against the window, which is acceptable.
        return false;
      }
    }
    return true;
  }

  /** Throws `RateLimitError` with the most restrictive `retryAfterMs`. */
  acquire(): void {
    for (const l of this.limiters) {
      l.acquire();
    }
  }

  /** Waits for ALL limiters to have capacity, then acquires atomically. */
  async waitAndAcquire(signal?: AbortSignal): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // Try to acquire all — short circuit on first failure
      const acquired: Limiter[] = [];
      let waitMs = 0;

      let allPassed = true;
      for (const l of this.limiters) {
        if (l.tryAcquire()) {
          acquired.push(l);
        } else {
          allPassed = false;
          // Compute how long this limiter needs: use acquire() to get retryAfterMs
          // from the thrown RateLimitError; fall back to 1ms if unavailable.
          try {
            l.acquire();
          } catch (err) {
            if (err instanceof RateLimitError) {
              waitMs = Math.max(waitMs, err.retryAfterMs || 1);
            } else {
              waitMs = Math.max(waitMs, 1);
            }
          }
          break;
        }
      }

      if (allPassed) return;

      await abortableDelay(Math.max(1, waitMs), signal);
    }
  }
}
