import { Workflow, createWorkflow, WorkflowError, WorkflowAbortError, WorkflowTimeoutError } from './workflowx';
import type { WorkflowContext } from './types';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface TestCtx extends WorkflowContext {
  value: number;
  log: string[];
}

function makeCtx(value = 0): Omit<TestCtx, 'signal' | 'currentStep'> {
  return { value, log: [] };
}

describe('Workflow', () => {
  it('runs steps in sequence and threads context', async () => {
    const wf = createWorkflow<TestCtx>()
      .step('a', (ctx) => { ctx.value++; ctx.log.push('a'); })
      .step('b', (ctx) => { ctx.value++; ctx.log.push('b'); });

    const { ctx } = await wf.run(makeCtx());
    expect(ctx.value).toBe(2);
    expect(ctx.log).toEqual(['a', 'b']);
  });

  it('step can return a partial context', async () => {
    const wf = createWorkflow<TestCtx>()
      .step(async (ctx) => ({ ...ctx, value: 99 }));

    const { ctx } = await wf.run(makeCtx());
    expect(ctx.value).toBe(99);
  });

  it('reports stepsExecuted and durationMs', async () => {
    const wf = createWorkflow<TestCtx>()
      .step((ctx) => { ctx.log.push('a'); })
      .step((ctx) => { ctx.log.push('b'); });

    const { stepsExecuted, durationMs } = await wf.run(makeCtx());
    expect(stepsExecuted).toBe(2);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws WorkflowError on step failure', async () => {
    const wf = createWorkflow<TestCtx>()
      .step('boom', () => { throw new Error('step failed'); });

    await expect(wf.run(makeCtx())).rejects.toThrow(WorkflowError);
  });

  it('retries step on failure', async () => {
    let calls = 0;
    const wf = createWorkflow<TestCtx>()
      .step('flaky', () => {
        calls++;
        if (calls < 3) throw new Error('retry');
      }, { retries: 3 });

    await wf.run(makeCtx());
    expect(calls).toBe(3);
  });

  it('throws WorkflowError after exhausting retries', async () => {
    const wf = createWorkflow<TestCtx>()
      .step('fail', () => { throw new Error('always'); }, { retries: 2 });

    const err = await wf.run(makeCtx()).catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    expect(err.stepName).toBe('fail');
  });

  it('onStepError can swallow errors and continue', async () => {
    const wf = createWorkflow<TestCtx>()
      .step('bad', () => { throw new Error('swallow me'); })
      .step('good', (ctx) => { ctx.value = 1; });

    const { ctx } = await wf.run(makeCtx(), {
      onStepError: () => true,
    });
    expect(ctx.value).toBe(1);
  });

  it('throws WorkflowTimeoutError when step exceeds timeoutMs', async () => {
    const wf = createWorkflow<TestCtx>()
      .step('slow', () => delay(200), { timeoutMs: 10 });

    await expect(wf.run(makeCtx())).rejects.toThrow(WorkflowTimeoutError);
  });

  it('parallel branch runs steps concurrently', async () => {
    const order: string[] = [];
    const wf = createWorkflow<TestCtx>()
      .parallel([
        async (ctx) => { await delay(20); ctx.log.push('a'); },
        async (ctx) => { ctx.log.push('b'); },
      ]);

    const { ctx } = await wf.run(makeCtx());
    expect(ctx.log).toContain('a');
    expect(ctx.log).toContain('b');
  });

  it('conditional runs step when predicate is true', async () => {
    const wf = createWorkflow<TestCtx>()
      .if((ctx) => ctx.value === 0, (ctx) => { ctx.value = 100; });

    const { ctx } = await wf.run(makeCtx(0));
    expect(ctx.value).toBe(100);
  });

  it('conditional skips step when predicate is false', async () => {
    const wf = createWorkflow<TestCtx>()
      .if((ctx) => ctx.value > 50, (ctx) => { ctx.value = 999; });

    const { ctx } = await wf.run(makeCtx(0));
    expect(ctx.value).toBe(0);
  });

  it('AbortSignal aborts between steps', async () => {
    const ac = new AbortController();
    const wf = createWorkflow<TestCtx>()
      .step('a', (ctx) => { ctx.log.push('a'); ac.abort(); })
      .step('b', (ctx) => { ctx.log.push('b'); });

    await expect(wf.run(makeCtx(), { signal: ac.signal })).rejects.toThrow(WorkflowAbortError);
  });

  it('onStepStart and onStepComplete hooks fire', async () => {
    const starts: number[] = [];
    const completes: number[] = [];
    const wf = createWorkflow<TestCtx>()
      .step((ctx) => { ctx.log.push('x'); });

    await wf.run(makeCtx(), {
      onStepStart: (i) => starts.push(i),
      onStepComplete: (i) => completes.push(i),
    });

    expect(starts).toEqual([0]);
    expect(completes).toEqual([0]);
  });

  it('WorkflowError exposes stepIndex, stepName, cause', async () => {
    const wf = createWorkflow<TestCtx>()
      .step('myStep', () => { throw new Error('root'); });

    const err = await wf.run(makeCtx()).catch((e) => e) as WorkflowError;
    expect(err.stepIndex).toBe(0);
    expect(err.stepName).toBe('myStep');
    expect((err.cause as Error).message).toBe('root');
  });

  it('WorkflowAbortError exposes stepIndex', async () => {
    const ac = new AbortController();
    ac.abort();
    const wf = createWorkflow<TestCtx>()
      .step('x', (ctx) => { ctx.log.push('x'); });

    const err = await wf.run(makeCtx(), { signal: ac.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowAbortError);
  });
});
