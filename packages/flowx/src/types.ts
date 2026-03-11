// ─── flowx — Public Types ─────────────────────────────────────────────────────

/** A pipeline step function: transforms `In` → `Out`, optionally async. */
export type StepFn<In, Out> = (input: In, context: StepContext) => Promise<Out> | Out;

/** Context injected into every pipeline step. */
export interface StepContext {
  /** AbortSignal — passed into every step for fine-grained cancellation. */
  signal: AbortSignal;
  /** 0-based index of the current step. */
  stepIndex: number;
  /** Name of the step, if provided. */
  stepName: string | undefined;
}

/** A named step with an optional per-step timeout override. */
export interface NamedStep<In, Out> {
  name: string;
  fn: StepFn<In, Out>;
  /** Per-step timeout in ms. Overrides `FlowxOptions.stepTimeoutMs`. */
  timeoutMs?: number;
}

/** Options passed to `Pipeline.run()`. */
export interface FlowxOptions {
  /** AbortSignal — checked between steps and passed into each step's context. */
  signal?: AbortSignal;
  /** Called after each step completes successfully. */
  onStepComplete?: (stepIndex: number, stepName: string | undefined, result: unknown) => void;
  /** Default timeout per step in ms. Can be overridden per step in `NamedStep`. */
  stepTimeoutMs?: number;
}

/** Options for `parallel()` and `parallelSettled()`. */
export interface ParallelOptions {
  /** Limit simultaneous tasks. Undefined = unbounded. */
  concurrency?: number;
  /** AbortSignal — cancels pending tasks when aborted. */
  signal?: AbortSignal;
  /** Called as each task settles. */
  onSettle?: (index: number, result: PromiseSettledResult<unknown>) => void;
}

/** Options for `sequence()`. */
export interface SequenceOptions {
  signal?: AbortSignal;
}
