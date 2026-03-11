// ─── retryx — Public Types ────────────────────────────────────────────────────

/**
 * Jitter strategy for exponential backoff.
 * - `'equal'`        — `cap/2 + random(0, cap/2)`  (default, preserves mean delay)
 * - `'full'`         — `random(0, cap)`              (AWS recommended for highest spread)
 * - `'decorrelated'` — `min(cap, random(base, prev * 3))` (aggressive spread)
 * - `'none'`         — no randomization
 */
export type JitterStrategy = 'equal' | 'full' | 'decorrelated' | 'none';

/** Context object passed to `retryIf` and `onRetry` callbacks. */
export interface RetryContext {
  /** 1-based attempt number of the attempt that just failed. */
  attemptNumber: number;
  /** Total configured max attempts. */
  totalAttempts: number;
  /** Wall-clock ms elapsed since the first attempt started. */
  elapsedMs: number;
  /** All errors collected so far, in order. */
  errors: unknown[];
}

/** Options for `retry()` and `createRetry()`. */
export interface RetryxOptions {
  /** Total attempts including the first. Default: `3`. */
  maxAttempts?: number;
  /** Base delay in ms before the first retry. Default: `200`. */
  initialDelay?: number;
  /** Maximum delay cap in ms. Default: `30_000`. */
  maxDelay?: number;
  /** Backoff multiplier. Default: `2`. */
  factor?: number;
  /** Jitter strategy. Default: `'equal'`. */
  jitter?: JitterStrategy;
  /**
   * Return `false` to stop retrying immediately.
   * Receives the error and full context. May be async.
   */
  retryIf?: (error: unknown, context: RetryContext) => boolean | Promise<boolean>;
  /** Called before each retry delay. */
  onRetry?: (attemptNumber: number, error: unknown, delayMs: number, context: RetryContext) => void;
  /** AbortSignal — cancels pending retry delays. */
  signal?: AbortSignal;
  /** Per-attempt timeout in ms. Throws `RetryxTimeoutError` if exceeded. */
  timeoutMs?: number;
}

/** All possible circuit breaker states. */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Constructor options for `CircuitBreaker`. */
export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit. */
  failureThreshold: number;
  /** Successes in HALF_OPEN state needed to re-close. */
  successThreshold: number;
  /** How long (ms) to stay OPEN before moving to HALF_OPEN. */
  openDurationMs: number;
  /** Minimum calls in the window before the circuit can trip. Default: `1`. */
  volumeThreshold?: number;
  /** Called whenever the circuit transitions between states. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/** Snapshot of `CircuitBreaker` counters and state. */
export interface CircuitBreakerStats {
  failures: number;
  successes: number;
  calls: number;
  state: CircuitState;
}
