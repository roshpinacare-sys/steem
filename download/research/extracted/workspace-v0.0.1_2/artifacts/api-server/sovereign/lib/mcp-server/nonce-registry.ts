/**
 * lib/mcp-server/nonce-registry.ts — replay-protection registry for
 * ApprovalCapabilityToken nonces, with TTL-aware eviction.
 *
 * PURPOSE
 * -------
 * `TfaMcpServer.handleApproveExecution` rejects a capabilityToken whose nonce
 * has already been seen (replay protection). Previously this was a bare
 * `Set<string>` held in process memory — restart wipes it (a replayed token
 * that was consumed just before a restart would be accepted again, as long
 * as it hasn't expired yet) and it grows without bound.
 *
 * `NonceRegistry` generalises this into a small, swappable interface:
 *   • `InMemoryNonceRegistry` — same in-memory behaviour as before, but with
 *     TTL-aware pruning so memory doesn't grow without bound.
 *   • `PgNonceRegistry` — durable, Postgres-backed (preload + write-through,
 *     same pattern as PgThresholdApprovalStore), so replay protection survives
 *     a process restart.
 *
 * TTL RATIONALE
 * -------------
 * `verifyCapabilityToken` checks `expiresAt` BEFORE the nonce-reuse check (see
 * mcp-server.ts handleApproveExecution): an expired token is rejected as
 * "expired" regardless of nonce. Therefore a nonce only needs to be remembered
 * until its token's `expiresAt` — after that, replay is already blocked by the
 * expiry check, so the entry is safe to evict. `add(nonce, expiresAt)` records
 * this TTL; `has()` lazily prunes expired entries before checking.
 *
 * SYNCHRONOUS INTERFACE, DURABLE BACKING
 * ---------------------------------------
 * Both `has` and `add` are synchronous (no DB round-trip on the request path),
 * matching `PgThresholdApprovalStore`'s preload + write-through pattern:
 * `PgNonceRegistry.init()` must be awaited once at startup to preload
 * non-expired nonces; `add()` writes through to pg asynchronously
 * (fire-and-forget) and is idempotent.
 *
 * fail-closed: a blank/non-string nonce, or a non-ISO-8601 `expiresAt`, throws.
 *
 * Zero external dependencies.
 */

import type { DbPool } from "../db/types.ts";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface NonceRegistry {
  /** True iff this nonce has been recorded and has not yet expired. */
  has(nonce: string): boolean;
  /**
   * Record a nonce as used, with the ISO-8601 timestamp after which it may be
   * evicted (the token's own `expiresAt`). Idempotent: re-adding the same
   * nonce is a no-op.
   */
  add(nonce: string, expiresAt: string): void;
}

// ─── Shared validation helpers ──────────────────────────────────────────────

function guardNonce(nonce: string, fn: string): void {
  if (typeof nonce !== "string" || nonce.length === 0) {
    throw new Error(`${fn}: nonce must be a non-empty string`);
  }
}

function guardExpiresAt(expiresAt: string, fn: string): number {
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) {
    throw new Error(`${fn}: expiresAt must be a valid ISO-8601 timestamp`);
  }
  return ms;
}

// ─── InMemoryNonceRegistry ───────────────────────────────────────────────────

/**
 * Default, in-memory NonceRegistry. Same effective behaviour as the previous
 * bare `Set<string>`, but entries are pruned once their token's `expiresAt`
 * has passed — so the registry does not grow without bound under sustained
 * traffic.
 */
export class InMemoryNonceRegistry implements NonceRegistry {
  private readonly entries = new Map<string, number>(); // nonce → expiresAt (ms since epoch)

  has(nonce: string): boolean {
    guardNonce(nonce, "InMemoryNonceRegistry.has");
    this.pruneExpired();
    return this.entries.has(nonce);
  }

  add(nonce: string, expiresAt: string): void {
    guardNonce(nonce, "InMemoryNonceRegistry.add");
    const expiresAtMs = guardExpiresAt(expiresAt, "InMemoryNonceRegistry.add");
    if (this.entries.has(nonce)) return; // idempotent
    this.entries.set(nonce, expiresAtMs);
  }

