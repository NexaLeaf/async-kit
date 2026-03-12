<div align="center">

<img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=12&height=120&section=header&text=retryx&fontSize=60&fontColor=fff&animation=fadeIn&desc=%40async-kit%2Fretryx&descAlignY=75&descAlign=50" width="100%"/>

<br/>

[![npm](https://img.shields.io/npm/v/@async-kit/retryx?style=for-the-badge&logo=npm&color=4ECDC4)](https://www.npmjs.com/package/@async-kit/retryx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](../../LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@async-kit/retryx?style=for-the-badge&color=4ECDC4)](https://bundlephobia.com/package/@async-kit/retryx)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Browser](https://img.shields.io/badge/Browser-Supported-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#compatibility)

**Smart async retry with exponential backoff, jitter strategies, circuit breaker, and AbortSignal support.**

*Make any async operation resilient in one line.*

</div>

---

## Install

```bash
npm install @async-kit/retryx
```

## Quick Start

```typescript
import { retry, createRetry, withRetry, CircuitBreaker } from '@async-kit/retryx';

// One-shot retry
const data = await retry(() => fetch('/api').then(r => r.json()), {
  maxAttempts: 5,
  jitter: 'full',
});

// Reusable retry function
const resilient = createRetry({ maxAttempts: 3, initialDelay: 200 });
await resilient(() => callApi());

// Wrap any async function
const safeFetch = withRetry(fetch, { maxAttempts: 3 });
const resp = await safeFetch('/api/users', { method: 'GET' });

// Circuit breaker
const cb = new CircuitBreaker({ failureThreshold: 5, successThreshold: 2, openDurationMs: 10_000 });
const result = await cb.run(() => callExternalService());
```

## API

### `retry(task, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | `number` | `3` | Total attempts including the first |
| `initialDelay` | `number` | `200` | Base delay in ms before the first retry |
| `maxDelay` | `number` | `30_000` | Maximum delay cap in ms |
| `factor` | `number` | `2` | Exponential backoff multiplier |
| `jitter` | `JitterStrategy` | `'equal'` | Randomization strategy (see below) |
| `retryIf` | `(err, ctx) => bool` | `() => true` | Return `false` to stop retrying; may be async |
| `onRetry` | `(n, err, ms, ctx) => void` | — | Hook called before each retry delay |
| `signal` | `AbortSignal` | — | Cancels pending retry delays |
| `timeoutMs` | `number` | — | Per-attempt timeout; throws `RetryxTimeoutError` |

### Jitter Strategies

| Strategy | Formula | Best For |
|---|---|---|
| `'equal'` (default) | `cap/2 + random(0, cap/2)` | Preserves mean delay |
| `'full'` | `random(0, cap)` | AWS-recommended; highest spread |
| `'decorrelated'` | `min(maxDelay, random(base, max(base, prev×3)))` | Aggressive thundering-herd prevention |
| `'none'` | `cap` | Deterministic testing |

> **`'decorrelated'` note:** The formula guards against a negative random range when `prevDelay` is very small by using `max(initialDelay, prevDelay × 3)` as the upper bound — delays are always ≥ `initialDelay`.

### `createRetry(defaults)`

Creates a reusable retry function. Per-call `overrides` are merged with defaults.

```typescript
const resilient = createRetry({ maxAttempts: 5, jitter: 'full' });
await resilient(() => fetchData(), { maxAttempts: 3 }); // override for this call
```

### `withRetry(fn, options)`

Wraps an existing async function so every invocation is automatically retried.

```typescript
const safeFetch = withRetry(fetch, { maxAttempts: 3 });
const resp = await safeFetch('/api/users', { method: 'GET' }); // retried transparently
```

### `RetryContext`

Passed to `retryIf` and `onRetry`:

```typescript
interface RetryContext {
  attemptNumber: number;  // 1-based attempt that just failed
  totalAttempts: number;
  elapsedMs: number;      // wall-clock ms since first attempt
  errors: unknown[];      // all errors so far, in order
}
```

## Circuit Breaker

Prevents cascading failures by fast-failing calls when a service is degraded.

```typescript
const cb = new CircuitBreaker({
  failureThreshold: 5,    // open after 5 consecutive failures
  successThreshold: 2,    // close after 2 successes in HALF_OPEN
  openDurationMs: 10_000, // stay open 10 s before probing
  volumeThreshold: 10,    // require ≥ 10 calls before tripping
  onStateChange: (from, to) => console.log(`${from} → ${to}`),
});
```

#### States

```
CLOSED ──(failures >= threshold)──► OPEN ──(after openDurationMs)──► HALF_OPEN
   ▲                                                                      │
   └──────────(successes >= successThreshold)────────────────────────────┘
```

| Method | Description |
|---|---|
| `.run(task)` | Execute; throws `CircuitOpenError` when OPEN |
| `.reset()` | Force to CLOSED state |
| `.stats()` | Returns `{ failures, successes, calls, state }` |
| `.currentState` | Current `CircuitState` |

## Error Types

| Class | When |
|---|---|
| `RetryxError` | All attempts exhausted — has `.attempts`, `.lastError`, `.allErrors` |
| `RetryxTimeoutError` | Per-attempt `timeoutMs` exceeded — has `.attempt`, `.timeoutMs` |
| `CircuitOpenError` | Call blocked by open circuit — has `.retryAfterMs` |

## Examples

### Retry only transient HTTP errors

```typescript
import { retry } from '@async-kit/retryx';

const data = await retry(
  () => fetch('/api/orders').then(async r => {
    if (!r.ok) throw Object.assign(new Error(r.statusText), { status: r.status });
    return r.json();
  }),
  {
    maxAttempts: 5,
    jitter: 'full',
    retryIf: (err: any) => err.status == null || err.status >= 500,
    onRetry: (attempt, err: any, delayMs) => {
      console.warn(`[attempt ${attempt}] ${err.message} — retrying in ${delayMs}ms`);
    },
  }
);
```

### App-wide resilience factory

```typescript
import { createRetry } from '@async-kit/retryx';

// Define once, use everywhere
export const resilient = createRetry({
  maxAttempts: 4,
  initialDelay: 300,
  maxDelay: 15_000,
  jitter: 'equal',
});

// In your service layer
export const ordersApi = {
  create: (payload: OrderPayload) =>
    resilient(() => httpClient.post('/orders', payload)),
  get: (id: string) =>
    resilient(() => httpClient.get(`/orders/${id}`)),
};
```

### `withRetry` — wrap third-party SDKs

```typescript
import { withRetry } from '@async-kit/retryx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

// Wrap the entire send method — every call is retried automatically
const resilientSend = withRetry(
  s3.send.bind(s3),
  { maxAttempts: 4, jitter: 'decorrelated' }
);

const response = await resilientSend(
  new GetObjectCommand({ Bucket: 'my-bucket', Key: 'data.json' })
);
```

### Per-attempt timeout to bound total latency

```typescript
import { retry, RetryxTimeoutError } from '@async-kit/retryx';

const result = await retry(
  () => slowExternalService.query(params),
  {
    maxAttempts: 3,
    timeoutMs: 2_000,    // each attempt must finish within 2 s
    initialDelay: 500,
  }
).catch((err) => {
  if (err instanceof RetryxTimeoutError)
    console.error(`Attempt ${err.attempt} timed out after ${err.timeoutMs}ms`);
  throw err;
});
```

### Cancellable polling with AbortSignal

```typescript
import { retry } from '@async-kit/retryx';

const controller = new AbortController();

// Cancel from the UI
document.getElementById('cancel')!.onclick = () => controller.abort();

const result = await retry(
  () => pollJobStatus(jobId).then(s => {
    if (s.status !== 'done') throw new Error('not ready');
    return s;
  }),
  {
    maxAttempts: 120,
    initialDelay: 1_000,
    maxDelay: 10_000,
    signal: controller.signal,
  }
);
```

### Circuit Breaker — protect a downstream service

```typescript
import { CircuitBreaker, CircuitOpenError } from '@async-kit/retryx';

const inventoryCb = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  openDurationMs: 30_000,
  onStateChange: (from, to) => {
    logger.warn(`inventory circuit: ${from} → ${to}`);
    metrics.increment(`circuit.inventory.${to.toLowerCase()}`);
  },
});

async function getInventory(sku: string) {
  try {
    return await inventoryCb.run(() => inventoryService.get(sku));
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      // Serve from cache while circuit is open
      return cache.get(`inventory:${sku}`) ?? { qty: 0 };
    }
    throw err;
  }
}
```

### Circuit Breaker + retry together

```typescript
import { retry, CircuitBreaker, CircuitOpenError } from '@async-kit/retryx';

const cb = new CircuitBreaker({ failureThreshold: 3, successThreshold: 1, openDurationMs: 10_000 });

const data = await retry(
  () => cb.run(() => externalService.fetch(id)),
  {
    maxAttempts: 5,
    retryIf: (err) => !(err instanceof CircuitOpenError), // don't retry open-circuit errors
    onRetry: (n, err) => console.log(`retry ${n}: ${err}`),
  }
);
```

### Inspect all errors across attempts

```typescript
import { retry, RetryxError } from '@async-kit/retryx';

try {
  await retry(() => unstableService.call(), { maxAttempts: 3 });
} catch (err) {
  if (err instanceof RetryxError) {
    console.error(`Failed after ${err.attempts} attempts`);
    err.allErrors.forEach((e, i) =>
      console.error(`  Attempt ${i + 1}:`, e)
    );
  }
}
```

## Types

```typescript
import type {
  JitterStrategy,
  RetryContext,
  RetryxOptions,
  CircuitState,
  CircuitBreakerOptions,
  CircuitBreakerStats,
} from '@async-kit/retryx';
```

## Compatibility

| Environment | Support | Notes |
|---|---|---|
| **Node.js** | ≥ 18 | Recommended ≥ 24 for best performance |
| **Deno** | ✅ | Via npm specifier (`npm:@async-kit/retryx`) |
| **Bun** | ✅ | Full support |
| **Chrome** | ≥ 80 | ESM via bundler or native import |
| **Firefox** | ≥ 75 | ESM via bundler or native import |
| **Safari** | ≥ 13.1 | ESM via bundler or native import |
| **Edge** | ≥ 80 | ESM via bundler or native import |
| **React Native** | ✅ | Via Metro bundler |
| **Cloudflare Workers** | ✅ | ESM, `AbortSignal` natively supported |
| **Vercel Edge Runtime** | ✅ | ESM, no `process` / `fs` dependencies |

**No Node.js built-ins are used.** The package relies only on standard JavaScript (`Promise`, `setTimeout`, `clearTimeout`, `AbortSignal`, `DOMException`) — all available in any modern runtime.

> **`AbortSignal` / `DOMException`** are part of the Web Platform API. In Node.js they are globals since v15. In older environments (Node 14 or old browsers) you may need to polyfill `AbortController` — e.g. [`abortcontroller-polyfill`](https://www.npmjs.com/package/abortcontroller-polyfill).

## License

MIT © async-kit contributors · Part of the [async-kit](../../README.md) ecosystem
