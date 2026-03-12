import { Cachex, cache, MemoryStore, LRUStore, CachexError } from './cachex';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('MemoryStore', () => {
  it('stores and retrieves entries', () => {
    const store = new MemoryStore<number>();
    store._set('k', { value: 42, expiresAt: Infinity, tags: [] });
    expect(store.get('k')?.value).toBe(42);
  });

  it('deletes entries', () => {
    const store = new MemoryStore<number>();
    store._set('k', { value: 1, expiresAt: Infinity, tags: [] });
    store.delete('k');
    expect(store.get('k')).toBeUndefined();
  });

  it('clears all entries', () => {
    const store = new MemoryStore<number>();
    store._set('a', { value: 1, expiresAt: Infinity, tags: [] });
    store._set('b', { value: 2, expiresAt: Infinity, tags: [] });
    store.clear();
    expect(store.size).toBe(0);
  });

  it('deleteByTag removes matching entries', () => {
    const store = new MemoryStore<number>();
    store._set('a', { value: 1, expiresAt: Infinity, tags: ['users'] });
    store._set('b', { value: 2, expiresAt: Infinity, tags: ['orders'] });
    store.deleteByTag('users');
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
  });
});

describe('LRUStore', () => {
  it('throws on maxSize < 1', () => {
    expect(() => new LRUStore(0)).toThrow(RangeError);
  });

  it('evicts LRU entry when full', () => {
    const store = new LRUStore<number>(2);
    store._set('a', { value: 1, expiresAt: Infinity, tags: [] });
    store._set('b', { value: 2, expiresAt: Infinity, tags: [] });
    store._set('c', { value: 3, expiresAt: Infinity, tags: [] });
    expect(store.get('a')).toBeUndefined(); // evicted
    expect(store.get('b')).toBeDefined();
    expect(store.get('c')).toBeDefined();
    expect(store.size).toBe(2);
  });

  it('get refreshes recency', () => {
    const store = new LRUStore<number>(2);
    store._set('a', { value: 1, expiresAt: Infinity, tags: [] });
    store._set('b', { value: 2, expiresAt: Infinity, tags: [] });
    store.get('a'); // refresh a
    store._set('c', { value: 3, expiresAt: Infinity, tags: [] }); // evicts b
    expect(store.get('a')).toBeDefined();
    expect(store.get('b')).toBeUndefined();
  });

  it('deleteByTag removes matching entries', () => {
    const store = new LRUStore<number>(5);
    store._set('a', { value: 1, expiresAt: Infinity, tags: ['x'] });
    store._set('b', { value: 2, expiresAt: Infinity, tags: ['y'] });
    store.deleteByTag('x');
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
  });
});

describe('Cachex', () => {
  it('calls fn on first miss', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    const cx = new Cachex(fn);
    expect(await cx.call()).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    const cx = new Cachex(fn);
    await cx.call();
    await cx.call();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls', async () => {
    const fn = jest.fn().mockImplementation(() => delay(20).then(() => 'x'));
    const cx = new Cachex(fn);
    const [a, b, c] = await Promise.all([cx.call(), cx.call(), cx.call()]);
    expect(a).toBe('x');
    expect(b).toBe('x');
    expect(c).toBe('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expiry', async () => {
    const fn = jest.fn().mockResolvedValue('v');
    const cx = new Cachex(fn, { ttl: 10 });
    await cx.call();
    await delay(20);
    await cx.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stale-while-revalidate returns stale and refreshes in background', async () => {
    let callCount = 0;
    const fn = jest.fn().mockImplementation(async () => {
      await delay(10);
      return `v${++callCount}`;
    });
    const cx = new Cachex(fn, { ttl: 10, staleWhileRevalidate: true });

    const first = await cx.call(); // miss → v1
    expect(first).toBe('v1');

    await delay(20); // let TTL expire

    const stale = await cx.call(); // stale hit → returns v1, background fetch starts
    expect(stale).toBe('v1');

    await delay(30); // let background fetch complete

    const fresh = await cx.call(); // fresh v2
    expect(fresh).toBe('v2');
  });

  it('invalidate removes a specific key', async () => {
    const fn = jest.fn().mockResolvedValue('r');
    const cx = new Cachex(fn);
    await cx.call(1);
    cx.invalidate(1);
    await cx.call(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('invalidateTag removes tagged entries', async () => {
    const fn = jest.fn().mockResolvedValue('r');
    const cx = new Cachex(fn, { tags: ['users'] });
    await cx.call();
    cx.invalidateTag('users');
    await cx.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clear empties cache', async () => {
    const fn = jest.fn().mockResolvedValue('r');
    const cx = new Cachex(fn);
    await cx.call();
    cx.clear();
    await cx.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stats track hits/misses/stores', async () => {
    const fn = jest.fn().mockResolvedValue('r');
    const cx = new Cachex(fn);
    await cx.call();
    await cx.call();
    const s = cx.stats();
    expect(s.misses).toBe(1);
    expect(s.hits).toBe(1);
    expect(s.stores).toBe(1);
  });

  it('fires onSet / onHit / onMiss hooks', async () => {
    const onSet = jest.fn();
    const onHit = jest.fn();
    const onMiss = jest.fn();
    const cx = new Cachex(async () => 42, { onSet, onHit, onMiss });
    await cx.call();
    await cx.call();
    expect(onMiss).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledTimes(1);
  });

  it('custom keyResolver', async () => {
    const fn = jest.fn().mockResolvedValue('r');
    const cx = new Cachex(fn, { keyResolver: (id: number) => `user:${id}` });
    await cx.call(1);
    await cx.call(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('CachexError has key property', () => {
    const err = new CachexError('boom', 'myKey');
    expect(err.key).toBe('myKey');
    expect(err.name).toBe('CachexError');
  });
});

describe('cache() functional wrapper', () => {
  it('works as a plain function and exposes .cachex', async () => {
    const fn = jest.fn().mockResolvedValue(99);
    const getVal = cache(fn);
    expect(await getVal()).toBe(99);
    expect(await getVal()).toBe(99);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getVal.cachex).toBeInstanceOf(Cachex);
    expect(getVal.cachex.stats().hits).toBe(1);
  });
});
