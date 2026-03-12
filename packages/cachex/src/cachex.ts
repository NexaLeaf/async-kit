export type {
  AsyncFn, KeyResolver, CacheStore, CachexOptions,
  CachexStats, CacheEntry,
} from './types.js';
import type { AsyncFn, KeyResolver, CacheStore, CachexOptions, CachexStats, CacheEntry } from './types.js';

// ─── Error ───────────────────────────────────────────────────────────────────

export class CachexError extends Error {
  constructor(message: string, public readonly key: string) {
    super(message);
    this.name = 'CachexError';
  }
}

// ─── MemoryStore ──────────────────────────────────────────────────────────────

/**
 * Default in-process store. Entries are stored as `CacheEntry<T>` objects so
 * TTL and tag metadata travel with the value.
 */
export class MemoryStore<T> {
  private readonly map = new Map<string, CacheEntry<T>>();

  get(key: string): CacheEntry<T> | undefined {
    return this.map.get(key);
  }

  /** `set` stores the full entry — TTL enforcement is handled by Cachex. */
  set(key: string, value: T, _ttlMs: number): void {
    // Entry wrapping happens in Cachex.set(); MemoryStore just holds it.
    // We reach here only via the internal _rawSet which passes a CacheEntry.
    void value; void _ttlMs;
  }

  /** Internal: stores the pre-built entry directly. */
  _set(key: string, entry: CacheEntry<T>): void {
    this.map.set(key, entry);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  deleteByTag(tag: string): void {
    for (const [key, entry] of this.map) {
      if (entry.tags.includes(tag)) this.map.delete(key);
    }
  }

  /** Expose map size for testing/debugging. */
  get size(): number {
    return this.map.size;
  }
}

// ─── LRUStore ────────────────────────────────────────────────────────────────

/**
 * LRU memory store — evicts the least-recently-used entry when `maxSize` is exceeded.
 */
export class LRUStore<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxSize: number) {
    if (maxSize < 1) throw new RangeError('LRUStore maxSize must be >= 1');
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(_key: string, _value: T, _ttlMs: number): void { /* see _set */ }

  _set(key: string, entry: CacheEntry<T>): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.maxSize) {
      // Evict LRU (first entry)
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(key, entry);
  }

  delete(key: string): void { this.cache.delete(key); }
  clear(): void { this.cache.clear(); }

  deleteByTag(tag: string): void {
    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag)) this.cache.delete(key);
    }
  }

  get size(): number { return this.cache.size; }
}

// ─── Cachex ───────────────────────────────────────────────────────────────────

/**
 * Cachex — async function cache with request deduplication, TTL,
 * stale-while-revalidate, and pluggable storage.
 *
 * Wrap any async function once — callers always get a fresh or cached value
 * with zero duplicate requests for the same key.
 *
 * @example
 * const getUser = new Cachex((id: number) => db.users.find(id), { ttl: 60_000 });
 * const user = await getUser.call(1);
 */
export class Cachex<TArgs extends unknown[], TReturn> {
  private readonly fn: AsyncFn<TArgs, TReturn>;
  private readonly ttl: number;
  private readonly staleWhileRevalidate: boolean;
  private readonly keyResolver: KeyResolver<TArgs>;
  private readonly store: MemoryStore<TReturn> | LRUStore<TReturn>;
  private readonly tags: string[];
  private readonly onSet?: (key: string, value: TReturn) => void;
  private readonly onHit?: (key: string, stale: boolean) => void;
  private readonly onMiss?: (key: string) => void;
  private readonly onRevalidateError?: (key: string, error: unknown) => void;

  // In-flight deduplication: key → pending Promise
  private readonly inflight = new Map<string, Promise<TReturn>>();

  private _stats: CachexStats = { hits: 0, misses: 0, staleHits: 0, inflight: 0, stores: 0 };

  constructor(fn: AsyncFn<TArgs, TReturn>, options: CachexOptions<TArgs, TReturn> = {}) {
    this.fn = fn;
    this.ttl = options.ttl ?? Infinity;
    this.staleWhileRevalidate = options.staleWhileRevalidate ?? false;
    this.keyResolver = options.keyResolver ?? ((...args) => JSON.stringify(args));
    this.store = (options.store as MemoryStore<TReturn>) ?? new MemoryStore<TReturn>();
    this.tags = options.tags ?? [];
    this.onSet = options.onSet;
    this.onHit = options.onHit;
    this.onMiss = options.onMiss;
    this.onRevalidateError = options.onRevalidateError;
  }

  /** Execute with cache — the primary API. */
  async call(...args: TArgs): Promise<TReturn> {
    const key = this.keyResolver(...args);
    const entry = this._getEntry(key);
    const now = Date.now();

    if (entry) {
      const isFresh = entry.expiresAt > now;

      if (isFresh) {
        this._stats.hits++;
        this.onHit?.(key, false);
        return entry.value;
      }

      // Stale entry
      if (this.staleWhileRevalidate) {
        this._stats.staleHits++;
        this.onHit?.(key, true);
        // Background revalidation — don't await
        void this._fetch(key, args).catch((err) => this.onRevalidateError?.(key, err));
        return entry.value;
      }
    }

    this._stats.misses++;
    this.onMiss?.(key);
    return this._fetch(key, args);
  }

  /** Manually invalidate a specific key. */
  invalidate(...args: TArgs): void {
    const key = this.keyResolver(...args);
    this.store.delete(key);
  }

  /** Invalidate all entries sharing a tag. */
  invalidateTag(tag: string): void {
    if (this.store.deleteByTag) this.store.deleteByTag(tag);
  }

  /** Flush the entire cache. */
  clear(): void {
    this.store.clear();
  }

  /** Snapshot of hit/miss/inflight counters. */
  stats(): CachexStats {
    return { ...this._stats, inflight: this.inflight.size };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _getEntry(key: string): CacheEntry<TReturn> | undefined {
    // Both MemoryStore and LRUStore expose _set and get(key) → CacheEntry
    return (this.store as MemoryStore<TReturn>).get(key) as CacheEntry<TReturn> | undefined;
  }

  private _setEntry(key: string, value: TReturn): void {
    const entry: CacheEntry<TReturn> = {
      value,
      expiresAt: this.ttl === Infinity ? Infinity : Date.now() + this.ttl,
      tags: this.tags,
    };
    (this.store as MemoryStore<TReturn>)._set(key, entry);
    this._stats.stores++;
    this.onSet?.(key, value);
  }

  private _fetch(key: string, args: TArgs): Promise<TReturn> {
    // Deduplicate concurrent calls for the same key
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fn(...args).then((value) => {
      this._setEntry(key, value);
      return value;
    }).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}

// ─── Functional wrapper ───────────────────────────────────────────────────────

/**
 * Wrap an async function with caching — functional API.
 *
 * @example
 * const getUser = cache((id: number) => db.users.find(id), { ttl: 60_000 });
 * await getUser(1); // hits DB
 * await getUser(1); // served from cache
 */
export function cache<TArgs extends unknown[], TReturn>(
  fn: AsyncFn<TArgs, TReturn>,
  options?: CachexOptions<TArgs, TReturn>
): { (...args: TArgs): Promise<TReturn>; readonly cachex: Cachex<TArgs, TReturn> } {
  const instance = new Cachex(fn, options);
  const wrapped = (...args: TArgs) => instance.call(...args);
  (wrapped as unknown as { cachex: Cachex<TArgs, TReturn> }).cachex = instance;
  return wrapped as { (...args: TArgs): Promise<TReturn>; readonly cachex: Cachex<TArgs, TReturn> };
}
