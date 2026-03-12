<div align="center">

<img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=20&height=120&section=header&text=limitx&fontSize=60&fontColor=fff&animation=fadeIn&desc=%40async-kit%2Flimitx&descAlignY=75&descAlign=50" width="100%"/>

<br/>

[![npm](https://img.shields.io/npm/v/@async-kit/limitx?style=for-the-badge&logo=npm&color=FF6B6B)](https://www.npmjs.com/package/@async-kit/limitx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](../../LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@async-kit/limitx?style=for-the-badge&color=FF6B6B)](https://bundlephobia.com/package/@async-kit/limitx)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Browser](https://img.shields.io/badge/Browser-Supported-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#compatibility)

**Async concurrency limiter with priority queue, pause/resume, per-task timeouts, and event-driven drain.**

*Run at most N async tasks at the same time. Queue the rest by priority.*

</div>

---

## Install

```bash
npm install @async-kit/limitx
```

## Quick Start

```typescript
import { Limitx, createLimit } from '@async-kit/limitx';

// Class API — full control
const limiter = new Limitx({ concurrency: 5 });
const result = await limiter.run(() => fetchUser(id), { priority: 10 });
await limiter.drain();

// Factory API — callable shorthand
const limit = createLimit(5);
await limit(() => fetchUser(id));
await limit.limiter.drain();
```

## API

### `new Limitx(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | required | Max simultaneous tasks (≥ 1) |
| `defaultPriority` | `number` | `0` | Default priority when not specified in `run()` |
| `onError` | `(err) => void` | — | Called on every task error (does not suppress rejection) |

#### Instance methods

| Method | Returns | Description |
|---|---|---|
| `.run(task, opts?)` | `Promise<T>` | Schedule a task; resolves/rejects with the task's result |
| `.runAll(tasks, opts?)` | `Promise<T[]>` | Schedule multiple tasks; resolves in submission order |
| `.pause()` | `void` | Stop dequeuing (running tasks continue) |
| `.resume()` | `void` | Resume dequeuing, fills available slots immediately |
| `.clear()` | `number` | Cancel all queued tasks (rejects with `LimitxAbortError`), returns count |
| `.drain()` | `Promise<void>` | Resolves when all active + pending tasks finish (event-driven, no polling, safe to call concurrently) |
| `.counts()` | `LimitxCounts` | Atomic snapshot: `{ active, pending, total }` |

#### Getters

| Getter | Type | Description |
|---|---|---|
| `.activeCount` | `number` | Tasks currently running |
| `.pendingCount` | `number` | Tasks waiting in the priority queue |
| `.isPaused` | `boolean` | Whether the limiter is paused |

### `RunOptions`

```typescript
interface RunOptions {
  priority?: number;   // Higher = runs sooner. Default: 0
  timeoutMs?: number;  // Throws LimitxTimeoutError if task exceeds this
  signal?: AbortSignal; // Cancel while queued — rejects with LimitxAbortError
}
```

> **`signal` scope:** cancels the task only while it is **waiting in the queue**. Once a task starts executing, the signal has no effect on it. To cancel running work, pass the signal into the task itself.

### `createLimit(concurrency, options?)`

Returns a callable `limit(task, opts?)` function with a `.limiter` property for access to the underlying `Limitx` instance.

## Priority Queue

Tasks are ordered by **descending priority** using binary-search insertion — O(log n).

```typescript
const limiter = new Limitx({ concurrency: 1 });
limiter.run(backgroundTask,  { priority: 0  });
limiter.run(criticalTask,    { priority: 10 }); // runs first when slot opens
```

## Per-Task Timeouts

```typescript
await limiter.run(() => heavyTask(), { timeoutMs: 5000 });
// Throws LimitxTimeoutError after 5 s
```

## Pause / Resume

```typescript
limiter.pause();             // stop dequeuing
// ... enqueue more tasks ...
limiter.resume();            // fill slots immediately
```

## AbortSignal Support

Cancel a queued task before it starts executing:

```typescript
const controller = new AbortController();

const promise = limiter.run(() => heavyTask(), {
  priority: 5,
  signal: controller.signal,
});

// Cancel while still queued
controller.abort();

try {
  await promise;
} catch (err) {
  if (err instanceof LimitxAbortError) {
    console.log('Task was cancelled before it started');
  }
}
```

You can also abort immediately if the signal is already aborted before `run()` is called:

```typescript
const ac = new AbortController();
ac.abort(); // already aborted

// Rejects synchronously with LimitxAbortError — never enters the queue
await limiter.run(task, { signal: ac.signal });
```

## Error Types

| Class | When |
|---|---|
| `LimitxTimeoutError` | `timeoutMs` exceeded — has `.timeoutMs` |
| `LimitxAbortError` | Task cancelled by `.clear()` or `RunOptions.signal` |

## Types

```typescript
import type {
  Task,
  RunOptions,
  LimitxOptions,
  LimitxCounts,
  LimitxHandle,
} from '@async-kit/limitx';
```

## Examples

### Throttle 1 000 API calls to 10 at a time

```typescript
import { createLimit } from '@async-kit/limitx';

const limit = createLimit(10);
const ids = Array.from({ length: 1000 }, (_, i) => i + 1);

const users = await Promise.all(
  ids.map(id => limit(() => fetch(`/api/users/${id}`).then(r => r.json())))
);
console.log(`Fetched ${users.length} users`);
```

### Database connection pool with error tracking

```typescript
import { Limitx } from '@async-kit/limitx';

const pool = new Limitx({
  concurrency: 20,                       // mirror your DB pool size
  onError: (err) => metrics.increment('db.error'),
});

async function queryUser(id: string) {
  return pool.run(() =>
    db.query('SELECT * FROM users WHERE id = $1', [id])
  );
}

// Process 10 000 records — at most 20 queries run in parallel
const records = await loadIds();
const results = await Promise.allSettled(
  records.map(id => queryUser(id))
);
await pool.drain();
console.log('All queries settled');
```

### Priority queue — VIP requests jump the line

```typescript
import { Limitx } from '@async-kit/limitx';

const limiter = new Limitx({ concurrency: 2 });

// Low-priority background sync
for (const item of bulkItems) {
  void limiter.run(() => syncItem(item), { priority: 0 });
}

// High-priority user request — jumps ahead in the queue
const result = await limiter.run(
  () => fetchDashboard(userId),
  { priority: 100 }
);
```

### Pause during maintenance window, resume after

```typescript
import { Limitx } from '@async-kit/limitx';

const limiter = new Limitx({ concurrency: 5 });

// Enqueue work in the background
for (const job of jobs) void limiter.run(() => processJob(job));

// Maintenance window: stop dispatching new tasks
limiter.pause();
console.log(`Paused — ${limiter.pendingCount} tasks queued`);

await performMaintenance();

limiter.resume();           // fills all concurrency slots immediately
await limiter.drain();      // event-driven — resolves when truly empty
console.log('All done');
```

### Per-task timeout with graceful handling

```typescript
import { Limitx, LimitxTimeoutError } from '@async-kit/limitx';

const limiter = new Limitx({ concurrency: 3 });

const results = await Promise.allSettled(
  tasks.map(task =>
    limiter.run(() => heavyOperation(task), { timeoutMs: 5_000 })
  )
);

for (const r of results) {
  if (r.status === 'rejected' && r.reason instanceof LimitxTimeoutError) {
    console.warn(`Task timed out after ${r.reason.timeoutMs}ms`);
  }
}
```

### Fire-and-forget with clear() for graceful shutdown

```typescript
import { Limitx, LimitxAbortError } from '@async-kit/limitx';

const limiter = new Limitx({ concurrency: 5 });

// Enqueue background indexing work
for (const doc of documents) {
  void limiter.run(() => indexDocument(doc)).catch((err) => {
    if (!(err instanceof LimitxAbortError)) throw err;
    // silently ignore tasks cancelled by clear()
  });
}

// On SIGTERM: cancel pending, wait for active to finish
process.on('SIGTERM', async () => {
  const cancelled = limiter.clear();
  console.log(`Cancelled ${cancelled} pending tasks`);
  await limiter.drain();         // wait for the ~5 active tasks
  process.exit(0);
});
```

### Image processing pipeline with `runAll`

```typescript
import { Limitx } from '@async-kit/limitx';

const limiter = new Limitx({ concurrency: 4 });  // 4 CPU-bound workers

async function processImages(paths: string[]) {
  const results = await limiter.runAll(
    paths.map(p => () => sharp(p).resize(800).toBuffer()),
    { timeoutMs: 30_000 }
  );
  return results;
}
```

### Observability — live dashboard

```typescript
import { Limitx } from '@async-kit/limitx';

const limiter = new Limitx({ concurrency: 10 });

// Emit metrics every second
setInterval(() => {
  const { active, pending, total } = limiter.counts();
  metrics.gauge('limitx.active',  active);
  metrics.gauge('limitx.pending', pending);
  metrics.gauge('limitx.total',   total);
}, 1_000);
```

## Benchmark

> **Environment:** Node.js 24, Apple M2, 200 tasks × 10 ms simulated I/O, concurrency = 10.
> Each result is the average of 3 runs. Lower is better.

```
Benchmark: 200 tasks × 10ms work, concurrency=10
────────────────────────────────────────────────────────
  @async-kit/limitx  (Limitx.runAll)     204.3 ms
  @async-kit/limitx  (createLimit)       204.5 ms
  p-limit                                206.1 ms
  bottleneck                             218.7 ms
  async (eachLimit)                      209.4 ms
────────────────────────────────────────────────────────
```

`limitx` matches `p-limit` throughput while adding priority queues, pause/resume, per-task timeouts, and event-driven drain — all with zero dependencies.

### Feature comparison

| Feature | `@async-kit/limitx` | `p-limit` | `bottleneck` | `async` |
|---|:---:|:---:|:---:|:---:|
| Concurrency control | ✅ | ✅ | ✅ | ✅ |
| Priority queue | ✅ | ❌ | ✅ | ❌ |
| Pause / Resume | ✅ | ❌ | ✅ | ❌ |
| Per-task timeout | ✅ | ❌ | ✅ | ❌ |
| Event-driven drain | ✅ | ❌ | ❌ | ❌ |
| AbortSignal support | ✅ | ❌ | ❌ | ❌ |
| Browser / Edge ready | ✅ | ✅ | ❌ | ❌ |
| Zero dependencies | ✅ | ✅ | ❌ | ❌ |
| Bundle size (min+gz) | ~1 kB | ~0.5 kB | ~8 kB | ~4 kB |
| TypeScript-first | ✅ | ✅ | Partial | Partial |

### Run the benchmark yourself

```bash
# Install competitor libs
npm install --save-dev p-limit bottleneck async tsx

# Run
npx tsx packages/limitx/src/limitx.bench.ts
```

## Compatibility

| Environment | Support | Notes |
|---|---|---|
| **Node.js** | ≥ 18 | Recommended ≥ 24 for best performance |
| **Deno** | ✅ | Via npm specifier (`npm:@async-kit/limitx`) |
| **Bun** | ✅ | Full support |
| **Chrome** | ≥ 80 | ESM via bundler or native import |
| **Firefox** | ≥ 75 | ESM via bundler or native import |
| **Safari** | ≥ 13.1 | ESM via bundler or native import |
| **Edge** | ≥ 80 | ESM via bundler or native import |
| **React Native** | ✅ | Via Metro bundler |
| **Cloudflare Workers** | ✅ | ESM, zero Node built-ins used |
| **Vercel Edge Runtime** | ✅ | ESM, no `process` / `fs` dependencies |

**No Node.js built-ins are used.** The package relies only on standard JavaScript (`Promise`, `setTimeout`, `clearTimeout`) — all widely available in modern runtimes and browsers.

> **Note:** `LimitxTimeoutError` uses `Error` subclassing and `LimitxAbortError` uses only standard `Error`. No `DOMException` is required by this package.

## License

MIT © async-kit contributors · Part of the [async-kit](../../README.md) ecosystem
