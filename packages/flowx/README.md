<div align="center">

<img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=2&height=120&section=header&text=flowx&fontSize=60&fontColor=fff&animation=fadeIn&desc=%40async-kit%2Fflowx&descAlignY=75&descAlign=50" width="100%"/>

<br/>

[![npm](https://img.shields.io/npm/v/@async-kit/flowx?style=for-the-badge&logo=npm&color=45B7D1)](https://www.npmjs.com/package/@async-kit/flowx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](../../LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@async-kit/flowx?style=for-the-badge&color=45B7D1)](https://bundlephobia.com/package/@async-kit/flowx)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Browser](https://img.shields.io/badge/Browser-Supported-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#compatibility)

**Type-safe async pipeline builder — composable steps, fallbacks, per-step timeouts, and concurrency control.**

*Chain transforms, fan-out concurrently, reduce sequentially — all type-safe.*

</div>

---

## Install

```bash
npm install @async-kit/flowx
```

## Quick Start

```typescript
import { pipeline, parallel, sequence } from '@async-kit/flowx';

// Composable async pipeline
const result = await pipeline<string>()
  .pipe(s => s.trim())
  .pipe({ name: 'uppercase', fn: s => s.toUpperCase() })
  .tap(s => console.log('after uppercase:', s))
  .run('  hello world  ');
// → 'HELLO WORLD'

// Concurrent tasks
const [users, products] = await parallel([
  () => fetchUsers(),
  () => fetchProducts(),
], { concurrency: 2 });

// Async reduce
const total = await sequence([1, 2, 3], 0, (acc, n) => acc + n);
// → 6
```

## API

### `pipeline<T>()`

Creates a new empty pipeline starting with type `T`. Returns a `Pipeline<T, T>` builder.

### `Pipeline<TIn, TOut>`

Each method returns a **new Pipeline** — pipelines are immutable and reusable.

| Method | Returns | Description |
|---|---|---|
| `.pipe(step)` | `Pipeline<TIn, TNext>` | Add a transform step |
| `.pipeWithFallback(step, fallback)` | `Pipeline<TIn, TNext>` | Step with an inline error fallback |
| `.tap(fn)` | `Pipeline<TIn, TOut>` | Side-effect step; passes value through unchanged |
| `.run(input, opts?)` | `Promise<TOut>` | Execute the pipeline |
| `.stepCount` | `number` | Number of non-fallback steps |
| `.toArray()` | `StepMeta[]` | Metadata array for debugging/tooling |

#### Step formats

```typescript
// Plain function
.pipe(value => value.trim())

// Named step with optional per-step timeout
.pipe({ name: 'normalize', fn: value => value.trim(), timeoutMs: 1000 })
```

### `FlowxOptions`

```typescript
interface FlowxOptions {
  signal?: AbortSignal;           // Checked between steps
  onStepComplete?: (index, name, result) => void;
  stepTimeoutMs?: number;         // Default per-step timeout (overridable per step)
}
```

### Step Context

Every step receives a `StepContext` as its second argument:

```typescript
interface StepContext {
  signal: AbortSignal;
  stepIndex: number;       // 0-based
  stepName: string | undefined;
}
```

## Fallbacks

`.pipeWithFallback` catches step errors and runs a recovery function instead of propagating:

```typescript
const result = await pipeline<string>()
  .pipeWithFallback(
    { name: 'parse', fn: s => JSON.parse(s) },
    (err, input) => ({ raw: input, error: err.cause })
  )
  .run('invalid json');
// → { raw: 'invalid json', error: SyntaxError }
```

If the **fallback itself throws**, the error is wrapped in `PipelineStepError` (same as a normal step error) so you always get a consistent error type:

```typescript
try {
  await pipeline<string>()
    .pipeWithFallback(
      { name: 'fetch', fn: s => primaryApi.get(s) },
      (_err, id) => fallbackApi.get(id) // this might also fail
    )
    .run(userId);
} catch (err) {
  if (err instanceof PipelineStepError) {
    console.log('step or fallback failed at step', err.stepIndex, err.cause);
  }
}
```

## `parallel(tasks, options?)`

Run tasks concurrently, resolve in declaration order. Rejects on first failure.

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | unbounded | Max simultaneous tasks |
| `signal` | `AbortSignal` | — | Cancel pending tasks |

## `parallelSettled(tasks, options?)`

Same as `parallel` but returns `PromiseSettledResult<T>[]` — never rejects.

## `sequence(items, initial, fn, options?)`

Async left-fold — like `Array.reduce` but supports async reducers and `AbortSignal`.

```typescript
const total = await sequence(orders, 0, async (acc, order) => {
  const price = await fetchPrice(order.id);
  return acc + price;
});
```

## Error Types

| Class | When |
|---|---|
| `PipelineStepError` | A step threw **or a fallback threw** — has `.stepIndex`, `.stepName`, `.cause`, `.inputValue` |
| `PipelineTimeoutError` | Per-step timeout exceeded — has `.stepIndex`, `.stepName`, `.timeoutMs` |

## Examples

### Type-safe order processing pipeline

```typescript
import { pipeline } from '@async-kit/flowx';

interface RawOrder     { id: string; amount: string; userId: string }
interface ParsedOrder  { id: string; amount: number; userId: string }
interface EnrichedOrder extends ParsedOrder { user: User; currency: string }
interface Report       extends EnrichedOrder { formattedAmount: string }

const orderPipeline = pipeline<RawOrder>()
  // Step 0 — parse
  .pipe((raw): ParsedOrder => ({ ...raw, amount: parseFloat(raw.amount) }))
  // Step 1 — validate
  .pipe(async (order) => {
    if (order.amount <= 0) throw new Error(`Invalid amount: ${order.amount}`);
    return order;
  })
  // Step 2 — enrich (concurrent sub-calls)
  .pipe(async (order): Promise<EnrichedOrder> => {
    const [user, currency] = await Promise.all([
      userApi.get(order.userId),
      fxApi.getDefault(order.userId),
    ]);
    return { ...order, user, currency };
  })
  // Step 3 — format
  .pipe((order): Report => ({
    ...order,
    formattedAmount: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: order.currency,
    }).format(order.amount),
  }));

// Reusable — run with any input
const report = await orderPipeline.run(rawOrder, {
  onStepComplete: (i, name) => metrics.track(`order.pipeline.step_${i}_${name}`),
});
```

### Fallback to cache when primary fetch fails

```typescript
import { pipeline } from '@async-kit/flowx';

const enrichedPipeline = pipeline<string>()           // starts with user ID
  .pipeWithFallback(
    { name: 'fetchProfile', fn: id => profileApi.get(id), timeoutMs: 2_000 },
    (_err, id) => cache.get(`profile:${id}`) ?? { id, name: 'Unknown' }
  )
  .pipe({ name: 'fetchOrders', fn: profile => orderApi.list(profile.id), timeoutMs: 3_000 })
  .pipeWithFallback(
    { name: 'fetchInventory', fn: orders => inventoryApi.check(orders) },
    (_err, orders) => orders.map(o => ({ ...o, inStock: null }))
  );

const data = await enrichedPipeline.run(userId);
```

### Fan-out with bounded concurrency

```typescript
import { parallel, parallelSettled } from '@async-kit/flowx';

// All succeed — throws if any fail (like Promise.all)
const [profile, orders, prefs] = await parallel([
  () => userApi.getProfile(userId),
  () => orderApi.getOrders(userId),
  () => prefsApi.get(userId),
], { concurrency: 2 });           // max 2 in-flight

// Tolerate partial failures
const results = await parallelSettled([
  () => analyticsApi.getStats(userId),
  () => notificationsApi.getUnread(userId),
  () => recsApi.get(userId),
]);

for (const r of results) {
  if (r.status === 'fulfilled') console.log(r.value);
  else console.warn('Optional data unavailable:', r.reason);
}
```

### Async reduce with sequence — build a report

```typescript
import { sequence } from '@async-kit/flowx';

const report = await sequence(
  reportSections,
  { sections: [], totalMs: 0 },
  async (acc, section) => {
    const t0 = Date.now();
    const rendered = await renderSection(section);
    return {
      sections: [...acc.sections, rendered],
      totalMs: acc.totalMs + (Date.now() - t0),
    };
  },
  { signal: abortController.signal }
);

console.log(`Built ${report.sections.length} sections in ${report.totalMs}ms`);
```

### Cancellable pipeline with step-level observability

```typescript
import { pipeline } from '@async-kit/flowx';

const controller = new AbortController();

// Cancel from the UI
document.getElementById('cancel')!.onclick = () => controller.abort();

const result = await pipeline<Blob>()
  .pipe({ name: 'upload',    fn: blob => uploadService.store(blob),     timeoutMs: 10_000 })
  .pipe({ name: 'transcode', fn: ref  => transcodeService.run(ref),     timeoutMs: 60_000 })
  .pipe({ name: 'thumbnail', fn: ref  => thumbnailService.generate(ref), timeoutMs: 5_000 })
  .tap(ref => console.log('Asset ready:', ref))
  .run(file, {
    signal: controller.signal,
    onStepComplete: (i, name, result) => {
      console.log(`Step ${i} (${name}) done:`, result);
    },
  });
```

### Reusable pipeline — define once, run many

```typescript
import { pipeline } from '@async-kit/flowx';

const csvPipeline = pipeline<string>()
  .pipe(raw   => raw.trim().split('\n'))
  .pipe(lines => lines.slice(1))                         // skip header
  .pipe(lines => lines.map(l => l.split(',')))
  .pipe(rows  => rows.map(([id, name, score]) => ({
    id: Number(id),
    name: name.trim(),
    score: parseFloat(score),
  })))
  .pipe(rows  => rows.filter(r => r.score >= 0.5));      // threshold

// Run against multiple files concurrently
const [a, b, c] = await Promise.all([
  csvPipeline.run(await readFile('a.csv', 'utf8')),
  csvPipeline.run(await readFile('b.csv', 'utf8')),
  csvPipeline.run(await readFile('c.csv', 'utf8')),
]);
```

### Tap for structured logging

```typescript
import { pipeline } from '@async-kit/flowx';

const pipe = pipeline<Order>()
  .pipe(validate)
  .tap(order => logger.info('validated', { orderId: order.id }))
  .pipe(enrich)
  .tap(order => logger.info('enriched', { user: order.user.name }))
  .pipe(persist)
  .tap(saved => logger.info('persisted', { savedId: saved.id }));

await pipe.run(incomingOrder);
```

## Types

```typescript
import type {
  StepFn,
  StepContext,
  NamedStep,
  FlowxOptions,
  ParallelOptions,
  SequenceOptions,
} from '@async-kit/flowx';
```

## Compatibility

| Environment | Support | Notes |
|---|---|---|
| **Node.js** | ≥ 18 | Recommended ≥ 24 for best performance |
| **Deno** | ✅ | Via npm specifier (`npm:@async-kit/flowx`) |
| **Bun** | ✅ | Full support |
| **Chrome** | ≥ 80 | ESM via bundler or native import |
| **Firefox** | ≥ 75 | ESM via bundler or native import |
| **Safari** | ≥ 13.1 | ESM via bundler or native import |
| **Edge** | ≥ 80 | ESM via bundler or native import |
| **React Native** | ✅ | Via Metro bundler |
| **Cloudflare Workers** | ✅ | ESM, `AbortSignal` natively supported |
| **Vercel Edge Runtime** | ✅ | ESM, no `process` / `fs` dependencies |

**No Node.js built-ins are used.** The package relies only on standard JavaScript (`Promise`, `setTimeout`, `clearTimeout`, `AbortSignal`, `DOMException`) — all available in any modern runtime or browser.

> `PipelineTimeoutError` uses `setTimeout` which is available everywhere. `AbortSignal` is standard since Node.js ≥ 15 and all modern browsers.

## License

MIT © async-kit contributors · Part of the [async-kit](../../README.md) ecosystem
