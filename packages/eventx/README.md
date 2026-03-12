# @async-kit/eventx

Typed publish/subscribe event bus with **middleware**, **concurrency control**, **once subscriptions**, **sequential/parallel emit**, and **AbortSignal** support.

## Install

```bash
npm install @async-kit/eventx
```

## Quick start

```ts
import { createBus } from '@async-kit/eventx';

type AppEvents = {
  userCreated: { id: number; email: string };
  orderPaid:   { orderId: string; amount: number };
};

const bus = createBus<AppEvents>();

bus.on('userCreated', async ({ id, email }) => {
  await sendWelcomeEmail(email);
});

await bus.emit('userCreated', { id: 1, email: 'hi@example.com' });
```

## Features

| Feature | Description |
|---|---|
| **Typed events** | Full TypeScript inference — payload types enforced per event |
| **Parallel / sequential** | Choose emit mode per-call or set a global default |
| **Concurrency control** | `concurrency: 1` makes a listener process events one at a time |
| **Once** | Auto-unsubscribe after first invocation |
| **Middleware** | Intercept every listener call (logging, auth, tracing) |
| **AbortSignal** | Cancel sequential dispatches mid-flight |
| **Error handling** | Global `onError` or per-listener `ignoreErrors` |
| **Stats** | `emitted`, `dispatched`, `errors`, `listeners` snapshot |

## API

### `createBus<Events>(options?)`

```ts
const bus = createBus<AppEvents>({
  defaultMode: 'parallel',       // or 'sequential'
  onError: (event, err, ctx) => logger.error({ event, err }),
  middleware: [loggingMiddleware],
});
```

### `bus.on(event, listener, options?)`

```ts
const off = bus.on('userCreated', async (payload, ctx) => {
  console.log(ctx.seq, ctx.emittedAt);
}, { concurrency: 2, ignoreErrors: false });

off(); // unsubscribe
```

### `bus.once(event, listener, options?)`

Fires once, then auto-removes.

### `bus.emit(event, payload, options?)`

```ts
const ac = new AbortController();
await bus.emit('orderPaid', { orderId: 'x', amount: 100 }, {
  mode: 'sequential',
  signal: ac.signal,
});
```

### `bus.off(event?)`

Remove all listeners for one event, or all events.

### `bus.listenerCount(event)`

### `bus.stats()`

```ts
{ emitted: number; dispatched: number; errors: number; listeners: number }
```

## Middleware

```ts
import type { Middleware } from '@async-kit/eventx';

const timing: Middleware<AppEvents> = async (event, payload, next) => {
  const start = Date.now();
  await next();
  console.log(event, Date.now() - start, 'ms');
};

const bus = createBus<AppEvents>({ middleware: [timing] });
```

## `EventContext`

Every listener receives a second `ctx` argument:

```ts
interface EventContext {
  event: string;    // event name
  seq: number;      // monotonically increasing emit sequence
  emittedAt: number; // ms since epoch
  signal: AbortSignal;
}
```

## Examples

### Fan-out with concurrency guard

```ts
bus.on('orderPaid', processOrder, { concurrency: 1 }); // queue, never parallel
```

### One-time setup listener

```ts
bus.once('appReady', () => startHealthChecks());
```

### Sequential audit log

```ts
await bus.emit('userDeleted', { id }, { mode: 'sequential' });
// each listener finishes before the next starts
```

## License

MIT
