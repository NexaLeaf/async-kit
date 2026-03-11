/**
 * Benchmark: @async-kit/limitx vs p-limit vs bottleneck vs async (eachLimit)
 *
 * Run:
 *   npx tsx packages/limitx/src/limitx.bench.ts
 *
 * Requirements (install once):
 *   npm install --save-dev p-limit bottleneck async tsx
 */

import { Limitx, createLimit } from './index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate async I/O work of ~`ms` milliseconds */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run a bench scenario and return elapsed ms */
async function bench(
  name: string,
  fn: () => Promise<void>,
  runs = 3
): Promise<number> {
  // Warm-up
  await fn();

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`  ${name.padEnd(32)} ${avg.toFixed(1).padStart(8)} ms  (avg of ${runs})`);
  return avg;
}

// ─── Scenario: 200 tasks × 10ms work, concurrency = 10 ──────────────────────

const TASKS = 200;
const WORK_MS = 10;
const CONCURRENCY = 10;

function makeTasks() {
  return Array.from({ length: TASKS }, () => () => delay(WORK_MS));
}

// ─── @async-kit/limitx ───────────────────────────────────────────────────────

async function runLimitx() {
  const limiter = new Limitx({ concurrency: CONCURRENCY });
  await limiter.runAll(makeTasks());
}

async function runCreateLimit() {
  const limit = createLimit(CONCURRENCY);
  await Promise.all(makeTasks().map((t) => limit(t)));
}

// ─── p-limit ─────────────────────────────────────────────────────────────────

async function runPLimit() {
  // Dynamic import so the file compiles even if p-limit isn't installed
  const { default: pLimit } = await import('p-limit' as string as never) as { default: (n: number) => (fn: () => Promise<void>) => Promise<void> };
  const limit = pLimit(CONCURRENCY);
  await Promise.all(makeTasks().map((t) => limit(t)));
}

// ─── bottleneck ──────────────────────────────────────────────────────────────

async function runBottleneck() {
  const { default: Bottleneck } = await import('bottleneck' as string as never) as { default: new (o: object) => { schedule: (fn: () => Promise<void>) => Promise<void> } };
  const limiter = new Bottleneck({ maxConcurrent: CONCURRENCY });
  await Promise.all(makeTasks().map((t) => limiter.schedule(t)));
}

// ─── async.eachLimit ─────────────────────────────────────────────────────────

async function runAsyncEachLimit() {
  const { default: asyncLib } = await import('async' as string as never) as { default: { eachLimit: (items: number[], concurrency: number, fn: (item: number, cb: (e?: Error) => void) => void, done: (err?: Error | null) => void) => void } };
  const items = Array.from({ length: TASKS }, (_, i) => i);
  await new Promise<void>((resolve, reject) => {
    asyncLib.eachLimit(
      items,
      CONCURRENCY,
      (_item, cb) => { delay(WORK_MS).then(() => cb()).catch(cb); },
      (err) => { err ? reject(err) : resolve(); }
    );
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBenchmark: ${TASKS} tasks × ${WORK_MS}ms work, concurrency=${CONCURRENCY}`);
  console.log('─'.repeat(56));

  await bench('@async-kit/limitx  (Limitx.runAll)', runLimitx);
  await bench('@async-kit/limitx  (createLimit)',    runCreateLimit);

  const missing: string[] = [];

  try { await bench('p-limit',           runPLimit);       } catch { missing.push('p-limit'); }
  try { await bench('bottleneck',        runBottleneck);   } catch { missing.push('bottleneck'); }
  try { await bench('async (eachLimit)', runAsyncEachLimit); } catch { missing.push('async'); }

  if (missing.length) {
    console.log(`\n  Skipped (not installed): ${missing.join(', ')}`);
    console.log('  Install with: npm i --save-dev ' + missing.join(' '));
  }

  console.log('─'.repeat(56));
  console.log('Done.\n');
}

main().catch(console.error);
