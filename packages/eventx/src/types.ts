// ─── eventx — Public Types ────────────────────────────────────────────────────

/**
 * A map of event name → payload type.
 * Pass this as the generic parameter to `createBus<Events>()`.
 *
 * @example
 * type AppEvents = {
 *   userCreated: { id: number; email: string };
 *   orderPaid:   { orderId: string; amount: number };
 * }
 */
export type EventMap = Record<string, unknown>;

/** An async or sync listener function for a single event. */
export type Listener<TPayload> = (payload: TPayload, context: EventContext) => Promise<void> | void;

/** Middleware function — called before each listener invocation. */
export type Middleware<TEvents extends EventMap> = <K extends keyof TEvents>(
  event: K,
  payload: TEvents[K],
  next: () => Promise<void>
) => Promise<void> | void;

/** Context injected into every listener call. */
export interface EventContext {
  /** The event name that triggered this listener. */
  event: string;
  /** Monotonically increasing emit sequence number (useful for ordering). */
  seq: number;
  /** Timestamp of the emit call (ms since epoch). */
  emittedAt: number;
  /** AbortSignal — if the emit was cancelled, this will be aborted. */
  signal: AbortSignal;
}

/** Options for `bus.on()` subscriptions. */
export interface SubscribeOptions {
  /**
   * Maximum simultaneous listener invocations for this subscription.
   * `1` = sequential. Undefined = unbounded parallel.
   */
  concurrency?: number;
  /**
   * If set, the listener automatically unsubscribes after this many invocations.
   */
  once?: boolean;
  /**
   * If `true`, errors thrown by this listener are silently swallowed instead
   * of being passed to `onError`. Default: `false`.
   */
  ignoreErrors?: boolean;
}

/** Options for `bus.emit()`. */
export interface EmitOptions {
  /** AbortSignal — cancels pending listener dispatches when aborted. */
  signal?: AbortSignal;
  /**
   * `'parallel'` (default) — all listeners start simultaneously.
   * `'sequential'` — listeners run one after another in subscription order.
   */
  mode?: 'parallel' | 'sequential';
}

/** Options for `createBus()`. */
export interface BusOptions<TEvents extends EventMap> {
  /**
   * Called when any listener throws (and `ignoreErrors` is not set).
   * Default: re-throws the error.
   */
  onError?: (event: keyof TEvents, error: unknown, context: EventContext) => void;
  /**
   * Global middleware applied before every listener call.
   */
  middleware?: Middleware<TEvents>[];
  /**
   * Default emit mode for all events. Default: `'parallel'`.
   */
  defaultMode?: 'parallel' | 'sequential';
}

/** Return value of `bus.on()` — call to unsubscribe. */
export interface Unsubscribe {
  (): void;
}

/** Snapshot of bus statistics. */
export interface BusStats {
  /** Total events emitted since creation. */
  emitted: number;
  /** Total listener invocations that have completed. */
  dispatched: number;
  /** Total listener invocations that threw. */
  errors: number;
  /** Number of currently registered listeners across all events. */
  listeners: number;
}
