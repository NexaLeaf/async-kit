// ─── cachex — Public Types ────────────────────────────────────────────────────

/** A function that accepts any arguments and returns a Promise. */
export type AsyncFn<TArgs extends unknown[], TReturn> = (...args: TArgs) => Promise<TReturn>;

/** Converts a tuple of arguments to a cache key string. */
export type KeyResolver<TArgs extends unknown[]> = (...args: TArgs) => string;

/** Storage adapter interface — implement to plug in Redis, localStorage, etc. */
export interface CacheStore<T> {
  get(key: string): Promise<T | undefined> | T | undefined;
  set(key: string, value: T, ttlMs: number): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
  /** Optional: delete all keys matching a tag. */
  deleteByTag?(tag: string): Promise<void> | void;
}

/** Options for `cache()` and `new Cachex()`. */
export interface CachexOptions<TArgs extends unknown[], TReturn> {
  /**
   * Time-to-live in ms. Cached values older than this are considered stale.
   * Default: `Infinity` (never expires).
   */
  ttl?: number;
  /**
   * When `true`, a stale value is returned immediately while a background
   * refresh runs. The cache stays "warm" and callers never wait for a refill.
   * Default: `false`.
   */
  staleWhileRevalidate?: boolean;
  /**
   * Custom key resolver. Receives the same arguments as the wrapped function.
   * Default: `JSON.stringify(args)`.
   */
  keyResolver?: KeyResolver<TArgs>;
  /**
   * Storage adapter. Default: in-memory `MemoryStore`.
   */
  store?: CacheStore<TReturn>;
  /**
   * Tags attached to every entry written by this instance.
   * Used with `invalidateTag()` for group invalidation.
   */
  tags?: string[];
  /**
   * Maximum number of in-flight deduplication slots.
   * Useful for bounding memory in high-throughput scenarios.
   * Default: unbounded.
   */
  maxInflight?: number;
  /**
   * Called when a cache entry is written (including background revalidations).
   */
  onSet?: (key: string, value: TReturn) => void;
  /**
   * Called on every cache hit (fresh or stale).
   */
  onHit?: (key: string, stale: boolean) => void;
  /**
   * Called on cache miss before the wrapped function executes.
   */
  onMiss?: (key: string) => void;
  /**
   * Called when the underlying function throws during a background revalidation.
   * Does not suppress the error.
   */
  onRevalidateError?: (key: string, error: unknown) => void;
}

/** Snapshot of cache statistics. */
export interface CachexStats {
  hits: number;
  misses: number;
  staleHits: number;
  inflight: number;
  stores: number;
}

/** Entry stored internally — wraps the value with its expiry timestamp. */
export interface CacheEntry<T> {
  value: T;
  /** Absolute timestamp (ms) when this entry expires. `Infinity` = no expiry. */
  expiresAt: number;
  /** Tags associated with this entry for group invalidation. */
  tags: string[];
}
