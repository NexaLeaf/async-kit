export type {
  WorkflowContext, StepFn, WorkflowStep, ParallelBranch,
  ConditionalNode, WorkflowNode, WorkflowRunOptions, WorkflowResult,
} from './types.js';
import type {
  WorkflowContext, StepFn, WorkflowStep, ParallelBranch,
  ConditionalNode, WorkflowNode, WorkflowRunOptions, WorkflowResult,
} from './types.js';

// ─── Errors ───────────────────────────────────────────────────────────────────

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly stepIndex: number,
    public readonly stepName: string | undefined,
    public override readonly cause: unknown
  ) {
    super(message, { cause });
    this.name = 'WorkflowError';
  }
}

export class WorkflowAbortError extends Error {
  constructor(public readonly stepIndex: number) {
    super(`Workflow aborted at step ${stepIndex}`);
    this.name = 'WorkflowAbortError';
  }
}

export class WorkflowTimeoutError extends Error {
  constructor(public readonly stepName: string | undefined) {
    super(`Step "${stepName ?? '<unnamed>'}" timed out`);
    this.name = 'WorkflowTimeoutError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStep<TCtx extends WorkflowContext>(
  node: WorkflowStep<TCtx> | StepFn<TCtx>
): WorkflowStep<TCtx> {
  return typeof node === 'function' ? { fn: node } : node;
}

function isParallel<TCtx extends WorkflowContext>(
  node: WorkflowNode<TCtx>
): node is ParallelBranch<TCtx> {
  return (node as ParallelBranch<TCtx>).kind === 'parallel';
}

function isConditional<TCtx extends WorkflowContext>(
  node: WorkflowNode<TCtx>
): node is ConditionalNode<TCtx> {
  return (node as ConditionalNode<TCtx>).kind === 'conditional';
}

async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number | undefined,
  stepName: string | undefined
): Promise<T> {
  if (!timeoutMs) return fn();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new WorkflowTimeoutError(stepName)),
      timeoutMs
    );
    fn().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

/**
 * Workflow — chains async steps with retry, timeout, parallel branches,
 * conditional execution, and abort-signal support.
 *
 * @example
 * const wf = new Workflow<OrderCtx>();
 * wf.step('validate', async (ctx) => { ctx.validated = true; });
 * wf.parallel([fetchUser, fetchInventory]);
 * wf.if((ctx) => ctx.isPremium, applyDiscount);
 * const { ctx } = await wf.run({ orderId: '123', signal, currentStep: 0 });
 */
export class Workflow<TCtx extends WorkflowContext> {
  private readonly nodes: WorkflowNode<TCtx>[] = [];

  /** Add a single named step. */
  step(name: string, fn: StepFn<TCtx>, opts?: Omit<WorkflowStep<TCtx>, 'name' | 'fn'>): this;
  step(fn: StepFn<TCtx>, opts?: Omit<WorkflowStep<TCtx>, 'fn'>): this;
  step(
    nameOrFn: string | StepFn<TCtx>,
    fnOrOpts?: StepFn<TCtx> | Omit<WorkflowStep<TCtx>, 'fn'>,
    opts?: Omit<WorkflowStep<TCtx>, 'name' | 'fn'>
  ): this {
    if (typeof nameOrFn === 'string') {
      this.nodes.push({ name: nameOrFn, fn: fnOrOpts as StepFn<TCtx>, ...(opts ?? {}) });
    } else {
      this.nodes.push({ fn: nameOrFn, ...((fnOrOpts ?? {}) as Omit<WorkflowStep<TCtx>, 'fn'>) });
    }
    return this;
  }

  /** Add a parallel branch — all given steps run concurrently. */
  parallel(steps: Array<WorkflowStep<TCtx> | StepFn<TCtx>>): this {
    this.nodes.push({ kind: 'parallel', steps });
    return this;
  }

