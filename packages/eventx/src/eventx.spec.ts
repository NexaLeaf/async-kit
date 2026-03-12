import { EventBus, createBus, EventxError } from './eventx';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Events = {
  ping: { ts: number };
  done: undefined;
  data: string;
};

describe('EventBus', () => {
  it('delivers payload to listener', async () => {
    const bus = createBus<Events>();
    const received: number[] = [];
    bus.on('ping', ({ ts }) => { received.push(ts); });
    await bus.emit('ping', { ts: 42 });
    expect(received).toEqual([42]);
  });

  it('multiple listeners all called', async () => {
    const bus = createBus<Events>();
    const log: string[] = [];
    bus.on('data', (s) => { log.push(`a:${s}`); });
    bus.on('data', (s) => { log.push(`b:${s}`); });
    await bus.emit('data', 'hello');
    expect(log).toContain('a:hello');
    expect(log).toContain('b:hello');
  });

  it('unsubscribe stops delivery', async () => {
    const bus = createBus<Events>();
    const calls: number[] = [];
    const off = bus.on('ping', ({ ts }) => { calls.push(ts); });
    await bus.emit('ping', { ts: 1 });
    off();
    await bus.emit('ping', { ts: 2 });
    expect(calls).toEqual([1]);
  });

  it('once fires only once', async () => {
    const bus = createBus<Events>();
    const calls: number[] = [];
    bus.once('ping', ({ ts }) => { calls.push(ts); });
    await bus.emit('ping', { ts: 1 });
    await bus.emit('ping', { ts: 2 });
    expect(calls).toEqual([1]);
  });

  it('sequential mode preserves order', async () => {
    const bus = createBus<Events>({ defaultMode: 'sequential' });
    const order: string[] = [];
    bus.on('data', async (s) => { await delay(10); order.push(`a:${s}`); });
    bus.on('data', async (s) => { order.push(`b:${s}`); });
    await bus.emit('data', 'x');
    expect(order).toEqual(['a:x', 'b:x']);
  });

  it('parallel mode starts all simultaneously', async () => {
    const bus = createBus<Events>();
    const order: string[] = [];
    bus.on('data', async (s) => { await delay(20); order.push(`a:${s}`); });
    bus.on('data', (s) => { order.push(`b:${s}`); });
    await bus.emit('data', 'x');
    expect(order).toEqual(['b:x', 'a:x']); // b finishes first
  });

  it('concurrency=1 queues listener invocations', async () => {
    const bus = createBus<Events>();
    const order: number[] = [];
    bus.on('ping', async ({ ts }) => { await delay(10); order.push(ts); }, { concurrency: 1 });
    await Promise.all([
      bus.emit('ping', { ts: 1 }),
      bus.emit('ping', { ts: 2 }),
    ]);
    expect(order).toEqual([1, 2]); // sequential due to concurrency=1
  });

  it('ignoreErrors swallows listener errors', async () => {
    const bus = createBus<Events>();
    bus.on('data', () => { throw new Error('boom'); }, { ignoreErrors: true });
    await expect(bus.emit('data', 'x')).resolves.toBeUndefined();
  });

  it('onError handler receives errors', async () => {
    const errors: unknown[] = [];
    const bus = createBus<Events>({ onError: (_, err) => errors.push(err) });
    bus.on('data', () => { throw new Error('oops'); });
    await bus.emit('data', 'x');
    expect(errors).toHaveLength(1);
  });

  it('re-throws errors when no onError handler', async () => {
    const bus = createBus<Events>();
    bus.on('data', () => { throw new Error('raw'); });
    await expect(bus.emit('data', 'x')).rejects.toThrow('raw');
  });

  it('middleware runs before listener', async () => {
    const log: string[] = [];
    const bus = createBus<Events>({
      middleware: [
        async (_event, _payload, next) => { log.push('before'); await next(); log.push('after'); },
      ],
    });
    bus.on('data', () => { log.push('listener'); });
    await bus.emit('data', 'x');
    expect(log).toEqual(['before', 'listener', 'after']);
  });

  it('listenerCount returns correct value', () => {
    const bus = createBus<Events>();
    bus.on('data', () => {});
    bus.on('data', () => {});
    expect(bus.listenerCount('data')).toBe(2);
  });

  it('off() removes all listeners for an event', async () => {
    const bus = createBus<Events>();
    const calls: string[] = [];
    bus.on('data', (s) => calls.push(s));
    bus.off('data');
    await bus.emit('data', 'x');
    expect(calls).toHaveLength(0);
  });

  it('off() with no arg removes all listeners', async () => {
    const bus = createBus<Events>();
    const calls: string[] = [];
    bus.on('data', (s) => calls.push(s));
    bus.on('ping', () => calls.push('ping'));
    bus.off();
    await bus.emit('data', 'x');
    await bus.emit('ping', { ts: 1 });
    expect(calls).toHaveLength(0);
  });

  it('stats track emitted/dispatched/errors/listeners', async () => {
    const bus = createBus<Events>({ onError: () => {} });
    bus.on('data', () => {});
    bus.on('data', () => { throw new Error('e'); });
    await bus.emit('data', 'x');
    const s = bus.stats();
    expect(s.emitted).toBe(1);
    expect(s.dispatched).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.listeners).toBe(2);
  });

  it('emit respects AbortSignal', async () => {
    const bus = createBus<Events>({ defaultMode: 'sequential' });
    const calls: string[] = [];
    bus.on('data', async (s) => { await delay(5); calls.push(s); });
    bus.on('data', (s) => { calls.push(`b:${s}`); });
    const ac = new AbortController();
    ac.abort();
    await bus.emit('data', 'x', { signal: ac.signal });
    // First listener may run, second is aborted
    expect(calls).not.toContain('b:x');
  });

  it('EventxError has event property', () => {
    const err = new EventxError('boom', 'ping');
    expect(err.event).toBe('ping');
    expect(err.name).toBe('EventxError');
  });

  it('context carries seq/emittedAt/event', async () => {
    const bus = createBus<Events>();
    const ctxs: { event: string; seq: number }[] = [];
    bus.on('ping', (_, ctx) => { ctxs.push({ event: ctx.event, seq: ctx.seq }); });
    await bus.emit('ping', { ts: 1 });
    await bus.emit('ping', { ts: 2 });
    expect(ctxs[0].seq).toBe(1);
    expect(ctxs[1].seq).toBe(2);
    expect(ctxs[0].event).toBe('ping');
  });
});
