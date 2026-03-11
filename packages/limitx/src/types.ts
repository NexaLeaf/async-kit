// ─── limitx — Public Types ────────────────────────────────────────────────────

/** A zero-argument async function representing a unit of work. */
export type Task<T> = () => Promise<T>;

/** Per-call options passed to `Limitx.run()`. */
export interface RunOptions {
  /** Higher number = higher priority. Default: `0`. */
  priority?: number;
  /** Reject with `LimitxTimeoutError` if task takes longer than this. */
  timeoutMs?: number;
}

/** Constructor options for `Limitx`. */
export interface LimitxOptions {
  /** Maximum number of concurrently running tasks. Must be >= 1. */
  concurrency: number;
  /** Default priority for tasks when none is specified. Default: `0`. */
  defaultPriority?: number;
  /** Called whenever any task throws. Does not suppress the rejection. */
  onError?: (error: unknown) => void;
}

/** Atomic snapshot of active / pending / total task counts. */
export interface LimitxCounts {
  active: number;
  pending: number;
  total: number;
}

/**
 * The function type returned by `createLimit`.
 * Callable directly as `limit(task)` and exposes `.limiter` for full control.
 */
export interface LimitxHandle<T> {
  (task: Task<T>, options?: RunOptions): Promise<T>;
  readonly limiter: import('./limitx.js').Limitx;
}
