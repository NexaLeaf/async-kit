export type { StepFn, StepContext, NamedStep, FlowxOptions, ParallelOptions, SequenceOptions } from './types.js';
import type { StepFn, StepContext, NamedStep, FlowxOptions, ParallelOptions, SequenceOptions } from './types.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

export class PipelineStepError extends Error {
  constructor(
    public readonly stepIndex: number,
    public readonly stepName: string | undefined,
    public override readonly cause: unknown,
    public readonly inputValue: unknown
  ) {
    super(
      `Pipeline failed at step ${stepIndex}${stepName ? ` (${stepName})` : ''}: ${String(cause)}`
    );
    this.name = 'PipelineStepError';
  }
}

export class PipelineTimeoutError extends Error {
  constructor(
    public readonly stepIndex: number,
    public readonly stepName: string | undefined,
    public readonly timeoutMs: number
  ) {
    super(`Step ${stepIndex}${stepName ? ` (${stepName})` : ''} timed out after ${timeoutMs}ms`);
    this.name = 'PipelineTimeoutError';
  }
}

// ─── Internal Step Record ────────────────────────────────────────────────────

interface StepRecord {
  fn: StepFn<unknown, unknown>;
  name: string | undefined;
  timeoutMs: number | undefined;
  isFallback: false;
}

interface FallbackRecord {
  fn: (error: PipelineStepError, input: unknown) => unknown | Promise<unknown>;
  isFallback: true;
}

type AnyRecord = StepRecord | FallbackRecord;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const neverAborted = new AbortController().signal;

