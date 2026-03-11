<div align="center">

<img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=9&height=120&section=header&text=ratelimitx&fontSize=50&fontColor=fff&animation=fadeIn&desc=%40async-kit%2Fratelimitx&descAlignY=75&descAlign=50" width="100%"/>

<br/>

[![npm](https://img.shields.io/npm/v/@async-kit/ratelimitx?style=for-the-badge&logo=npm&color=96CEB4)](https://www.npmjs.com/package/@async-kit/ratelimitx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](../../LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@async-kit/ratelimitx?style=for-the-badge&color=96CEB4)](https://bundlephobia.com/package/@async-kit/ratelimitx)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Browser](https://img.shields.io/badge/Browser-Supported-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#compatibility)

**Multi-algorithm rate limiter — Token Bucket, Sliding Window, Fixed Window, and Composite enforcement with AbortSignal support.**

*Four algorithms, one interface. Zero dependencies.*

</div>

---

## Install

```bash
npm install @async-kit/ratelimitx
```

## Quick Start

```typescript
import { TokenBucket, SlidingWindow, FixedWindow, CompositeLimiter } from '@async-kit/ratelimitx';

// Token Bucket — burst-friendly
const bucket = new TokenBucket({ capacity: 10, refillRate: 2, refillInterval: 1000 });
await bucket.consume(); // waits until a token is available

// Sliding Window — strict per-window limit
const window = new SlidingWindow({ windowMs: 60_000, maxRequests: 100 });
await window.waitAndAcquire();

// Fixed Window — simplest, resets on schedule
const fw = new FixedWindow({ windowMs: 60_000, maxRequests: 100 });
fw.acquire(); // throws RateLimitError if over limit

// Composite — enforce multiple tiers simultaneously
const limiter = new CompositeLimiter([
  new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1000 }),
  new SlidingWindow({ windowMs: 60_000, maxRequests: 500 }),
]);
await limiter.waitAndAcquire();
```

## API

### `TokenBucket`

Tokens accumulate at `refillRate` per `refillInterval` up to `capacity`. Burst-friendly.

```typescript
const bucket = new TokenBucket({ capacity: 10, refillRate: 2, refillInterval: 1000 });
```

| Method | Description |
|---|---|
| `.tryConsume(count?)` | Non-blocking; `true` if tokens available |
| `.consume(count?, signal?)` | **Async — waits** until tokens available; only throws if `count > capacity` |
| `.acquireOrThrow(count?)` | Throws `RateLimitError` immediately if tokens unavailable |
| `.tryAcquire()` | Alias for `tryConsume()` |
| `.acquire()` | Alias for `acquireOrThrow()` |
| `.waitAndAcquire(signal?)` | Alias for `consume(1, signal)` |
| `.reset()` | Refill to capacity, reset clock |
| `.setCapacity(n)` | Hot-resize; clamps current tokens if lower |
| `.available` | Current token count (after refill) |

### `SlidingWindow`

Tracks exact timestamps in a **ring buffer** (`Float64Array`). O(k) prune, no burst.

```typescript
const win = new SlidingWindow({ windowMs: 60_000, maxRequests: 100 });
```

| Method | Description |
|---|---|
| `.tryAcquire()` | Non-blocking; `true` if a slot is available |
| `.acquire()` | Throws `RateLimitError` immediately if at limit |
| `.waitAndAcquire(signal?)` | Async — waits until the oldest request expires |
| `.currentCount` | Active request count in the current window |

### `FixedWindow`

Counts requests in a fixed time bucket that resets every `windowMs`.

```typescript
const fw = new FixedWindow({
  windowMs: 60_000,
  maxRequests: 100,
  onWindowReset: (t) => console.log('Reset at', t),
});
```

| Method | Description |
|---|---|
| `.tryAcquire()` | Non-blocking; `true` if under limit |
| `.acquire()` | Throws `RateLimitError` if at limit |
| `.waitAndAcquire(signal?)` | Async — waits until the window resets |
| `.reset()` | Manually reset count (useful in tests) |
| `.currentCount` | Requests in current window |
| `.windowResetMs` | Ms remaining until the window resets |

### `CompositeLimiter`

Enforces **all** provided limiters simultaneously. Useful for multi-tier API limits.

```typescript
const limiter = new CompositeLimiter([
  new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1000 }),
  new SlidingWindow({ windowMs: 60_000, maxRequests: 500 }),
  new FixedWindow({ windowMs: 3_600_000, maxRequests: 5000 }),
]);
```

| Method | Description |
|---|---|
| `.tryAcquire()` | `true` only if **all** limiters pass |
| `.acquire()` | Throws on the first limiter that rejects |
| `.waitAndAcquire(signal?)` | Async — waits until all limiters have capacity |

### `RateLimitError`

```typescript
try {
  limiter.acquire();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(err.algorithm);     // 'token-bucket' | 'sliding-window' | 'fixed-window'
    console.log(err.retryAfterMs);  // ms to wait before retrying
    console.log(err.limit);         // configured limit
    console.log(err.current);       // current usage
  }
}
```

## `Limiter` Interface

All three classes implement `Limiter`, making them interchangeable:

```typescript
interface Limiter {
  tryAcquire(): boolean;
  acquire(): void;
  waitAndAcquire(signal?: AbortSignal): Promise<void>;
}
```

## Algorithm Comparison

| Algorithm | Burst | Memory | Boundary spike | Best For |
|---|---|---|---|---|
| Token Bucket | ✅ Yes | O(1) | No | API quotas, outbound throttling |
| Sliding Window | ❌ No | O(maxRequests) | No | Strict per-window enforcement |
| Fixed Window | ✅ At boundary | O(1) | Yes | Simple quotas, easy reasoning |
| CompositeLimiter | Depends | Combined | Depends | Multi-tier API limits |

## Examples

### Express middleware — per-IP sliding window

```typescript
import express from 'express';
import { SlidingWindow, RateLimitError } from '@async-kit/ratelimitx';

const app = express();
const limiters = new Map<string, SlidingWindow>();

app.use((req, res, next) => {
  const ip = req.ip ?? 'unknown';
  if (!limiters.has(ip)) {
    limiters.set(ip, new SlidingWindow({ windowMs: 60_000, maxRequests: 100 }));
  }
  try {
    limiters.get(ip)!.acquire();
    next();
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
      res.set('X-RateLimit-Limit', String(err.limit));
      res.set('X-RateLimit-Remaining', '0');
      res.status(429).json({ error: 'Too Many Requests', retryAfterMs: err.retryAfterMs });
    }
  }
});
```

### Outbound API quota — token bucket for GitHub API

```typescript
import { TokenBucket } from '@async-kit/ratelimitx';
import { Octokit } from 'octokit';

// GitHub: 5 000 authenticated requests / hour ≈ 1.38 / sec
const github = new TokenBucket({
  capacity: 30,         // burst: up to 30 back-to-back
  refillRate: 1,
  refillInterval: 720,  // 720 ms ≈ 1.38 tokens/sec
});

const octokit = new Octokit({ auth: process.env.GH_TOKEN });

async function githubRequest<T>(fn: () => Promise<T>): Promise<T> {
  // Block until a token is available (never drops requests)
  await github.waitAndAcquire();
  return fn();
}

// Safe to call in a tight loop — will naturally pace itself
const repos = await githubRequest(() =>
  octokit.rest.repos.listForOrg({ org: 'my-org', per_page: 100 })
);
```

### Multi-tier composite limit (per-second + per-minute + per-hour)

```typescript
import { TokenBucket, SlidingWindow, FixedWindow, CompositeLimiter } from '@async-kit/ratelimitx';

// Model a typical SaaS API tier:
//   • burst 10 back-to-back
//   • 60 / min steady-state
//   • 1 000 / hr hard quota
const apiLimiter = new CompositeLimiter([
  new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1_000 }),
  new SlidingWindow({ windowMs: 60_000,    maxRequests: 60  }),
  new FixedWindow  ({ windowMs: 3_600_000, maxRequests: 1_000,
    onWindowReset: (t) => console.log('Hourly quota reset at', new Date(t).toISOString()),
  }),
]);

async function callSaasApi(endpoint: string) {
  await apiLimiter.waitAndAcquire();
  return fetch(endpoint).then(r => r.json());
}
```

### Combine with retryx for automatic backoff

```typescript
import { SlidingWindow, RateLimitError } from '@async-kit/ratelimitx';
import { retry } from '@async-kit/retryx';

const limiter = new SlidingWindow({ windowMs: 1_000, maxRequests: 10 });

const result = await retry(
  () => { limiter.acquire(); return callApi(); },
  {
    maxAttempts: 60,
    retryIf: (err) => err instanceof RateLimitError,
    onRetry: (_n, err) => {
      const wait = (err as RateLimitError).retryAfterMs;
      console.log(`Rate limited — retrying in ${wait}ms`);
    },
  }
);
```

### Async queue consumer with `waitAndAcquire`

```typescript
import { TokenBucket } from '@async-kit/ratelimitx';

const bucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 1_000 });

// Consumer loop — processes at most 5 items/sec no matter how fast items arrive
async function processQueue(queue: AsyncIterable<Job>) {
  for await (const job of queue) {
    await bucket.waitAndAcquire();      // blocks here when the bucket is empty
    void processJob(job);               // fire without awaiting
  }
}
```

### Fixed window with reset callback for quota UI

```typescript
import { FixedWindow } from '@async-kit/ratelimitx';

let remaining = 100;

const fw = new FixedWindow({
  windowMs: 60_000,
  maxRequests: 100,
  onWindowReset: () => { remaining = 100; },
});

function tryRequest(): { allowed: boolean; remaining: number; resetIn: number } {
  const allowed = fw.tryAcquire();
  if (allowed) remaining--;
  return { allowed, remaining, resetIn: fw.windowResetMs };
}
```

### Dynamic capacity — hot-resize for plan upgrades

```typescript
import { TokenBucket } from '@async-kit/ratelimitx';

const bucket = new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1_000 });

// User upgrades from Free (10/s) to Pro (100/s) — no restart needed
async function onPlanUpgrade(userId: string, newPlan: 'free' | 'pro') {
  const newCapacity = newPlan === 'pro' ? 100 : 10;
  bucket.setCapacity(newCapacity);
  console.log(`User ${userId} upgraded to ${newPlan} — new capacity: ${newCapacity}`);
}
```

### Custom `Limiter` implementation

```typescript
import type { Limiter } from '@async-kit/ratelimitx';
import { CompositeLimiter } from '@async-kit/ratelimitx';

// Roll your own limiter and plug it into CompositeLimiter
class DailyQuotaLimiter implements Limiter {
  private used = 0;
  constructor(private readonly limit: number) {}

  tryAcquire(): boolean {
    if (this.used < this.limit) { this.used++; return true; }
    return false;
  }

  acquire(): void {
    if (!this.tryAcquire()) throw new Error(`Daily quota of ${this.limit} exhausted`);
  }

  async waitAndAcquire(): Promise<void> {
    // Block until midnight UTC
    const ms = msUntilMidnightUTC();
    await new Promise(r => setTimeout(r, ms));
    this.used = 0;
    this.used++;
  }
}

const composite = new CompositeLimiter([
  new SlidingWindow({ windowMs: 1_000, maxRequests: 10 }),
  new DailyQuotaLimiter(10_000),
]);
```

## Types

```typescript
import type {
  TokenBucketOptions,
  SlidingWindowOptions,
  FixedWindowOptions,
  Limiter,
  RateLimitAlgorithm,
} from '@async-kit/ratelimitx';
```

## Compatibility

| Environment | Support | Notes |
|---|---|---|
| **Node.js** | ≥ 18 | Recommended ≥ 24 for best performance |
| **Deno** | ✅ | Via npm specifier (`npm:@async-kit/ratelimitx`) |
| **Bun** | ✅ | Full support |
| **Chrome** | ≥ 80 | ESM via bundler or native import |
| **Firefox** | ≥ 75 | ESM via bundler or native import |
| **Safari** | ≥ 13.1 | ESM via bundler or native import |
| **Edge** | ≥ 80 | ESM via bundler or native import |
| **React Native** | ✅ | Via Metro bundler |
| **Cloudflare Workers** | ✅ | ESM, `AbortSignal` natively supported |
| **Vercel Edge Runtime** | ✅ | ESM, no `process` / `fs` dependencies |

**No Node.js built-ins are used.** The package relies only on standard JavaScript (`Promise`, `setTimeout`, `clearTimeout`, `Float64Array`, `AbortSignal`, `DOMException`) — universally available in modern runtimes and browsers.

> **`Float64Array`** (used by `SlidingWindow`'s ring buffer) is part of the ECMAScript spec and available in every JavaScript environment including old browsers and edge workers.

## License

MIT © async-kit contributors · Part of the [async-kit](../../README.md) ecosystem
