export type {
  EventMap, Listener, Middleware, EventContext,
  SubscribeOptions, EmitOptions, BusOptions, Unsubscribe, BusStats,
} from './types.js';
import type {
  EventMap, Listener, Middleware, EventContext,
  SubscribeOptions, EmitOptions, BusOptions, Unsubscribe, BusStats,
} from './types.js';

// ─── Error ────────────────────────────────────────────────────────────────────

export class EventxError extends Error {
  constructor(message: string, public readonly event: string) {
    super(message);
    this.name = 'EventxError';
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface Subscription<TPayload> {
  listener: Listener<TPayload>;
  concurrency: number;
  once: boolean;
  ignoreErrors: boolean;
  running: number;
  queue: Array<() => void>;
}

// ─── EventBus ─────────────────────────────────────────────────────────────────

/**
 * EventBus — typed publish/subscribe bus with middleware, concurrency control,
 * once subscriptions, and sequential/parallel emit modes.
 *
 * @example
 * type AppEvents = { userCreated: { id: number } };
 * const bus = createBus<AppEvents>();
 * bus.on('userCreated', async ({ id }) => console.log(id));
 * await bus.emit('userCreated', { id: 42 });
 */
export class EventBus<TEvents extends EventMap> {
  private readonly subs = new Map<keyof TEvents, Set<Subscription<unknown>>>();
  private readonly onError?: BusOptions<TEvents>['onError'];
  private readonly middleware: NonNullable<BusOptions<TEvents>['middleware']>;
  private readonly defaultMode: 'parallel' | 'sequential';

  private _seq = 0;
  private _stats: BusStats = { emitted: 0, dispatched: 0, errors: 0, listeners: 0 };

  constructor(options: BusOptions<TEvents> = {}) {
    this.onError = options.onError;
    this.middleware = options.middleware ?? [];
    this.defaultMode = options.defaultMode ?? 'parallel';
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof TEvents>(
    event: K,
    listener: Listener<TEvents[K]>,
    options: SubscribeOptions = {}
  ): Unsubscribe {
    const sub: Subscription<TEvents[K]> = {
      listener,
      concurrency: options.concurrency ?? Infinity,
      once: options.once ?? false,
      ignoreErrors: options.ignoreErrors ?? false,
      running: 0,
      queue: [],
    };

    if (sub.concurrency < 1) throw new RangeError('concurrency must be >= 1');

    if (!this.subs.has(event)) this.subs.set(event, new Set());
    (this.subs.get(event) as Set<Subscription<TEvents[K]>>).add(sub as unknown as Subscription<unknown>);
    this._stats.listeners++;

    return () => {
      const set = this.subs.get(event);
      if (set?.delete(sub as unknown as Subscription<unknown>)) {
        this._stats.listeners--;
        if (set.size === 0) this.subs.delete(event);
      }
    };
  }

  /** Subscribe once — automatically unsubscribes after first invocation. */
  once<K extends keyof TEvents>(
    event: K,
    listener: Listener<TEvents[K]>,
    options: Omit<SubscribeOptions, 'once'> = {}
  ): Unsubscribe {
    return this.on(event, listener, { ...options, once: true });
  }

  /** Emit an event — resolves when all listeners have settled. */
  async emit<K extends keyof TEvents>(
    event: K,
    payload: TEvents[K],
    options: EmitOptions = {}
  ): Promise<void> {
    const mode = options.mode ?? this.defaultMode;
    const signal = options.signal;
    const seq = ++this._seq;
    const ctx: EventContext = {
      event: event as string,
      seq,
      emittedAt: Date.now(),
      signal: signal ?? new AbortController().signal,
    };

    this._stats.emitted++;

    const set = this.subs.get(event);
    if (!set || set.size === 0) return;

    const subs = [...set];

    // Remove once-subscriptions before dispatch
    for (const sub of subs) {
      if (sub.once) {
        set.delete(sub);
        this._stats.listeners--;
        if (set.size === 0) this.subs.delete(event);
      }
    }

    const dispatch = (sub: Subscription<unknown>) =>
      this._dispatch(event, payload, ctx, sub);

    if (mode === 'sequential') {
      for (const sub of subs) {
        if (signal?.aborted) break;
        await dispatch(sub);
      }
    } else {
      await Promise.all(subs.map(dispatch));
    }
  }

  /** Remove all subscriptions for an event, or all events if omitted. */
  off<K extends keyof TEvents>(event?: K): void {
    if (event === undefined) {
      for (const [, set] of this.subs) this._stats.listeners -= set.size;
      this.subs.clear();
    } else {
      const set = this.subs.get(event);
      if (set) {
        this._stats.listeners -= set.size;
        this.subs.delete(event);
      }
    }
  }

  /** Number of listeners registered for an event. */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.subs.get(event)?.size ?? 0;
  }

  /** Snapshot of bus statistics. */
  stats(): BusStats {
    return { ...this._stats };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _dispatch<K extends keyof TEvents>(
    event: K,
    payload: TEvents[K],
    ctx: EventContext,
    sub: Subscription<unknown>
  ): Promise<void> {
    if (ctx.signal.aborted) return;

    // Concurrency gate
    if (sub.running >= sub.concurrency) {
      await new Promise<void>((resolve) => sub.queue.push(resolve));
    }

    sub.running++;

    const invoke = async () => {
      try {
        await this._runMiddleware(event, payload, ctx, async () => {
          await (sub.listener as Listener<TEvents[K]>)(payload, ctx);
        });
        this._stats.dispatched++;
      } catch (err) {
        this._stats.errors++;
        if (!sub.ignoreErrors) {
          if (this.onError) {
            this.onError(event, err, ctx);
          } else {
            throw err;
          }
        }
      } finally {
        sub.running--;
        const next = sub.queue.shift();
        if (next) next();
      }
    };

    await invoke();
  }

  private async _runMiddleware<K extends keyof TEvents>(
    event: K,
    payload: TEvents[K],
    _ctx: EventContext,
    final: () => Promise<void>
  ): Promise<void> {
    if (this.middleware.length === 0) {
      await final();
      return;
    }

    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx < this.middleware.length) {
        const mw = this.middleware[idx++];
        await mw(event, payload, next);
      } else {
        await final();
      }
    };

    await next();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a typed event bus.
 *
 * @example
 * const bus = createBus<{ ping: { ts: number } }>();
 * bus.on('ping', ({ ts }) => console.log(ts));
 * await bus.emit('ping', { ts: Date.now() });
 */
export function createBus<TEvents extends EventMap>(
  options?: BusOptions<TEvents>
): EventBus<TEvents> {
  return new EventBus<TEvents>(options);
}