function raceStepTimeout<T>(
  promise: Promise<T>,
  ms: number,
  index: number,
  name: string | undefined
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PipelineTimeoutError(index, name, ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function normalizeStep<In, Out>(
  step: StepFn<In, Out> | NamedStep<In, Out>
): { fn: StepFn<In, Out>; name: string | undefined; timeoutMs: number | undefined } {
  if (typeof step === 'function') {
    return { fn: step, name: undefined, timeoutMs: undefined };
  }
  return { fn: step.fn, name: step.name, timeoutMs: step.timeoutMs };
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Flowx — composable, type-safe async pipeline builder.
 *
 * Each step receives the output of the previous step as its first argument,
 * plus a `StepContext` carrying the abort signal, step index, and step name.
 *
 * @example
 * const result = await pipeline<string>()
 *   .pipe(s => s.trim())
 *   .pipe({ name: 'uppercase', fn: s => s.toUpperCase() })
 *   .tap(s => console.log('after uppercase:', s))
 *   .run('  hello  ');
 */
export class Pipeline<TIn, TOut> {
  private readonly records: AnyRecord[];

  constructor(records: AnyRecord[] = []) {
    this.records = records;
  }

  /**
   * Add a transform step. Accepts either a plain function or a `NamedStep`
   * object with an optional per-step `timeoutMs`.
   */
  pipe<TNext>(
    step: StepFn<TOut, TNext> | NamedStep<TOut, TNext>
  ): Pipeline<TIn, TNext> {
    const { fn, name, timeoutMs } = normalizeStep(step);
    const record: StepRecord = {
      fn: fn as StepFn<unknown, unknown>,
      name,
      timeoutMs,
      isFallback: false,
    };
    return new Pipeline<TIn, TNext>([...this.records, record]);
  }

  /**
   * Add a step with an inline fallback. If the step throws, `fallback` is
   * called with the error and the original input to that step.
   */
  pipeWithFallback<TNext>(
    step: StepFn<TOut, TNext> | NamedStep<TOut, TNext>,
    fallback: (error: PipelineStepError, input: TOut) => TNext | Promise<TNext>
  ): Pipeline<TIn, TNext> {
    const { fn, name, timeoutMs } = normalizeStep(step);
    const stepRecord: StepRecord = {
      fn: fn as StepFn<unknown, unknown>,
      name,
      timeoutMs,
      isFallback: false,
    };
    const fallbackRecord: FallbackRecord = {
      fn: fallback as (error: PipelineStepError, input: unknown) => unknown,
      isFallback: true,
    };
    return new Pipeline<TIn, TNext>([...this.records, stepRecord, fallbackRecord]);
  }

  /**
   * Add a side-effect step. Runs `fn` for its effect only; passes the current
   * value through unchanged. Errors in `fn` propagate normally.
   */
  tap(fn: (value: TOut, context: StepContext) => void | Promise<void>): Pipeline<TIn, TOut> {
    const tapStep: StepFn<TOut, TOut> = async (value, ctx) => {
      await fn(value, ctx);
      return value;
    };
    return this.pipe(tapStep);
  }

  async run(input: TIn, options: FlowxOptions = {}): Promise<TOut> {
    const signal = options.signal ?? neverAborted;
    const { onStepComplete, stepTimeoutMs } = options;

    let current: unknown = input;
    let stepIndex = 0;

    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i];

      if (record.isFallback) {
        // Fallback records are consumed inline by the preceding step handler.
        continue;
      }

      if (signal.aborted) {
        throw new DOMException('Pipeline aborted', 'AbortError');
      }

      const inputValue = current;
      const ctx: StepContext = { signal, stepIndex, stepName: record.name };
      const effectiveTimeout = record.timeoutMs ?? stepTimeoutMs;

      try {
        const rawResult = record.fn(current, ctx);
        let stepPromise: Promise<unknown> = rawResult instanceof Promise ? rawResult : Promise.resolve(rawResult);
        if (effectiveTimeout != null) {
          stepPromise = raceStepTimeout(stepPromise, effectiveTimeout, stepIndex, record.name);
        }
        current = await stepPromise;
        onStepComplete?.(stepIndex, record.name, current);
      } catch (err) {
        // Check if the next record is a fallback for this step.
        const nextRecord = this.records[i + 1];
        if (nextRecord?.isFallback) {
          const pipelineErr = new PipelineStepError(stepIndex, record.name, err, inputValue);
          current = await nextRecord.fn(pipelineErr, inputValue);
          i++; // skip the fallback record in the outer loop
          onStepComplete?.(stepIndex, record.name, current);
        } else {
          throw new PipelineStepError(stepIndex, record.name, err, inputValue);
        }
      }

      stepIndex++;
    }

    return current as TOut;
  }

  get stepCount(): number {
    return this.records.filter((r) => !r.isFallback).length;
  }

  /** Returns step metadata for debugging/tooling. */
  toArray(): Array<{ index: number; name: string | undefined; timeoutMs: number | undefined }> {
    let idx = 0;
    const result: Array<{ index: number; name: string | undefined; timeoutMs: number | undefined }> = [];
    for (const r of this.records) {
      if (!r.isFallback) {
        result.push({ index: idx++, name: r.name, timeoutMs: r.timeoutMs });
      }
    }
    return result;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Create a new empty pipeline starting with type `T`. */
export function pipeline<T>(): Pipeline<T, T> {
  return new Pipeline<T, T>();
}

// ─── parallel ────────────────────────────────────────────────────────────────

/**
 * Run tasks concurrently, return results in declaration order.
 * Rejects if any task throws (like `Promise.all`).
 */
export async function parallel<T>(
  tasks: Array<() => Promise<T>>,
  options: ParallelOptions = {}
): Promise<T[]> {
  const { concurrency, signal } = options;

  if (concurrency == null || concurrency >= tasks.length) {
    // Unbounded — just Promise.all
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return Promise.all(tasks.map((t) => t()));
  }

  // Bounded concurrency via semaphore
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let hasError = false;
  let firstError: unknown;

  const run = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      if (signal?.aborted || hasError) break;
      const idx = nextIndex++;
      try {
        results[idx] = await tasks[idx]();
      } catch (err) {
        hasError = true;
        firstError = err;
        break;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, run);
  await Promise.all(workers);

  if (hasError) throw firstError;
  return results;
}

/**
 * Run tasks concurrently and return all results regardless of success/failure.
 * Equivalent to `Promise.allSettled` but with optional concurrency control.
 */
export async function parallelSettled<T>(
  tasks: Array<() => Promise<T>>,
  options: Pick<ParallelOptions, 'concurrency' | 'signal'> = {}
): Promise<PromiseSettledResult<T>[]> {
  const { concurrency, signal } = options;
  const wrapped = tasks.map((t) => (): Promise<PromiseSettledResult<T>> =>
    t().then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason })
    )
  );

  return parallel(wrapped, { concurrency, signal }) as Promise<PromiseSettledResult<T>[]>;
}

// ─── sequence ────────────────────────────────────────────────────────────────

/**
 * Async left-fold over an array. Like `Array.reduce` but supports async reducers
 * and can be cancelled via `AbortSignal`.
 */
export async function sequence<T, A>(
  items: T[],
  initial: A,
  fn: (acc: A, item: T, index: number) => Promise<A> | A,
  options: SequenceOptions = {}
): Promise<A> {
  const { signal } = options;
  let acc = initial;
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) throw new DOMException('Sequence aborted', 'AbortError');
    acc = await fn(acc, items[i], i);
  }
  return acc;
}