  /** Add a conditional step — runs only when predicate returns true. */
  if(
    predicate: ConditionalNode<TCtx>['predicate'],
    step: WorkflowStep<TCtx> | StepFn<TCtx>
  ): this {
    this.nodes.push({ kind: 'conditional', predicate, step });
    return this;
  }

  /** Execute the workflow against the given initial context. */
  async run(initialCtx: Omit<TCtx, 'signal' | 'currentStep'> & Partial<Pick<TCtx, 'signal' | 'currentStep'>>, options: WorkflowRunOptions = {}): Promise<WorkflowResult<TCtx>> {
    const abortController = new AbortController();
    const externalSignal = options.signal;

    // Wire external signal into our controller
    const onExternalAbort = () => abortController.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    // If already aborted, propagate immediately
    if (externalSignal?.aborted) abortController.abort();

    const ctx = {
      ...initialCtx,
      signal: abortController.signal,
      currentStep: 0,
    } as TCtx;

    const wallStart = Date.now();
    let stepsExecuted = 0;

    try {
      for (let i = 0; i < this.nodes.length; i++) {
        ctx.currentStep = i;

        if (abortController.signal.aborted) {
          throw new WorkflowAbortError(i);
        }

        const node = this.nodes[i];
        const stepStart = Date.now();

        if (isParallel(node)) {
          options.onStepStart?.(i, 'parallel');
          await this._runParallel(node, ctx, abortController.signal);
          options.onStepComplete?.(i, 'parallel', Date.now() - stepStart);
        } else if (isConditional(node)) {
          const shouldRun = await node.predicate(ctx);
          if (shouldRun) {
            const step = normalizeStep(node.step);
            options.onStepStart?.(i, step.name);
            await this._runStep(step, ctx, i, options);
            options.onStepComplete?.(i, step.name, Date.now() - stepStart);
          }
        } else {
          const step = normalizeStep(node as WorkflowStep<TCtx> | StepFn<TCtx>);
          options.onStepStart?.(i, step.name);
          await this._runStep(step, ctx, i, options);
          options.onStepComplete?.(i, step.name, Date.now() - stepStart);
        }

        stepsExecuted++;
      }
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }

    return {
      ctx,
      durationMs: Date.now() - wallStart,
      stepsExecuted,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _runStep(
    step: WorkflowStep<TCtx>,
    ctx: TCtx,
    index: number,
    options: WorkflowRunOptions
  ): Promise<void> {
    const retries = step.retries ?? 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (ctx.signal.aborted) throw new WorkflowAbortError(index);

      try {
        const result = await runWithTimeout(
          () => Promise.resolve(step.fn(ctx)),
          step.timeoutMs,
          step.name
        );
        if (result !== undefined && result !== null) {
          Object.assign(ctx, result);
        }
        return; // success
      } catch (err) {
        // Timeout and abort errors bubble directly without wrapping
        if (err instanceof WorkflowTimeoutError || err instanceof WorkflowAbortError) throw err;
        const swallow = options.onStepError?.(index, step.name, err, attempt);
        if (swallow) return;
        if (attempt < retries) continue;
        throw new WorkflowError(
          `Step "${step.name ?? index}" failed after ${attempt + 1} attempt(s)`,
          index,
          step.name,
          err
        );
      }
    }
  }

  private async _runParallel(
    branch: ParallelBranch<TCtx>,
    ctx: TCtx,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) throw new WorkflowAbortError(ctx.currentStep);

    await Promise.all(
      branch.steps.map(async (s) => {
        const step = normalizeStep(s);
        const result = await runWithTimeout(
          () => Promise.resolve(step.fn(ctx)),
          step.timeoutMs,
          step.name
        );
        if (result !== undefined && result !== null) {
          Object.assign(ctx, result);
        }
      })
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new workflow.
 *
 * @example
 * const wf = createWorkflow<MyCtx>()
 *   .step('load', loadData)
 *   .step('process', processData);
 * const { ctx } = await wf.run(initialCtx);
 */
export function createWorkflow<TCtx extends WorkflowContext>(): Workflow<TCtx> {
  return new Workflow<TCtx>();
}
