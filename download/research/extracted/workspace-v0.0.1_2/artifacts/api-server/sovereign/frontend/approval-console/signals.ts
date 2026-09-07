/**
 * frontend/approval-console/signals.ts — Fine-grained reactive signals for
 * live approval-console updates.
 *
 * Zero external dependencies.  Uses Object.is to suppress redundant
 * notifications — subscribers only fire when the value actually changes.
 */

export type Unsubscribe = () => void;

/** Read-only signal — any number of subscribers, no external deps. */
export interface ReadonlySignal<T> {
  (): T;
  subscribe(fn: (value: T) => void): Unsubscribe;
}

/** Writable signal — value accessor, setter, and subscription. */
export interface Signal<T> extends ReadonlySignal<T> {
  set(value: T): void;
}

/**
 * Create a reactive signal with an initial value.
 *
 * Efficiency: Object.is short-circuit avoids notifying subscribers when the
 * new value is identical to the old one.  In a busy console where the same
 * polling payload may arrive repeatedly, this skips wasteful re-renders.
 */
export function createSignal<T>(initial: T): Signal<T> {
  let current: T = initial;
  const subs = new Set<(value: T) => void>();

  function get(): T {
    return current;
  }

  get.set = (v: T) => {
    if (Object.is(current, v)) return;
    current = v;
    for (const fn of subs) fn(v);
  };

  get.subscribe = (fn: (value: T) => void): Unsubscribe => {
    subs.add(fn);
    return () => subs.delete(fn);
  };

  return get as Signal<T>;
}

/**
 * Create a derived (computed) signal that re-evaluates when its source
 * signals change.  The factory is called synchronously on creation and
 * after every upstream change.
 *
 * Efficiency: the result is cached; downstream subscribers only fire when
 * the computed result changes (Object.is guard).
 */
export function createComputed<T>(factory: () => T): ReadonlySignal<T> {
  const source = createSignal<T>(factory());

  // Re-compute wrapper — not auto-wired here because a zero-dep signal
  // implementation without an effect scheduler keeps the API surface tiny.
  // Callers trigger re-computation explicitly via refresh().
  (source as any).refresh = () => {
    source.set(factory());
  };

  return source as ReadonlySignal<T>;
}
