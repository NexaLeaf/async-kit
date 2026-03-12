export type { JitterStrategy, RetryContext, RetryxOptions, CircuitState, CircuitBreakerOptions, CircuitBreakerStats } from './types.js';
import type { JitterStrategy, RetryContext, RetryxOptions, CircuitState, CircuitBreakerOptions, CircuitBreakerStats } from './types.js';

// ─── Error Types ─────────────────────────────────────────────────────────────

export class RetryxError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: unknown,
    /** Every error thrown across all attempts, in order. */
    public readonly allErrors: unknown[]
  ) {
    super(message);
    this.name = 'RetryxError';
  }
}

export class RetryxTimeoutError extends Error {
  constructor(
    public readonly attempt: number,
    public readonly timeoutMs: number
  ) {
    super(`Attempt ${attempt} timed out after ${timeoutMs}ms`);
    this.name = 'RetryxTimeoutError';
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    // Re-check after attaching listener to close the race window between the
    // initial aborted check and addEventListener.
    if (signal?.aborted) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    }
  });
}

function raceTimeout<T>(promise: Promise<T>, ms: number, attempt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RetryxTimeoutError(attempt, ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function computeDelay(
  attempt: number,
  prevDelay: number,
  opts: Required<Pick<RetryxOptions, 'initialDelay' | 'maxDelay' | 'factor' | 'jitter'>>
): number {
  const cap = Math.min(opts.initialDelay * Math.pow(opts.factor, attempt), opts.maxDelay);

  switch (opts.jitter) {
    case 'none':
      return cap;
    case 'full':
      return Math.floor(Math.random() * cap);
    case 'decorrelated':
      // AWS decorrelated jitter: sleep = min(cap, random(base, prev*3))
      // Guard against negative range when prevDelay is very small.
      return Math.min(
        opts.maxDelay,
        Math.floor(opts.initialDelay + Math.random() * (Math.max(opts.initialDelay, prevDelay * 3) - opts.initialDelay))
      );
    case 'equal':
    default:
      return Math.floor(cap / 2 + Math.random() * (cap / 2));
  }
}

// ─── retry ───────────────────────────────────────────────────────────────────

/**
 * Retry an async operation with exponential backoff, jitter, and context-aware hooks.
 *
 * @example
 * const data = await retry(() => fetch('/api').then(r => r.json()), { maxAttempts: 5 });
 */
export async function retry<T>(
  task: () => Promise<T>,
  options: RetryxOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 200,
    maxDelay = 30_000,
    factor = 2,
    jitter = 'equal',
    retryIf = () => true,
    onRetry,
    signal,
    timeoutMs,
  } = options;

  const allErrors: unknown[] = [];
  const startTime = Date.now();
  let prevDelay = initialDelay;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return timeoutMs != null
        ? await raceTimeout(task(), timeoutMs, attempt + 1)
        : await task();
    } catch (err) {
      // Timeout errors always propagate — don't retry by default but respect retryIf
      allErrors.push(err);

      if (attempt === maxAttempts - 1) break;

      const context: RetryContext = {
        attemptNumber: attempt + 1,
        totalAttempts: maxAttempts,
        elapsedMs: Date.now() - startTime,
        errors: [...allErrors],
      };

      const shouldRetry = await retryIf(err, context);
      if (!shouldRetry) break;

      const delayMs = computeDelay(attempt, prevDelay, { initialDelay, maxDelay, factor, jitter });
      prevDelay = delayMs;

      onRetry?.(attempt + 1, err, delayMs, context);
      await abortableDelay(delayMs, signal);
    }
  }

  throw allErrors.length === 1 && allErrors[0] instanceof RetryxTimeoutError
    ? allErrors[0]
    : new RetryxError(
        `All ${maxAttempts} attempts failed`,
        maxAttempts,
        allErrors[allErrors.length - 1],
        allErrors
      );
}

// ─── createRetry ─────────────────────────────────────────────────────────────

/**
 * Create a reusable retry function with pre-configured options.
 *
 * @example
 * const resilient = createRetry({ maxAttempts: 5 });
 * await resilient(() => callApi());
 */
export function createRetry(
  defaults: RetryxOptions
): <T>(task: () => Promise<T>, overrides?: RetryxOptions) => Promise<T> {
  return (task, overrides) => retry(task, { ...defaults, ...overrides });
}

// ─── withRetry ───────────────────────────────────────────────────────────────

/**
 * Wraps an async function so that every call is automatically retried.
 *
 * @example
 * const resilientFetch = withRetry(fetch, { maxAttempts: 3 });
 * const resp = await resilientFetch('/api/users'); // retried on failure
 */
export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RetryxOptions
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs) => retry(() => fn(...args), options);
}

// ─── CircuitBreaker ──────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Circuit is OPEN. Retry after ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit breaker wrapping any async operation.
 *
 * States:
 * - **CLOSED** — calls pass through normally.
 * - **OPEN**   — calls fail fast with `CircuitOpenError`.
 * - **HALF_OPEN** — one probe call is allowed; success closes, failure re-opens.
 *
 * @example
 * const cb = new CircuitBreaker({ failureThreshold: 5, successThreshold: 2, openDurationMs: 10_000 });
 * const result = await cb.run(() => callExternalService());
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private calls = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openDurationMs: number;
  private readonly volumeThreshold: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.successThreshold = options.successThreshold;
    this.openDurationMs = options.openDurationMs;
    this.volumeThreshold = options.volumeThreshold ?? 1;
    this.onStateChange = options.onStateChange;
  }

  get currentState(): CircuitState {
    this.checkHalfOpen();
    return this.state;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    this.checkHalfOpen();

    if (this.state === 'OPEN') {
      const retryAfterMs = Math.max(0, this.openedAt + this.openDurationMs - Date.now());
      throw new CircuitOpenError(retryAfterMs);
    }

    this.calls++;

    try {
      const result = await task();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Manually reset the circuit to CLOSED state. */
  reset(): void {
    const prev = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.calls = 0;
    this.openedAt = 0;
    if (prev !== 'CLOSED') this.onStateChange?.(prev, 'CLOSED');
  }

  stats(): CircuitBreakerStats {
    return {
      failures: this.failures,
      successes: this.successes,
      calls: this.calls,
      state: this.state,
    };
  }

  private checkHalfOpen(): void {
    if (this.state === 'OPEN' && Date.now() >= this.openedAt + this.openDurationMs) {
      this.transition('HALF_OPEN');
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transition('CLOSED');
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === 'HALF_OPEN') {
      this.openedAt = Date.now();
      this.transition('OPEN');
    } else if (this.state === 'CLOSED' && this.calls >= this.volumeThreshold && this.failures >= this.failureThreshold) {
      this.openedAt = Date.now();
      this.transition('OPEN');
    }
  }

  private transition(next: CircuitState): void {
    const prev = this.state;
    this.state = next;
    if (next === 'CLOSED') { this.failures = 0; this.successes = 0; }
    if (next === 'HALF_OPEN') { this.successes = 0; }
    this.onStateChange?.(prev, next);
  }
}
