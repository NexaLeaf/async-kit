// ─── workflowx — Public Types ─────────────────────────────────────────────────

/**
 * The shared context object threaded through every workflow step.
 * Start with your own base type:
 *
 * @example
 * interface OrderCtx extends WorkflowContext {
 *   orderId: string;
 *   user?: User;
 * }
 */
export interface WorkflowContext {
  /** AbortSignal — checked between steps. Pass your own via `WorkflowRunOptions.signal`. */
  signal: AbortSignal;
  /** Step index currently executing (0-based). */
  currentStep: number;
  /** Metadata written by steps — freely extensible. */
  [key: string]: unknown;
}

/** A single workflow step function. Mutates or returns context. */
export type StepFn<TCtx extends WorkflowContext> =
  (ctx: TCtx) => Promise<TCtx | void> | TCtx | void;

/** Named step with optional retry and timeout. */
export interface WorkflowStep<TCtx extends WorkflowContext> {
  /** Display name shown in hooks and errors. */
  name?: string;
  /** The step function. */
  fn: StepFn<TCtx>;
  /** Retry this step up to N times on failure. Default: `0`. */
  retries?: number;
  /** Throw `WorkflowTimeoutError` if the step takes longer than this. */
  timeoutMs?: number;
}

/** A branch of parallel steps — all run concurrently, then rejoin. */
export interface ParallelBranch<TCtx extends WorkflowContext> {
  kind: 'parallel';
  steps: Array<WorkflowStep<TCtx> | StepFn<TCtx>>;
}

/** A conditional node — runs the step only if the predicate returns true. */
export interface ConditionalNode<TCtx extends WorkflowContext> {
  kind: 'conditional';
  predicate: (ctx: TCtx) => boolean | Promise<boolean>;
  step: WorkflowStep<TCtx> | StepFn<TCtx>;
}

/** Any node type that can appear in a workflow. */
export type WorkflowNode<TCtx extends WorkflowContext> =
  | WorkflowStep<TCtx>
  | ParallelBranch<TCtx>
  | ConditionalNode<TCtx>;

/** Options passed to `workflow.run()`. */
export interface WorkflowRunOptions {
  /** AbortSignal — checked between steps. */
  signal?: AbortSignal;
  /**
   * Called when each step/branch starts.
   * `index` is the 0-based node index in the workflow.
   */
  onStepStart?: (index: number, name: string | undefined) => void;
  /**
   * Called after each step/branch completes successfully.
   */
  onStepComplete?: (index: number, name: string | undefined, durationMs: number) => void;
  /**
   * Called when a step fails (including retry attempts).
   * Return `true` to swallow the error and continue.
   */
  onStepError?: (index: number, name: string | undefined, error: unknown, attempt: number) => boolean | void;
}

/** Snapshot returned after `workflow.run()` completes. */
export interface WorkflowResult<TCtx extends WorkflowContext> {
  /** Final context after all steps. */
  ctx: TCtx;
  /** Total wall-clock time for the entire workflow in ms. */
  durationMs: number;
  /** Number of nodes executed (parallel branches count as 1). */
  stepsExecuted: number;
}
