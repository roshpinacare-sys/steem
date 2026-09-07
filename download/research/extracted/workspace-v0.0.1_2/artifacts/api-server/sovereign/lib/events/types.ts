/**
 * lib/events/types.ts — TFA Resilient Event-Bus: shared types.
 *
 * Outbox pattern:
 *   1. Business operation + event write happen in the SAME transaction.
 *   2. A background dispatcher reads pending OutboxEntries and delivers them.
 *   3. Delivery is at-least-once: if dispatch crashes, the entry stays
 *      "pending" and will be retried. Handlers must be idempotent.
 *
 * Tenant isolation: every event carries tenantId; handlers only receive events
 * for the tenantId they are subscribed to (or wildcard "*").
 *
 * Audit: every dispatch (success or failure) is recorded in the outbox entry's
 * attempt history, giving a tamper-evident delivery log.
 */

// ─── Primitive types ──────────────────────────────────────────────────────────

/** ISO-8601 timestamp string. */
export type ISOTimestamp = string;

/** Unique event id (uuidv4-style string). */
export type EventId = string;

// ─── Domain event ─────────────────────────────────────────────────────────────

/**
 * DomainEvent — the immutable fact that something happened.
 * Payload is opaque to the bus; handlers cast it to the expected shape.
 */
export interface DomainEvent<T = unknown> {
  /** Globally unique id — used for idempotency checks in handlers. */
  id: EventId;
  /** Tenant that owns this event. MUST match the business entity's tenantId. */
  tenantId: string;
  /** Hierarchical dot-notation type, e.g. "auth.login", "billing.invoice.paid". */
  type: string;
  /** The data associated with the event. Serialisable (no functions/circular refs). */
  payload: T;
  /** When the event occurred (set by the emitter). */
  occurredAt: ISOTimestamp;
  /** Which service / actor produced this event. */
  source: string;
}

// ─── Outbox entry (the durable wrapper around a DomainEvent) ─────────────────

export type OutboxStatus = "pending" | "dispatched" | "failed";

export interface AttemptRecord {
  attemptedAt: ISOTimestamp;
  success: boolean;
  error?: string;
}

export interface OutboxEntry<T = unknown> {
  /** Same id as the wrapped DomainEvent (1-to-1). */
  id: EventId;
  tenantId: string;
  event: DomainEvent<T>;
  status: OutboxStatus;
  /** Number of dispatch attempts so far. */
  attempts: number;
  /** Maximum retries before status becomes "failed" (default: 5). */
  maxAttempts: number;
  /** Full attempt history — tamper-evident delivery log. */
  history: AttemptRecord[];
  createdAt: ISOTimestamp;
  /** Last time a dispatch was attempted. Null if never tried. */
  lastAttemptAt: ISOTimestamp | null;
  /** When successfully dispatched. Null if not yet. */
  dispatchedAt: ISOTimestamp | null;
}

// ─── EventHandler ─────────────────────────────────────────────────────────────

/**
 * EventHandler — async function that processes a DomainEvent.
 * Must be idempotent: may be called more than once for the same event.
 * Throwing causes the dispatch to record a failed attempt and schedule retry.
 */
export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

// ─── Subscription ─────────────────────────────────────────────────────────────

export interface Subscription {
  id: string;
  /** Dot-notation type pattern. Use "*" to match all types. Prefix wildcard:
   *  "auth.*" matches "auth.login", "auth.logout", etc. */
  typePattern: string;
  /** Tenant filter. "*" means all tenants (system-level subscription). */
  tenantId: string;
  handler: EventHandler;
}

// ─── EventBus interface ───────────────────────────────────────────────────────

/**
 * EventBus — the single interface all services use to emit and handle events.
 *
 * Contract:
 * - `emit` is synchronous-safe: it writes to the outbox atomically with the
 *   calling operation (in production this would be the same DB transaction).
 *   It NEVER calls handlers directly — that is the dispatcher's job.
 * - `dispatch` is called by a background worker. It picks pending entries,
 *   calls matching handlers, and records the result.
 * - `subscribe` / `unsubscribe` manage handler registrations.
 * - `pendingCount` and `failedEntries` expose observability.
 */
export interface EventBus {
  /**
   * Emit — write the event to the outbox. Returns the OutboxEntry id.
   * Does NOT deliver to handlers immediately.
   */
  emit<T>(event: Omit<DomainEvent<T>, "id" | "occurredAt"> & { id?: string; occurredAt?: string }): string;

  /**
   * Dispatch — run one dispatch cycle.
   * Picks all pending entries, calls matching handlers, updates status.
   * Returns { dispatched, failed } counts for this cycle.
   */
  dispatch(): Promise<{ dispatched: number; failed: number }>;

  /**
   * Subscribe to events matching typePattern scoped to tenantId (or "*").
   * Returns a subscription id that can be used to unsubscribe.
   */
  subscribe<T = unknown>(
    typePattern: string,
    tenantId: string,
    handler: EventHandler<T>,
  ): string;

  /** Remove a subscription by id. */
  unsubscribe(subscriptionId: string): void;

  /** How many entries are currently pending delivery. */
  pendingCount(tenantId?: string): number;

  /** All entries that have exhausted retries. */
  failedEntries(tenantId?: string): OutboxEntry[];

  /** Full outbox — for auditing and tests. */
  allEntries(tenantId?: string): OutboxEntry[];

  /**
   * Replay — reset a failed entry back to "pending" for manual retry.
   * Throws if entry doesn't exist or doesn't belong to tenantId.
   */
  replay(tenantId: string, eventId: string): void;

  /**
   * replayEvents — state-reconstruction replay.
   *
   * Re-invokes currently-registered handlers for every dispatched event in the
   * outbox for the given tenant (in createdAt order). Does NOT modify entry
   * status, attempts, or history — the outbox stays a faithful delivery log;
   * replay is a read-only cursor over the immutable event stream.
   *
   * Fail-closed: if any handler throws, replay aborts immediately and the
   * error is re-thrown (state reconstruction is all-or-nothing).
   *
   * Tenant isolation: tenantId is required ("*" rejected); only events for
   * that tenant are replayed.
   *
   * Returns the number of events replayed.
   */
  replayEvents(
    tenantId: string,
    opts?: { typePattern?: string; sinceId?: string },
  ): Promise<number>;
}
