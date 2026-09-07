/**
 * nonceTracker.js — ECOS V124
 * =============================
 * Monotonic nonce counter for replay-attack protection on critical transactions.
 *
 * Design:
 *  - One global sequence per (scope, accountId) pair.
 *  - In-memory with DB persistence on every increment.
 *  - DB table: nonce_counters (scope TEXT, account_id TEXT, nonce BIGINT, updated_at TIMESTAMPTZ)
 *  - On startup: load current values from DB (async, non-blocking).
 *  - Enforcement: client MUST provide expectedNonce; server rejects if
 *    provided nonce ≤ current nonce (strict monotonic).
 *
 * Usage:
 *   const nt = getNonceTracker();
 *   // On resolve/approval:
 *   const { nonce, valid, reason } = await nt.consume('approval', approvalId, clientNonce);
 *   if (!valid) return json(res, 409, { error: reason });
 *
 * [V124-P15-03] Initial implementation
 */

'use strict';

const crypto = require('node:crypto');

class NonceTracker {
  constructor(opts = {}) {
    this._counters = new Map(); // `${scope}:${accountId}` → BigInt
    this._pool = opts.pool || null; // optional postgres pool
    this._loaded = false;
  }

  /**
   * Attach a DB pool after construction (called from server init).
   */
  setPool(pool) {
    this._pool = pool;
  }

  /**
   * Load all nonce counters from DB (non-blocking, called once at startup).
   */
  async loadFromDB() {
    if (!this._pool) return;
    try {
      const result = await this._pool.query(
        'SELECT scope, account_id, nonce FROM nonce_counters'
      );
      for (const row of result.rows) {
        const key = `${row.scope}:${row.account_id}`;
        this._counters.set(key, BigInt(row.nonce));
      }
      this._loaded = true;
    } catch (err) {
      // Non-fatal: nonce_counters table may not exist yet (pre-migration)
      console.warn('[NonceTracker] loadFromDB failed (non-fatal):', err.message);
    }
  }

  /**
   * Return the current nonce for a (scope, accountId) pair (0 if never used).
   */
  current(scope, accountId) {
    const key = `${scope}:${accountId}`;
    return this._counters.get(key) || 0n;
  }

  /**
   * Consume a client-supplied nonce for strict monotonic ordering.
   *
   * Rules:
   *   - If clientNonce is undefined/null → auto-issue next nonce (lenient mode for
   *     backwards compat; records it but doesn't enforce yet).
   *   - If clientNonce <= current → reject (replay or out-of-order).
   *   - If clientNonce == current+1 → accept (strict sequential).
   *   - If clientNonce > current+1 → accept with gap warning (allows skip for
   *     idempotency; gap is recorded in meta).
   *
   * @param {string} scope     — e.g. 'approval', 'ledger', 'deposit'
   * @param {string} accountId — the entity being tracked
   * @param {number|bigint|null} clientNonce — the nonce claimed by the client
   * @returns {{ valid: boolean, nonce: number, gap?: number, reason?: string }}
   */
  async consume(scope, accountId, clientNonce) {
    const key     = `${scope}:${accountId}`;
    const current = this._counters.get(key) || 0n;
    const next    = current + 1n;

    let issued;
    let gap = 0;

    if (clientNonce === undefined || clientNonce === null) {
      // Lenient: auto-issue, no enforcement
      issued = next;
    } else {
      const cn = BigInt(clientNonce);
      if (cn <= current) {
        return {
          valid:  false,
          nonce:  Number(current),
          reason: `Nonce replay detected: provided ${cn} ≤ current ${current}. Use nonce > ${current}.`,
        };
      }
      issued = cn;
      gap    = Number(issued - next);
    }

    this._counters.set(key, issued);

    // Persist to DB (non-blocking, non-fatal)
    this._persistToDB(scope, accountId, issued).catch(() => {});

    return { valid: true, nonce: Number(issued), gap };
  }

  /**
   * Persist updated nonce to DB using UPSERT.
   */
  async _persistToDB(scope, accountId, nonce) {
    if (!this._pool) return;
    await this._pool.query(
      `INSERT INTO nonce_counters (scope, account_id, nonce, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (scope, account_id)
       DO UPDATE SET nonce = EXCLUDED.nonce, updated_at = NOW()
       WHERE nonce_counters.nonce < EXCLUDED.nonce`,
      [scope, accountId, nonce.toString()]
    );
  }

  /**
   * Stats snapshot (for health/debug endpoints).
   */
  stats() {
    return {
      trackedPairs: this._counters.size,
      dbLoaded:     this._loaded,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;

function getNonceTracker() {
  if (!_instance) _instance = new NonceTracker();
  return _instance;
}

module.exports = { NonceTracker, getNonceTracker };
