export type { Task, RunOptions, LimitxOptions, LimitxCounts, LimitxHandle } from './types.js';
import type { Task, RunOptions, LimitxOptions, LimitxCounts } from './types.js';

// ─── Error Types ────────────────────────────────────────────────────────────

export class LimitxTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly taskId?: string
  ) {
    super(`Task timed out after ${timeoutMs}ms`);
    this.name = 'LimitxTimeoutError';
  }
}

export class LimitxAbortError extends Error {
  constructor(message = 'Task cancelled via clear()') {
    super(message);
    this.name = 'LimitxAbortError';
  }
}

// ─── Internal Queue Entry ────────────────────────────────────────────────────

interface QueueEntry {
  fn: () => void;
  priority: number;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

// ─── Core Class ─────────────────────────────────────────────────────────────

/**
 * Limitx — async concurrency limiter with priority queue, pause/resume,
 * per-task timeouts, and event-driven drain.
 *
 * @example
 * const limiter = new Limitx({ concurrency: 5 });
 * const result = await limiter.run(() => fetchUser(id), { priority: 10 });
 * await limiter.drain();
 */
export class Limitx {
  private readonly concurrency: number;
  private readonly defaultPriority: number;
  private readonly onError?: (error: unknown) => void;

  private running = 0;
  private paused = false;
  private readonly queue: QueueEntry[] = [];
  private readonly drainWaiters: Array<() => void> = [];

  constructor(options: LimitxOptions) {
    if (options.concurrency < 1) {
      throw new RangeError('concurrency must be >= 1');
    }
    this.concurrency = options.concurrency;
    this.defaultPriority = options.defaultPriority ?? 0;
    this.onError = options.onError;
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Atomic snapshot — avoids TOCTOU between reading two separate getters. */
  counts(): LimitxCounts {
    return {
      active: this.running,
      pending: this.queue.length,
      total: this.running + this.queue.length,
    };
  }

  // ── Run ──────────────────────────────────────────────────────────────────

  run<T>(task: Task<T>, options?: RunOptions): Promise<T> {
    const priority = options?.priority ?? this.defaultPriority;
    const timeoutMs = options?.timeoutMs;
    const signal = options?.signal;

    // Reject immediately if already aborted before even queuing
    if (signal?.aborted) {
      return Promise.reject(new LimitxAbortError('Task cancelled before queuing (signal already aborted)'));
    }

    return new Promise<T>((resolve, reject) => {
      const execute = async (): Promise<void> => {
        this.running++;
        try {
          const result = timeoutMs != null
            ? await raceTimeout(task(), timeoutMs)
            : await task();
          resolve(result);
        } catch (err) {
          this.onError?.(err);
          reject(err);
        } finally {
          this.running--;
          this.next();
        }
      };

      if (!this.paused && this.running < this.concurrency) {
        void execute();
      } else {
        const entry: QueueEntry = { fn: () => void execute(), priority, reject, signal };

        if (signal) {
          // Cancel from the queue if the signal fires while the task is still waiting
          entry.abortHandler = () => {
            const idx = this.queue.indexOf(entry);
            if (idx !== -1) {
              this.queue.splice(idx, 1);
              this.notifyDrain();
            }
            reject(new LimitxAbortError('Task cancelled via AbortSignal'));
          };
          signal.addEventListener('abort', entry.abortHandler, { once: true });
        }

        this.enqueue(entry);
      }
    });
  }

  /** Submit multiple tasks and return results in submission order. */
  runAll<T>(tasks: Task<T>[], options?: RunOptions): Promise<T[]> {
    return Promise.all(tasks.map((t) => this.run(t, options)));
  }

  // ── Control ──────────────────────────────────────────────────────────────

  /** Stop dequeuing. Already-running tasks continue. New tasks are queued. */
  pause(): void {
    this.paused = true;
  }

  /** Resume dequeuing. Fills available concurrency slots immediately. */
  resume(): void {
    this.paused = false;
    const slots = this.concurrency - this.running;
    for (let i = 0; i < slots; i++) {
      const entry = this.queue.shift();
      if (!entry) break;
      if (entry.abortHandler) entry.signal!.removeEventListener('abort', entry.abortHandler);
      entry.fn();
    }
  }

  /**
   * Cancel all pending (queued, not yet started) tasks.
   * Each cancelled task rejects with `LimitxAbortError`.
   * @returns Number of tasks cancelled.
   */
  clear(): number {
    const count = this.queue.length;
    const err = new LimitxAbortError();
    for (const entry of this.queue) {
      if (entry.abortHandler) entry.signal!.removeEventListener('abort', entry.abortHandler);
      entry.reject(err);
    }
    this.queue.length = 0;
    return count;
  }

  /**
   * Returns a Promise that resolves when all active and pending tasks finish.
   * Uses an event-driven approach — no `setTimeout` polling.
   *
   * Safe to call multiple times concurrently: all callers resolve together
   * when the queue and active count both reach zero.
   */
  drain(): Promise<void> {
    // Check inside the executor to avoid the TOCTOU race where the queue
    // empties between the outer check and the push.
    return new Promise<void>((resolve) => {
      if (this.running === 0 && this.queue.length === 0) {
        resolve();
      } else {
        this.drainWaiters.push(resolve);
      }
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private enqueue(entry: QueueEntry): void {
    // Binary-search insert by descending priority (higher number runs first).
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.queue[mid].priority >= entry.priority) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, entry);
  }

  private next(): void {
    this.notifyDrain();
    if (this.paused) return;
    const entry = this.queue.shift();
    if (entry) {
      if (entry.abortHandler) entry.signal!.removeEventListener('abort', entry.abortHandler);
      entry.fn();
    }
  }

  private notifyDrain(): void {
    if (this.running === 0 && this.queue.length === 0 && this.drainWaiters.length > 0) {
      const waiters = this.drainWaiters.splice(0);
      for (const w of waiters) w();
    }
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LimitxTimeoutError(ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ─── Factory ─────────────────────────────────────────────────────────────────

// LimitxHandle is defined in types.ts

/**
 * Convenience factory — creates a `Limitx` instance and returns a bound run
 * function that also exposes the underlying limiter via `.limiter`.
 *
 * @example
 * const limit = createLimit(5);
 * await limit(() => fetchUser(id));
 * await limit.limiter.drain();
 */
export function createLimit(
  concurrency: number,
  options?: Omit<LimitxOptions, 'concurrency'>
): { <T>(task: Task<T>, opts?: RunOptions): Promise<T>; limiter: Limitx } {
  const limiter = new Limitx({ concurrency, ...options });
  const fn = <T>(task: Task<T>, opts?: RunOptions): Promise<T> => limiter.run(task, opts);
  (fn as unknown as { limiter: Limitx }).limiter = limiter;
  return fn as { <T>(task: Task<T>, opts?: RunOptions): Promise<T>; limiter: Limitx };
}
