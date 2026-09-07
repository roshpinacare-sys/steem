/**
 * lib/escrow/pg-threshold-approval-store.ts — PgThresholdApprovalStore.
 *
 * PURPOSE
 * -------
 * Durable replay protection for threshold-approval tokens. The in-memory store
 * (InMemoryThresholdApprovalStore) loses its consumed-id set on restart, so a
 * process restart would let an already-spent approval token be replayed. This
 * store persists consumed approval ids so replay protection SURVIVES RESTART.
 *
 * SYNC INTERFACE, DURABLE BACKING (preload + write-through)
 * ---------------------------------------------------------
 * `ThresholdApprovalStore` is synchronous (hasConsumed → boolean, consume → void),
 * so this store uses the same preload + write-through pattern as PgAuditSync /
 * PgIdentityStore:
 *   1. constructor(pool) — wraps a DbPool (InMemoryPool in tests, pg.Pool in prod).
 *   2. init(): Promise<void> — CREATE TABLE IF NOT EXISTS, then preload ALL
 *      consumed ids into an in-memory Set. Must be awaited before serving traffic.
 *   3. hasConsumed(id) — served synchronously from the in-memory mirror.
 *   4. consume(id) — written to the mirror synchronously; persisted to pg
 *      asynchronously (write-through, fire-and-forget). Idempotent: a second
 *      consume of the same id is a no-op (no duplicate INSERT).
 *
 * fail-closed: a blank / non-string id is rejected (throws). The replay check in
 * validateAndConsumeApproval always calls hasConsumed BEFORE consume, so the
 * mirror is the authority for the synchronous decision; the async write only
 * extends durability, it never gates the decision.
 *
 * InMemoryPool limitations honoured: no RETURNING, no ON CONFLICT, no COUNT(*).
 *
 * Zero external dependencies.
 */

import type { DbPool } from "../db/types.ts";
import type { ThresholdApprovalStore } from "./threshold-approval.ts";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS consumed_threshold_approvals (
    id          TEXT,
    consumed_at TEXT
  )
`;

type ConsumedRow = { id: string; consumed_at: string };

export class PgThresholdApprovalStore implements ThresholdApprovalStore {
  private readonly pool: DbPool;
  /** In-memory mirror of consumed ids, serving synchronous hasConsumed(). */
  private readonly consumed = new Set<string>();
  /** Count of async write-through failures (observability). */
  private writeErrors = 0;

  constructor(pool: DbPool) {
    if (!pool) throw new Error("PgThresholdApprovalStore: pool is required");
    this.pool = pool;
  }

  /**
   * Initialise: create the table if absent, then preload all consumed ids into
   * the in-memory mirror. Must be awaited before the server accepts traffic.
   * Idempotent — safe to call more than once (re-preloads from pg each time).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
    const result = await this.pool.query<ConsumedRow>(
      "SELECT id, consumed_at FROM consumed_threshold_approvals",
      [],
    );
    this.consumed.clear();
    for (const row of result.rows) {
      if (row && typeof row.id === "string" && row.id.length > 0) {
        this.consumed.add(row.id);
      }
    }
  }

  // ─── ThresholdApprovalStore (synchronous interface) ───────────────────────

  /** True iff this approval id has already been consumed (replay protection). */
  hasConsumed(id: string): boolean {
    return this.consumed.has(id);
  }

  /**
   * Mark an approval id as consumed. Synchronous to the mirror; durable via an
   * async write-through INSERT. Idempotent: re-consuming an id is a no-op.
   * fail-closed: a blank / non-string id is rejected.
   */
  consume(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("PgThresholdApprovalStore.consume: id must be a non-empty string");
    }
    if (this.consumed.has(id)) return; // already spent — no duplicate persist

    // ── Sync: mirror ──
    this.consumed.add(id);

    // ── Async: write-through to pg (fire-and-forget) ──
    this.pool.query(
      "INSERT INTO consumed_threshold_approvals (id, consumed_at) VALUES ($1, $2)",
      [id, new Date().toISOString()],
    ).catch((err: unknown) => {
      this.writeErrors++;
      console.error(
        `[PgThresholdApprovalStore] write-through INSERT failed for approval ${id}:`,
        err,
      );
    });
  }

  /** Number of async write-through failures since startup (observability). */
  getWriteErrorCount(): number {
    return this.writeErrors;
  }
}
