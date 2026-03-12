# @async-kit/cachex

Smart async function cache with **request deduplication**, **TTL**, **stale-while-revalidate**, and pluggable storage.

## Install

```bash
npm install @async-kit/cachex
```

## Quick start

```ts
import { cache } from '@async-kit/cachex';

const getUser = cache((id: number) => db.users.find(id), { ttl: 60_000 });

await getUser(1); // → hits DB
await getUser(1); // → served from cache (within 60 s)
```

## Features

| Feature | Description |
|---|---|
| **TTL** | Entries expire after `ttl` ms (default: never) |
| **Request deduplication** | Concurrent calls for the same key share one in-flight Promise |
| **Stale-while-revalidate** | Returns stale value immediately; refreshes in background |
| **Tag invalidation** | Group-invalidate entries with `invalidateTag('users')` |
| **LRU store** | Bounded memory with `LRUStore(maxSize)` |
| **Pluggable store** | Implement `CacheStore<T>` to back with Redis, localStorage, etc. |
| **Hooks** | `onSet`, `onHit`, `onMiss`, `onRevalidateError` |
| **Stats** | `hits`, `misses`, `staleHits`, `stores`, `inflight` snapshot |

## API

### `cache(fn, options?)`

Functional wrapper — returns a cached function with `.cachex` attached.

```ts
const getUser = cache(fetchUser, { ttl: 30_000, staleWhileRevalidate: true });
await getUser(42);
getUser.cachex.stats(); // { hits, misses, ... }
```

### `new Cachex(fn, options?)`

Class API — same options, more control.

```ts
const cx = new Cachex(fetchUser, { ttl: 60_000 });
await cx.call(42);
cx.invalidate(42);       // remove one key
cx.invalidateTag('usr'); // remove all tagged entries
cx.clear();              // flush everything
cx.stats();              // live counters
```

### Options

```ts
interface CachexOptions<TArgs, TReturn> {
  ttl?: number;                    // ms, default Infinity
  staleWhileRevalidate?: boolean;  // default false
  keyResolver?: (...args) => string;
  store?: CacheStore<TReturn>;     // default MemoryStore
  tags?: string[];
  onSet?: (key, value) => void;
  onHit?: (key, stale) => void;
  onMiss?: (key) => void;
  onRevalidateError?: (key, err) => void;
}
```

### Stores

```ts
import { MemoryStore, LRUStore } from '@async-kit/cachex';

// Unbounded in-memory (default)
const store = new MemoryStore<User>();

// LRU — evicts least-recently-used when full
const lru = new LRUStore<User>(500); // max 500 entries

// Custom (Redis, etc.) — implement CacheStore<T>
class RedisStore<T> implements CacheStore<T> { ... }
```

## Examples

### Stale-while-revalidate

```ts
const getConfig = cache(fetchConfig, {
  ttl: 5_000,
  staleWhileRevalidate: true,
  onRevalidateError: (key, err) => logger.error({ key, err }),
});
```

### Tag-based invalidation

```ts
const getUser = cache(fetchUser, { tags: ['users'] });
await getUser(1); await getUser(2);
getUser.cachex.invalidateTag('users'); // bust both
```

### Custom key resolver

```ts
const search = cache(doSearch, {
  keyResolver: (query, lang) => `${lang}:${query}`,
  ttl: 10_000,
});
```

## License

MIT
