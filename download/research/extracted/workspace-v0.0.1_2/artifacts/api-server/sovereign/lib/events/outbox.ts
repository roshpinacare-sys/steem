/**
 * lib/events/outbox.ts — InMemoryOutbox: EventBus implementation.
 *
 * Simulates the outbox pattern without an external database:
 * - emit() writes atomically to an in-process store (production: same DB tx).
 * - dispatch() picks pending entries, calls handlers, records attempts.
 * - at-least-once delivery: crashed dispatch leaves entry "pending" → retry.
 * - Tenant isolation: handlers only receive events scoped to their tenantId.
 * - Audit: every attempt (success or failure) is appended to entry.history.
 *
 * Thread safety note: Node is single-threaded; concurrent dispatches from the
 * same process are safe. For multi-process, a real DB with SELECT FOR UPDATE
 * SKIP LOCKED replaces this store — the interface stays identical.
 */

import type {
  DomainEvent,
  OutboxEntry,
  OutboxStatus,
  EventBus,
  EventHandler,
  Subscription,
  AttemptRecord,
} from "./types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function generateId(): string {
  // Node 24 has crypto.randomUUID() built-in; no external dependency.
  return crypto.randomUUID();
}

/**
 * Match a subscription typePattern against an event type.
 * Rules:
 *   "*"       → matches everything
 *   "auth.*"  → matches "auth.login", "auth.logout", NOT "billing.paid"
 *   exact     → "auth.login" matches only "auth.login"
 */
function matchesPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventType === prefix || eventType.startsWith(prefix + ".");
  }
  return pattern === eventType;
}

/**
 * Match a subscription tenantId against an event tenantId.
 * Subscription with tenantId "*" receives all tenants (system-level).
 */
function matchesTenant(subTenantId: string, eventTenantId: string): boolean {
  return subTenantId === "*" || subTenantId === eventTenantId;
}

// ─── InMemoryOutbox ───────────────────────────────────────────────────────────

export class InMemoryOutbox implements EventBus {
  /** The outbox store: eventId → OutboxEntry */
  private readonly store = new Map<string, OutboxEntry>();

  /** Registered subscriptions: subscriptionId → Subscription */
  private readonly subscriptions = new Map<string, Subscription>();

  /** Default maximum dispatch attempts per entry. */
  private readonly defaultMaxAttempts: number;

  constructor(options: { maxAttempts?: number } = {}) {
    this.defaultMaxAttempts = options.maxAttempts ?? 5;
  }

  // ── emit ────────────────────────────────────────────────────────────────────

  emit<T>(
    partialEvent: Omit<DomainEvent<T>, "id" | "occurredAt"> & {
      id?: string;
      occurredAt?: string;
    },
  ): string {
    // Validate required fields — fail-closed on invalid input.
    if (!partialEvent.tenantId) {
      throw new Error("EventBus.emit: tenantId is required");
    }
    if (!partialEvent.type) {
      throw new Error("EventBus.emit: type is required");
    }
    if (!partialEvent.source) {
      throw new Error("EventBus.emit: source is required");
    }
    if (partialEvent.payload === undefined) {
      throw new Error("EventBus.emit: payload is required (use null for empty payload)");
    }

    const event: DomainEvent<T> = {
      id: partialEvent.id ?? generateId(),
      tenantId: partialEvent.tenantId,
      type: partialEvent.type,
      payload: partialEvent.payload,
      occurredAt: partialEvent.occurredAt ?? now(),
      source: partialEvent.source,
    };

    const entry: OutboxEntry<T> = {
      id: event.id,
      tenantId: event.tenantId,
      event,
      status: "pending",
      attempts: 0,
      maxAttempts: this.defaultMaxAttempts,
      history: [],
      createdAt: now(),
      lastAttemptAt: null,
      dispatchedAt: null,
    };

    this.store.set(event.id, entry as OutboxEntry);
    return event.id;
  }

  // ── dispatch ────────────────────────────────────────────────────────────────

