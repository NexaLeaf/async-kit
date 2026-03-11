// ─── ratelimitx — Public Types ───────────────────────────────────────────────

/** Constructor options for `TokenBucket`. */
export interface TokenBucketOptions {
  /** Maximum token capacity (burst size). */
  capacity: number;
  /** Tokens added per `refillInterval`. */
  refillRate: number;
  /** Interval in ms at which tokens are added. Default: `1000`. */
  refillInterval?: number;
}

/** Constructor options for `SlidingWindow`. */
export interface SlidingWindowOptions {
  /** Rolling window duration in ms. */
  windowMs: number;
  /** Maximum requests allowed per window. */
  maxRequests: number;
}

/** Constructor options for `FixedWindow`. */
export interface FixedWindowOptions {
  /** Window duration in ms. */
  windowMs: number;
  /** Maximum requests per window. */
  maxRequests: number;
  /** Called each time the window resets. */
  onWindowReset?: (windowStart: number) => void;
}

/**
 * Common interface implemented by all three rate-limiter classes
 * and accepted by `CompositeLimiter`.
 */
export interface Limiter {
  tryAcquire(): boolean;
  acquire(): void;
  waitAndAcquire(signal?: AbortSignal): Promise<void>;
}

/** Algorithm tag used in `RateLimitError`. */
export type RateLimitAlgorithm = 'token-bucket' | 'sliding-window' | 'fixed-window';
