<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=200&section=header&text=async-kit&fontSize=80&fontColor=fff&animation=twinkling&fontAlignY=35&desc=The%20Professional%20Async%20Toolkit%20for%20TypeScript&descAlignY=62&descAlign=50" width="100%"/>

<br/>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NX](https://img.shields.io/badge/NX-22-143055?style=for-the-badge&logo=nx&logoColor=white)](https://nx.dev/)
[![Node](https://img.shields.io/badge/Node-≥18-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Browser](https://img.shields.io/badge/Browser-Supported-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#-compatibility)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](CONTRIBUTING.md)

<br/>

[![limitx](https://img.shields.io/npm/v/@async-kit/limitx?style=flat-square&label=%40async-kit%2Flimitx&color=FF6B6B&logo=npm)](https://www.npmjs.com/package/@async-kit/limitx)
[![retryx](https://img.shields.io/npm/v/@async-kit/retryx?style=flat-square&label=%40async-kit%2Fretryx&color=4ECDC4&logo=npm)](https://www.npmjs.com/package/@async-kit/retryx)
[![flowx](https://img.shields.io/npm/v/@async-kit/flowx?style=flat-square&label=%40async-kit%2Fflowx&color=45B7D1&logo=npm)](https://www.npmjs.com/package/@async-kit/flowx)
[![ratelimitx](https://img.shields.io/npm/v/@async-kit/ratelimitx?style=flat-square&label=%40async-kit%2Fratelimitx&color=96CEB4&logo=npm)](https://www.npmjs.com/package/@async-kit/ratelimitx)

<br/>

> **Production-grade async primitives** for Node.js and the browser.
> Zero dependencies. Tree-shakeable. Dual ESM/CJS. Fully typed.

<br/>

```
async-kit
 ├── 🔴  @async-kit/limitx       Priority queue, pause/resume, per-task timeouts, drain
 ├── 🟢  @async-kit/retryx       Retry + jitter strategies + CircuitBreaker + withRetry
 ├── 🔵  @async-kit/flowx        Type-safe pipeline, fallbacks, parallel, sequence
 └── 🟡  @async-kit/ratelimitx   Token Bucket + Sliding Window + Fixed Window + Composite
```

</div>

---

## 📦 Packages

<table>
<tr>
<td width="25%" align="center">
<br/>
<img src="https://img.shields.io/badge/-limitx-FF6B6B?style=for-the-badge&labelColor=2d2d2d" /><br/>
<b>Concurrency Control</b><br/>
<sub>Priority queue, pause/resume, per-task timeouts, event-driven drain.</sub>
</td>
<td width="25%" align="center">
<br/>
<img src="https://img.shields.io/badge/-retryx-4ECDC4?style=for-the-badge&labelColor=2d2d2d" /><br/>
<b>Smart Retry</b><br/>
<sub>Exponential backoff, four jitter strategies, CircuitBreaker, withRetry, and AbortSignal.</sub>
</td>
<td width="25%" align="center">
<br/>
<img src="https://img.shields.io/badge/-flowx-45B7D1?style=for-the-badge&labelColor=2d2d2d" /><br/>
<b>Async Pipelines</b><br/>
<sub>Type-safe chainable pipelines, step fallbacks, parallel fan-out, and sequential reduction.</sub>
</td>
<td width="25%" align="center">
<br/>
<img src="https://img.shields.io/badge/-ratelimitx-96CEB4?style=for-the-badge&labelColor=2d2d2d" /><br/>
<b>Rate Limiting</b><br/>
<sub>Token Bucket, Sliding Window, Fixed Window, and CompositeLimiter with retryAfterMs signals.</sub>
</td>
</tr>
</table>

---

## 🚀 Quick Install

Install only what you need — each package is independent:

```bash
# Concurrency control
npm install @async-kit/limitx

# Smart retry
npm install @async-kit/retryx

# Async pipelines
npm install @async-kit/flowx

# Rate limiting
npm install @async-kit/ratelimitx
```

---

## 🔴 `@async-kit/limitx` — Concurrency Limiter

> Run at most **N** async tasks at the same time. Queue by **priority**. Drain when done.

### Install

```bash
npm install @async-kit/limitx
```

### API

```typescript
import { Limitx, createLimit } from '@async-kit/limitx';

// Class API — full control
const limiter = new Limitx({ concurrency: 3 });

limiter.activeCount            // currently running tasks
limiter.pendingCount           // tasks waiting in priority queue
limiter.isPaused               // boolean
limiter.counts()               // atomic { active, pending, total }

limiter.run(task, { priority: 10, timeoutMs: 5000 })  // enqueue → Promise<T>
limiter.runAll(tasks)          // submit many → Promise<T[]>
limiter.pause()                // stop dequeuing (running tasks continue)
limiter.resume()               // fill slots immediately
limiter.clear()                // cancel all queued → returns count
limiter.drain()                // event-driven wait until empty
```

### Usage Examples

**Limit concurrent API calls:**

```typescript
import { createLimit } from '@async-kit/limitx';

const limit = createLimit(5); // max 5 in-flight requests

const users = await Promise.all(
  userIds.map(id => limit(() => fetch(`/api/users/${id}`).then(r => r.json())))
);
```

**Priority queue — critical tasks first:**

```typescript
const limiter = new Limitx({ concurrency: 2 });
limiter.run(backgroundJob,  { priority: 0  }); // queued last
limiter.run(criticalUpdate, { priority: 10 }); // runs first
limiter.run(userRequest,    { priority: 5  }); // runs second
```

**Process a large dataset with drain:**

```typescript
const limiter = new Limitx({ concurrency: 10, onError: console.error });
for (const record of records) {
  void limiter.run(() => processRecord(record));
}
await limiter.drain();
console.log('All done');
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | required | Max simultaneous tasks |
| `defaultPriority` | `number` | `0` | Default priority (higher = sooner) |
| `onError` | `(err) => void` | `undefined` | Called when a task throws |

---

## 🟢 `@async-kit/retryx` — Smart Retry

> Retry any async operation with **exponential backoff**, **four jitter strategies**, **CircuitBreaker**, and abort support.

### Install

```bash
npm install @async-kit/retryx
```

### API

```typescript
import { retry, createRetry, withRetry, CircuitBreaker } from '@async-kit/retryx';

// Functional API
await retry(task, options);

// Factory — reuse config across your app
const resilient = createRetry({ maxAttempts: 5, jitter: 'full' });
await resilient(() => fetchData());

// Wrap an entire function
const safeFetch = withRetry(fetch, { maxAttempts: 3 });
await safeFetch('/api/users');

// Circuit Breaker
const cb = new CircuitBreaker({ failureThreshold: 5, successThreshold: 2, openDurationMs: 10_000 });
await cb.run(() => callExternalService());
```

### Jitter Strategies

| Strategy | Formula | Best For |
|---|---|---|
| `'equal'` (default) | `cap/2 + random(0, cap/2)` | General use, preserves mean |
| `'full'` | `random(0, cap)` | AWS-recommended; highest spread |
| `'decorrelated'` | `min(cap, random(base, prev*3))` | Aggressive thundering-herd prevention |
| `'none'` | `cap` | Deterministic testing |

### Usage Examples

**Retry with context-aware hook:**

```typescript
await retry(() => callPaymentAPI(payload), {
  maxAttempts: 4,
  jitter: 'full',
  retryIf: (err, ctx) => {
    if (err instanceof HttpError) return err.status >= 500;
    return ctx.elapsedMs < 30_000; // give up after 30s total
  },
  onRetry: (attempt, err, delayMs, ctx) => {
    logger.warn('Retry', { attempt, error: err, nextIn: delayMs, elapsed: ctx.elapsedMs });
  },
});
```

**withRetry — wrap any function:**

```typescript
const resilientFetch = withRetry(fetch, { maxAttempts: 3, jitter: 'equal' });
const resp = await resilientFetch('/api/users', { method: 'GET' }); // retried transparently
```

**Circuit Breaker:**

```typescript
const cb = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  openDurationMs: 10_000,
  onStateChange: (from, to) => metrics.track(`circuit.${from}.${to}`),
});
const data = await cb.run(() => externalService.get('/data'));
// Throws CircuitOpenError (with .retryAfterMs) when OPEN
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | `number` | `3` | Total attempts before throwing |
| `initialDelay` | `number` | `200` | Base delay in ms |
| `maxDelay` | `number` | `30000` | Cap on backoff delay |
| `factor` | `number` | `2` | Backoff multiplier |
| `jitter` | `JitterStrategy` | `'equal'` | Randomization strategy |
| `retryIf` | `(err, ctx) => boolean` | `() => true` | Skip retrying — may be async |
| `onRetry` | `(n, err, ms, ctx) => void` | `undefined` | Hook for logging/metrics |
| `signal` | `AbortSignal` | `undefined` | Cancel pending retries |
| `timeoutMs` | `number` | `undefined` | Per-attempt timeout |

---

## 🔵 `@async-kit/flowx` — Async Pipelines

> Build **type-safe**, **composable** async data pipelines with step fallbacks, timeouts, and cancellation.

### Install

```bash
npm install @async-kit/flowx
```

### API

```typescript
import { pipeline, parallel, parallelSettled, sequence } from '@async-kit/flowx';

// Chainable pipeline — immutable, reusable
await pipeline<InputType>()
  .pipe(step1)
  .pipe({ name: 'validate', fn: step2, timeoutMs: 2000 })
  .pipeWithFallback(riskyStep, (err, input) => defaultValue)
  .tap(val => console.log('current:', val))
  .run(input, { signal, onStepComplete, stepTimeoutMs: 5000 });

// Fan-out — run tasks concurrently, preserve order
await parallel([taskA, taskB, taskC], { concurrency: 2 });

// Fan-out — never rejects
await parallelSettled([taskA, taskB, taskC]);

// Sequential reduce with async support
await sequence(items, initialValue, asyncReducer);
```

### Usage Examples

**Data transformation pipeline:**

```typescript
const userPipeline = pipeline<RawUser>()
  .pipe(raw => ({ ...raw, age: parseInt(raw.age, 10) }))
  .pipe(async user => { await validateEmail(user.email); return user; })
  .pipe(async user => ({ ...user, id: await generateId() }));

const user = await userPipeline.run(rawInput);
```

**Fallback for recoverable steps:**

```typescript
const result = await pipeline<string>()
  .pipeWithFallback(
    { name: 'fetchFromPrimary', fn: s => primaryApi.get(s) },
    (err, input) => fallbackApi.get(input)   // used on error
  )
  .run(userId);
```

**ETL with per-step timeouts:**

```typescript
const etl = pipeline<RawRecord>()
  .pipe({ name: 'normalize', fn: normalize, timeoutMs: 100 })
  .pipe({ name: 'enrich',    fn: enrich,    timeoutMs: 2000 })
  .pipe({ name: 'load',      fn: load,      timeoutMs: 5000 });

await etl.run(record, { signal: controller.signal });
```

### Options

| Option | Type | Description |
|---|---|---|
| `signal` | `AbortSignal` | Abort mid-pipeline between steps |
| `onStepComplete` | `(index, name, result) => void` | Observability hook per step |
| `stepTimeoutMs` | `number` | Default per-step timeout (overridable per step) |

---

## 🟡 `@async-kit/ratelimitx` — Rate Limiting

> Four algorithms: **Token Bucket**, **Sliding Window**, **Fixed Window**, and **CompositeLimiter** for multi-tier enforcement.

### Install

```bash
npm install @async-kit/ratelimitx
```

### API

```typescript
import { TokenBucket, SlidingWindow, FixedWindow, CompositeLimiter, RateLimitError } from '@async-kit/ratelimitx';

// Token Bucket — burst-friendly
const bucket = new TokenBucket({ capacity, refillRate, refillInterval });
bucket.available                    // tokens right now
bucket.tryConsume()                 // non-throwing: boolean
bucket.acquireOrThrow()             // throws immediately
await bucket.consume()              // async: waits for tokens
await bucket.waitAndAcquire(signal) // Limiter interface

// Sliding Window — strict enforcement, ring buffer
const win = new SlidingWindow({ windowMs, maxRequests });
win.currentCount                    // requests in window
win.tryAcquire()                    // non-throwing: boolean
win.acquire()                       // throws RateLimitError
await win.waitAndAcquire(signal)    // Limiter interface

// Fixed Window — simplest, resets on schedule
const fw = new FixedWindow({ windowMs, maxRequests, onWindowReset? });
fw.windowResetMs                    // ms until next reset
fw.acquire()                        // throws RateLimitError

// CompositeLimiter — enforce ALL tiers
const multi = new CompositeLimiter([bucket, win, fw]);
await multi.waitAndAcquire(signal); // waits for all
```

### Usage Examples

**Multi-tier API limits:**

```typescript
const limiter = new CompositeLimiter([
  new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1000 }),  // 10/sec burst
  new SlidingWindow({ windowMs: 60_000, maxRequests: 500 }),                 // 500/min
  new FixedWindow({ windowMs: 3_600_000, maxRequests: 5000 }),               // 5000/hr
]);

await limiter.waitAndAcquire();
const data = await callExternalApi();
```

**Express middleware — per-IP rate limiting:**

```typescript
const limiters = new Map<string, SlidingWindow>();

app.use((req, res, next) => {
  if (!limiters.has(req.ip)) {
    limiters.set(req.ip, new SlidingWindow({ windowMs: 60_000, maxRequests: 60 }));
  }
  try {
    limiters.get(req.ip)!.acquire();
    next();
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
      res.status(429).json({ error: 'Too Many Requests' });
    }
  }
});
```

**Combine with retryx for auto-backoff:**

```typescript
const limiter = new SlidingWindow({ windowMs: 1000, maxRequests: 10 });

const result = await retry(
  () => { limiter.acquire(); return callApi(); },
  {
    maxAttempts: 30,
    retryIf: (err) => err instanceof RateLimitError,
    onRetry: (attempt, err) => {
      console.log(`Rate limited. Waiting ${(err as RateLimitError).retryAfterMs}ms`);
    },
  }
);
```

### Algorithms Compared

| | Token Bucket | Sliding Window | Fixed Window |
|---|---|---|---|
| **Burst handling** | ✅ Yes | ❌ No | ✅ At boundary |
| **Memory** | O(1) | O(maxRequests) | O(1) |
| **Precision** | Approximate | Exact | Exact per window |
| **Best for** | External API quotas | Strict enforcement | Simple quotas |

---

## 🏗️ Architecture

This is an **NX 22 monorepo** with independently versioned and published packages.

```
async-kit/
├── packages/
│   ├── limitx/          ← @async-kit/limitx
│   │   ├── src/
│   │   │   ├── types.ts         ← all public types/interfaces
│   │   │   ├── limitx.ts
│   │   │   ├── limitx.spec.ts
│   │   │   └── index.ts
│   │   ├── project.json
│   │   ├── tsup.config.ts
│   │   └── package.json
│   ├── retryx/          ← @async-kit/retryx
│   ├── flowx/           ← @async-kit/flowx
│   └── ratelimitx/      ← @async-kit/ratelimitx
├── .github/
│   └── workflows/
│       ├── ci.yml       ← nx affected lint/test/build on PRs
│       └── release.yml  ← manual npm publish with OIDC provenance
├── nx.json              ← NX config + nx release (independent versioning)
├── tsconfig.base.json   ← Shared paths + strict TS config
└── package.json         ← npm workspaces root
```

**Build output per package:**

```
dist/
├── index.js       CJS  (require)
├── index.mjs      ESM  (import)
├── index.d.ts     Types for ESM consumers
├── index.d.mts    Types for CJS consumers
├── index.js.map   Source maps
└── index.mjs.map
```

---

## 🛠️ Development

### Prerequisites

- Node.js ≥ 24
- npm ≥ 11

### Setup

```bash
git clone https://github.com/your-org/async-kit.git
cd async-kit
npm install
```

### Common Commands

```bash
# Build all packages
npm run build

# Run all tests
npm run test

# Build only affected packages (based on git diff)
npm run affected:build

# Test only affected packages
npm run affected:test

# Lint all packages
npm run lint

# Type-check all packages
npm run typecheck

# Visualize the NX dependency graph
npm run graph

# Preview a release (no changes made)
npm run release:dry

# First-ever publish to npm
npm run release:first
```

### Running a single package

```bash
npx nx run @async-kit/limitx:build
npx nx run @async-kit/retryx:test
npx nx run @async-kit/flowx:lint
```

---

## 🚢 Release & Publishing

This monorepo uses [`nx release`](https://nx.dev/features/manage-releases) with **independent versioning** — each package can be on a different version.

### Workflow overview

```
Push to main  ──────────────────────────────────────────────────────────────►
                    ┌─────────────────────────────────────────────────────┐
                    │  CI (ci.yml)                                        │
                    │  npm audit → lint → typecheck → test → build        │
                    └─────────────────────────────────────────────────────┘
                                            │
                         commit msg contains [release]?
                                    │ yes
                                    ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  Release (release.yml)  — environment: npm-publish  │
                    │  1. npm audit + full test + build                   │
                    │  2. nx release --skip-publish  (bump + tag + log)   │
                    │  3. nx release publish  (npm + OIDC provenance)     │
                    │  4. git push --follow-tags → main                   │
                    └─────────────────────────────────────────────────────┘

Manual trigger:  Actions → Release → Run workflow
                 Inputs: dry_run | package | first_release
```

### How to cut a release

**Option A — Automated (recommended)**

1. Write commits following [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(retryx): add decorrelated jitter strategy
   fix(limitx): drain() resolves when queue empties mid-flight
   feat!: drop Node 16 support (BREAKING CHANGE)
   ```

2. When ready to publish, include `[release]` in any commit message pushed to `main`:
   ```bash
   git commit --allow-empty -m "chore: cut release [release]"
   git push
   ```
   The workflow detects the marker, runs validation, then publishes.

**Option B — Manual dispatch**

Go to **Actions → Release → Run workflow** and fill in:

| Input | Description |
|---|---|
| `dry_run` | Preview version bumps + changelog without publishing |
| `package` | Scope to one package, e.g. `@async-kit/limitx` |
| `first_release` | Use for the very first publish (`--first-release`) |

### Version bump rules

| Commit type | Version bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `docs:`, `chore:`, `ci:`, `build:` | none (no release) |

### Git tags produced

```
@async-kit/limitx@1.2.3
@async-kit/retryx@0.5.0
@async-kit/flowx@2.0.0
@async-kit/ratelimitx@1.0.1
```

### One-time setup — required secrets & environment

#### 1. Secrets  (`Settings → Secrets and variables → Actions`)

| Secret | How to get it |
|---|---|
| `NPM_TOKEN` | npmjs.com → **Avatar → Access Tokens → Generate New Token → Automation** |
| `RELEASE_TOKEN` | GitHub → **Settings → Developer settings → Personal access tokens (classic)** — scopes: `repo`, `workflow` |

#### 2. GitHub Environment  (`Settings → Environments → New environment`)

Create an environment named **`npm-publish`** and add:
- **Required reviewers** — at least one team member who must approve before every publish
- *(Optional)* **Deployment branches** — restrict to `main` only

This gates every real publish behind a human sign-off. Dry-run jobs bypass the environment intentionally.

#### 3. Verify OIDC provenance is enabled

In your npm organisation:
**npmjs.com → Organisation → Settings → Publishing → Require two-factor authentication for publish**
and ensure **"Allow publishing with granular tokens"** is on.

Provenance is attached automatically via `NPM_CONFIG_PROVENANCE=true` in the workflow — no extra steps needed.

### npm provenance

Every published package includes a signed [provenance statement](https://docs.npmjs.com/generating-provenance-statements) linking the package to this exact commit and workflow run. Consumers can verify with:

```bash
npm audit signatures @async-kit/limitx
```

---

## ✅ Design Principles

| Principle | Implementation |
|---|---|
| **Zero dependencies** | Each package ships with no runtime deps |
| **Tree-shakeable** | `"sideEffects": false` + named exports only |
| **Dual module** | ESM (`import`) + CJS (`require`) in every package |
| **Fully typed** | Strict TypeScript, no `any` in public API |
| **Cancellable** | `AbortSignal` support where applicable |
| **Observable** | Hooks (`onRetry`, `onStepComplete`, `onError`) for logging/metrics |
| **Tested** | 86 unit tests across 4 packages, `@swc/jest` for fast runs |
| **Supply chain secure** | npm provenance on every publish, OIDC-based, no token storage |

---

## 🌐 Compatibility

All four packages use **zero Node.js built-ins**. Every API relies solely on standard JavaScript (`Promise`, `setTimeout`, `AbortSignal`, `Float64Array`) — making the entire toolkit portable across runtimes and browsers.

| Environment | Support | Min version |
|---|---|---|
| **Node.js** | ✅ | ≥ 18 (recommended ≥ 24) |
| **Deno** | ✅ | Any — via `npm:@async-kit/*` specifier |
| **Bun** | ✅ | Any |
| **Chrome / Edge** | ✅ | ≥ 80 |
| **Firefox** | ✅ | ≥ 75 |
| **Safari** | ✅ | ≥ 13.1 |
| **React Native** | ✅ | Via Metro bundler |
| **Cloudflare Workers** | ✅ | ESM, `AbortSignal` built-in |
| **Vercel Edge Runtime** | ✅ | ESM, no `process` / `fs` needed |
| **AWS Lambda** | ✅ | Node.js ≥ 18 runtime |

### What each package needs

| Package | Runtime requirements |
|---|---|
| `limitx` | `Promise`, `setTimeout` / `clearTimeout` |
| `retryx` | `Promise`, `setTimeout`, `AbortSignal`, `DOMException` |
| `flowx` | `Promise`, `setTimeout`, `AbortSignal`, `DOMException` |
| `ratelimitx` | `Promise`, `setTimeout`, `AbortSignal`, `DOMException`, `Float64Array` |

> **`AbortSignal` / `DOMException`** — standard since Node.js ≥ 15 and all modern browsers. For older environments, use [`abortcontroller-polyfill`](https://www.npmjs.com/package/abortcontroller-polyfill).

---

## 🤝 Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

```bash
# Create a branch
git checkout -b feat/my-feature

# Make changes, write tests
npx nx run @async-kit/limitx:test --watch

# Lint and type-check before committing
npm run lint && npm run typecheck

# Use conventional commits
git commit -m "feat(limitx): add priority queue support"
```

---

## 🧩 Combining Packages — Real-World Recipes

The packages are designed to compose. Here are patterns that use two or more together.

### Recipe 1 — Resilient bulk data importer

Import 50 000 records: limit concurrency, retry transient failures, and protect a downstream service behind a circuit breaker.

```typescript
import { Limitx } from '@async-kit/limitx';
import { retry, CircuitBreaker, CircuitOpenError } from '@async-kit/retryx';

const limiter = new Limitx({ concurrency: 20, onError: (e) => logger.error(e) });
const cb = new CircuitBreaker({ failureThreshold: 10, successThreshold: 3, openDurationMs: 30_000 });

async function importRecord(record: RawRecord) {
  return limiter.run(() =>
    retry(
      () => cb.run(() => dataService.upsert(record)),
      {
        maxAttempts: 4,
        jitter: 'decorrelated',
        retryIf: (err) => !(err instanceof CircuitOpenError),
      }
    )
  );
}

const results = await Promise.allSettled(records.map(importRecord));
await limiter.drain();
console.log(`Imported ${results.filter(r => r.status === 'fulfilled').length} records`);
```

### Recipe 2 — Rate-limited API scraper with retry

Scrape paginated data while respecting the external API's rate limit.

```typescript
import { createLimit } from '@async-kit/limitx';
import { withRetry } from '@async-kit/retryx';
import { SlidingWindow } from '@async-kit/ratelimitx';

const rateLimiter = new SlidingWindow({ windowMs: 1_000, maxRequests: 5 });
const limit = createLimit(5);

const resilientFetch = withRetry(fetch, { maxAttempts: 3, jitter: 'full' });

async function fetchPage(page: number) {
  return limit(async () => {
    await rateLimiter.waitAndAcquire();       // pace to 5 req/s
    return resilientFetch(`/api/items?page=${page}`).then(r => r.json());
  });
}

const pages = Array.from({ length: 100 }, (_, i) => i + 1);
const allPages = await Promise.all(pages.map(fetchPage));
```

### Recipe 3 — ETL pipeline with rate-limited enrichment

Run a typed pipeline where the enrichment step respects an external quota.

```typescript
import { pipeline } from '@async-kit/flowx';
import { TokenBucket } from '@async-kit/ratelimitx';
import { retry } from '@async-kit/retryx';

const enrichmentBucket = new TokenBucket({ capacity: 10, refillRate: 10, refillInterval: 1_000 });

const etl = pipeline<RawEvent>()
  .pipe({ name: 'parse',    fn: raw  => parseEvent(raw) })
  .pipe({ name: 'validate', fn: evt  => validateEvent(evt) })
  .pipe({ name: 'enrich',   fn: async evt => {
    await enrichmentBucket.waitAndAcquire();
    return retry(() => enrichmentApi.get(evt.id), { maxAttempts: 3 });
  }, timeoutMs: 5_000 })
  .pipe({ name: 'store',    fn: evt  => database.upsert(evt) });

// Process events concurrently but bound enrichment calls
const { parallel } = await import('@async-kit/flowx');
await parallel(
  events.map(e => () => etl.run(e)),
  { concurrency: 20 }
);
```

### Recipe 4 — Graceful shutdown pattern

Pause the limiter on SIGTERM, drain active work, then exit cleanly.

```typescript
import { Limitx, LimitxAbortError } from '@async-kit/limitx';

const worker = new Limitx({ concurrency: 10 });

// Continuously enqueue incoming messages
mqClient.on('message', (msg) => {
  void worker.run(() => processMessage(msg)).catch((err) => {
    if (!(err instanceof LimitxAbortError)) logger.error(err);
  });
});

process.on('SIGTERM', async () => {
  mqClient.stop();                        // stop accepting new messages
  worker.pause();                         // stop dispatching queued tasks
  const dropped = worker.clear();        // cancel the backlog
  logger.info(`Dropped ${dropped} queued tasks`);
  await worker.drain();                  // wait for ~10 active tasks
  await database.close();
  process.exit(0);
});
```

---

## 📄 License

MIT © async-kit contributors

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=100&section=footer" width="100%"/>

**Built with TypeScript · Powered by NX · Published with provenance**

[![npm](https://img.shields.io/badge/npm-%40async--kit-CB3837?style=flat-square&logo=npm)](https://www.npmjs.com/org/async-kit)
[![GitHub](https://img.shields.io/badge/GitHub-async--kit-181717?style=flat-square&logo=github)](https://github.com/your-org/async-kit)

</div>