  async dispatch(): Promise<{ dispatched: number; failed: number }> {
    let dispatched = 0;
    let failed = 0;

    // Snapshot pending entries — dispatch the snapshot, not a live view,
    // so re-entrant emits during dispatch don't affect this cycle.
    const pending = Array.from(this.store.values()).filter(
      (e) => e.status === "pending",
    );

    for (const entry of pending) {
      const attemptedAt = now();
      entry.attempts += 1;
      entry.lastAttemptAt = attemptedAt;

      // Find matching subscriptions (type + tenant).
      const matchingSubs = Array.from(this.subscriptions.values()).filter(
        (sub) =>
          matchesPattern(sub.typePattern, entry.event.type) &&
          matchesTenant(sub.tenantId, entry.tenantId),
      );

      // If no subscribers, mark as dispatched (vacuously delivered).
      if (matchingSubs.length === 0) {
        const record: AttemptRecord = { attemptedAt, success: true };
        entry.history.push(record);
        entry.status = "dispatched";
        entry.dispatchedAt = now();
        dispatched += 1;
        continue;
      }

      // Call each handler. Collect errors.
      const errors: string[] = [];
      for (const sub of matchingSubs) {
        try {
          await (sub.handler as EventHandler)(entry.event);
        } catch (err) {
          errors.push(
            `[sub:${sub.id}] ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (errors.length === 0) {
        // All handlers succeeded.
        const record: AttemptRecord = { attemptedAt, success: true };
        entry.history.push(record);
        entry.status = "dispatched";
        entry.dispatchedAt = now();
        dispatched += 1;
      } else {
        // At least one handler failed.
        const errorMsg = errors.join("; ");
        const record: AttemptRecord = { attemptedAt, success: false, error: errorMsg };
        entry.history.push(record);

        if (entry.attempts >= entry.maxAttempts) {
          // Exhausted retries → mark failed.
          entry.status = "failed";
          failed += 1;
        } else {
          // Stay "pending" — will be retried on next dispatch cycle.
          // (status remains "pending")
        }
      }
    }

    return { dispatched, failed };
  }

  // ── subscribe / unsubscribe ─────────────────────────────────────────────────

  subscribe<T = unknown>(
    typePattern: string,
    tenantId: string,
    handler: EventHandler<T>,
  ): string {
    if (!typePattern) throw new Error("EventBus.subscribe: typePattern is required");
    if (!tenantId) throw new Error("EventBus.subscribe: tenantId is required");

    const id = generateId();
    this.subscriptions.set(id, {
      id,
      typePattern,
      tenantId,
      handler: handler as EventHandler,
    });
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  // ── observability ───────────────────────────────────────────────────────────

  pendingCount(tenantId?: string): number {
    let count = 0;
    for (const e of this.store.values()) {
      if (e.status === "pending") {
        if (!tenantId || e.tenantId === tenantId) count++;
      }
    }
    return count;
  }

  failedEntries(tenantId?: string): OutboxEntry[] {
    const result: OutboxEntry[] = [];
    for (const e of this.store.values()) {
      if (e.status === "failed") {
        if (!tenantId || e.tenantId === tenantId) result.push(e);
      }
    }
    return result;
  }

  allEntries(tenantId?: string): OutboxEntry[] {
    const result: OutboxEntry[] = [];
    for (const e of this.store.values()) {
      if (!tenantId || e.tenantId === tenantId) result.push(e);
    }
    return result;
  }

  // ── replay ──────────────────────────────────────────────────────────────────

  replay(tenantId: string, eventId: string): void {
    const entry = this.store.get(eventId);
    if (!entry) {
      throw new Error(`EventBus.replay: event ${eventId} not found`);
    }
    if (entry.tenantId !== tenantId) {
      throw new Error(
        `EventBus.replay: tenant isolation violation — event ${eventId} belongs to ${entry.tenantId}`,
      );
    }
    if (entry.status !== "failed") {
      throw new Error(
        `EventBus.replay: can only replay failed entries (current status: ${entry.status})`,
      );
    }
    entry.status = "pending";
    entry.dispatchedAt = null;
    // Note: attempts and history are preserved — the replay is documented.
  }

  // ── replayEvents (state-reconstruction) ─────────────────────────────────────

  async replayEvents(
    tenantId: string,
    opts: { typePattern?: string; sinceId?: string } = {},
  ): Promise<number> {
    if (!tenantId) {
      throw new Error("EventBus.replayEvents: tenantId is required");
    }
    if (tenantId === "*") {
      throw new Error(
        "EventBus.replayEvents: wildcard tenant '*' is not allowed (loop per tenant)",
      );
    }

    // Collect dispatched entries for this tenant in createdAt order.
    const all = Array.from(this.store.values())
      .filter((e) => e.tenantId === tenantId && e.status === "dispatched")
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

    // Apply sinceId cursor — start AFTER the entry with that id.
    let start = 0;
    if (opts.sinceId) {
      const idx = all.findIndex((e) => e.id === opts.sinceId);
      if (idx < 0) {
        throw new Error(
          `EventBus.replayEvents: sinceId ${opts.sinceId} not found for tenant ${tenantId}`,
        );
      }
      start = idx + 1;
    }

    const pattern = opts.typePattern;
    let replayed = 0;

    for (let i = start; i < all.length; i++) {
      const entry = all[i];
      if (pattern && !matchesPattern(pattern, entry.event.type)) continue;

      const matchingSubs = Array.from(this.subscriptions.values()).filter(
        (sub) =>
          matchesPattern(sub.typePattern, entry.event.type) &&
          matchesTenant(sub.tenantId, entry.tenantId),
      );

      for (const sub of matchingSubs) {
        // Fail-closed: any handler error aborts the replay.
        await (sub.handler as EventHandler)(entry.event);
      }
      replayed += 1;
    }

    return replayed;
  }
}
