# @async-kit/workflowx

Lightweight async workflow engine with **step sequencing**, **retry**, **timeout**, **parallel branches**, **conditional steps**, and **AbortSignal** support.

## Install

```bash
npm install @async-kit/workflowx
```

## Quick start

```ts
import { createWorkflow } from '@async-kit/workflowx';

interface OrderCtx extends WorkflowContext {
  orderId: string;
  user?: User;
  inventory?: Item[];
}

const workflow = createWorkflow<OrderCtx>()
  .step('validate',  validateOrder)
  .parallel([fetchUser, fetchInventory])
  .if((ctx) => ctx.user?.isPremium, applyDiscount)
  .step('charge',    chargeCard)
  .step('notify',    sendConfirmation);

const { ctx, durationMs } = await workflow.run({ orderId: 'ord_123' });
```

## Features

| Feature | Description |
|---|---|
| **Step sequencing** | Steps run in declaration order, sharing a typed context |
| **Parallel branches** | `.parallel([...])` — all steps run concurrently, then rejoin |
| **Conditional steps** | `.if(predicate, step)` — skip steps based on context |
| **Retry** | Per-step `retries` with automatic re-execution |
| **Timeout** | Per-step `timeoutMs` — throws `WorkflowTimeoutError` |
| **AbortSignal** | Cancels between steps via `WorkflowRunOptions.signal` |
| **Hooks** | `onStepStart`, `onStepComplete`, `onStepError` |
| **Context threading** | All steps mutate/return the same typed context |

## API

### `createWorkflow<TCtx>()`

Returns a `Workflow<TCtx>` builder.

### `.step(name?, fn, options?)`

```ts
wf.step('fetchUser', async (ctx) => {
  ctx.user = await getUser(ctx.userId);
}, { retries: 2, timeoutMs: 5_000 });
```

### `.parallel(steps)`

```ts
wf.parallel([
  async (ctx) => { ctx.user = await getUser(ctx.id); },
  async (ctx) => { ctx.items = await getCart(ctx.id); },
]);
```

### `.if(predicate, step)`

```ts
wf.if(
  (ctx) => ctx.total > 100,
  (ctx) => { ctx.discount = 0.1; }
);
```

### `workflow.run(initialCtx, options?)`

```ts
const { ctx, durationMs, stepsExecuted } = await workflow.run(
  { orderId: 'x', currentStep: 0 },
  {
    signal: abortController.signal,
    onStepStart: (i, name) => console.log(`▶ ${i} ${name}`),
    onStepComplete: (i, name, ms) => console.log(`✓ ${name} (${ms}ms)`),
    onStepError: (i, name, err, attempt) => {
      logger.warn({ name, attempt, err });
      return attempt < 2; // true = swallow and continue
    },
  }
);
```

## WorkflowContext

Every workflow context must extend `WorkflowContext`:

```ts
interface WorkflowContext {
  signal: AbortSignal;   // checked between steps
  currentStep: number;   // 0-based node index
  [key: string]: unknown;
}
```

You only need to provide your own fields — `signal` and `currentStep` are injected by `run()`.

## Errors

| Error | When |
|---|---|
| `WorkflowError` | Step fails after exhausting retries (`.cause` = original error) |
| `WorkflowAbortError` | AbortSignal fires between steps |
| `WorkflowTimeoutError` | Step exceeds `timeoutMs` |

```ts
import { WorkflowError, WorkflowAbortError, WorkflowTimeoutError } from '@async-kit/workflowx';

try {
  await wf.run(ctx);
} catch (err) {
  if (err instanceof WorkflowError) {
    console.error(err.stepName, err.cause);
  }
}
```

## Examples

### Retry + timeout

```ts
wf.step('callExternal', callThirdPartyApi, { retries: 3, timeoutMs: 2_000 });
```

### Aborting mid-workflow

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5_000); // cancel after 5 s

await wf.run(ctx, { signal: ac.signal });
```

### Observability hooks

```ts
await wf.run(ctx, {
  onStepStart: (i, name) => metrics.startTimer(`step.${name}`),
  onStepComplete: (i, name, ms) => metrics.recordDuration(`step.${name}`, ms),
  onStepError: (i, name, err, attempt) => {
    logger.warn('step failed', { name, attempt, err });
  },
});
```

## License

MIT