  /** Remove all entries whose TTL has passed. Called lazily by `has()`. */
  private pruneExpired(now: number = Date.now()): void {
    for (const [nonce, expiresAtMs] of this.entries) {
      if (expiresAtMs <= now) this.entries.delete(nonce);
    }
  }

  /** Current number of tracked (non-pruned-on-demand) entries — for tests/observability. */
  size(): number {
    return this.entries.size;
  }
}

// ─── PgNonceRegistry ──────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS mcp_nonce_registry (
    nonce      TEXT,
    expires_at TEXT
  )
`;

type NonceRow = { nonce: string; expires_at: string };

/**
 * Durable, Postgres-backed NonceRegistry. Preloads all non-expired nonces on
 * `init()` (must be awaited before serving traffic) and write-throughs new
 * entries asynchronously (fire-and-forget, idempotent).
 *
 * Replay protection SURVIVES RESTART: a nonce recorded by one instance is seen
 * by a fresh instance constructed over the same pool, as long as its TTL has
 * not yet passed.
 *
 * InMemoryPool limitations honoured: no RETURNING, no ON CONFLICT, no `<`
 * comparison on TEXT columns — expiry filtering is done in JS after SELECT.
 */
export class PgNonceRegistry implements NonceRegistry {
  private readonly pool: DbPool;
  /** In-memory mirror of non-expired nonces, serving synchronous has(). */
  private readonly entries = new Map<string, number>(); // nonce → expiresAt (ms since epoch)
  /** Count of async write-through failures (observability). */
  private writeErrors = 0;

  constructor(pool: DbPool) {
    if (!pool) throw new Error("PgNonceRegistry: pool is required");
    this.pool = pool;
  }

  /**
   * Initialise: create the table if absent, then preload non-expired nonces
   * into the in-memory mirror. Must be awaited before the server accepts
   * traffic. Idempotent — safe to call more than once (re-preloads from pg).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
    const result = await this.pool.query<NonceRow>(
      "SELECT nonce, expires_at FROM mcp_nonce_registry",
      [],
    );
    const now = Date.now();
    this.entries.clear();
    for (const row of result.rows) {
      if (!row || typeof row.nonce !== "string" || row.nonce.length === 0) continue;
      if (typeof row.expires_at !== "string") continue;
      const expiresAtMs = Date.parse(row.expires_at);
      if (Number.isNaN(expiresAtMs)) continue;
      if (expiresAtMs > now) {
        this.entries.set(row.nonce, expiresAtMs);
      }
    }
  }

  // ─── NonceRegistry (synchronous interface) ───────────────────────────────

  has(nonce: string): boolean {
    guardNonce(nonce, "PgNonceRegistry.has");
    this.pruneExpired();
    return this.entries.has(nonce);
  }

  /**
   * Record a nonce as used. Synchronous to the mirror; durable via an async
   * write-through INSERT. Idempotent: re-adding the same nonce is a no-op
   * (no duplicate INSERT).
   */
  add(nonce: string, expiresAt: string): void {
    guardNonce(nonce, "PgNonceRegistry.add");
    const expiresAtMs = guardExpiresAt(expiresAt, "PgNonceRegistry.add");
    if (this.entries.has(nonce)) return; // already recorded — no duplicate persist

    // ── Sync: mirror ──
    this.entries.set(nonce, expiresAtMs);

    // ── Async: write-through to pg (fire-and-forget) ──
    this.pool.query(
      "INSERT INTO mcp_nonce_registry (nonce, expires_at) VALUES ($1, $2)",
      [nonce, expiresAt],
    ).catch((err: unknown) => {
      this.writeErrors++;
      console.error(`[PgNonceRegistry] write-through INSERT failed for nonce ${nonce}:`, err);
    });
  }

  /** Remove all in-memory entries whose TTL has passed. Called lazily by `has()`. */
  private pruneExpired(now: number = Date.now()): void {
    for (const [nonce, expiresAtMs] of this.entries) {
      if (expiresAtMs <= now) this.entries.delete(nonce);
    }
  }

  /** Number of async write-through failures since startup (observability). */
  getWriteErrorCount(): number {
    return this.writeErrors;
  }
}
