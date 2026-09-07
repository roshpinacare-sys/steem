/**
 * ECOS Audit Log
 * --------------
 * A tamper-evident, append-only log of B2B-relevant events. Each entry
 * carries a SHA-256 hash over (index || timestamp || JSON(payload) || prevHash),
 * so any retroactive mutation breaks the chain on verification.
 *
 * This is NOT a blockchain. There is no consensus, no proof-of-work, no token.
 * It is simply a cryptographic chain-of-custody so B2B clients can audit:
 *   - what the AI did
 *   - what the human validator decided
 *   - what the ledger settled
 *
 * The genesis entry uses a deterministic null-hash (64 zeros) as `prevHash`.
 *
 * V18 Updates:
 *   - Added `constructor(opts)` supporting `opts.pool`.
 *   - When `pool` is available, `append()` asynchronously persists to the `audit_log`
 *     table in DB using `db/auditRepo.js` logic to maintain SHA-256 chain,
 *     while maintaining backward compatibility with in-memory chain.
 */

'use strict';

const crypto = require('node:crypto');

const NULL_HASH = '0'.repeat(64);

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Canonical JSON serialization with sorted keys. Required so the same logical
 * payload always produces the same hash, regardless of key insertion order.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k]));
  return '{' + parts.join(',') + '}';
}

class AuditLog {
  constructor(opts = {}) {
    /** @type {Array<{
     *   index:number, ts:string, type:string,
     *   payload:object, prevHash:string, hash:string
     * }>} */
    this._entries = [];
    this.pool = opts.pool || null;
  }

  /**
   * Append a new event. Returns the persisted entry (frozen).
   */
  append(type, payload = {}) {
    if (typeof type !== 'string' || !type) {
      throw new TypeError('AuditLog.append: type must be a non-empty string');
    }
    const index    = this._entries.length;
    const ts       = new Date().toISOString();
    const prevHash = index === 0 ? NULL_HASH : this._entries[index - 1].hash;

    // Sanitize payload: stringify BigInts so canonical JSON works.
    const safePayload = JSON.parse(
      JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );

    const preimage = `${index}|${ts}|${canonicalize(safePayload)}|${prevHash}`;
    const hash     = sha256Hex(preimage);

    const entry = Object.freeze({
      index, ts, type, payload: safePayload, prevHash, hash,
    });
    this._entries.push(entry);

    // V18 DB Persistence Fallback (Fire-and-forget to keep append sync and backward-compatible)
    if (this.pool) {
      // Lazy load auditRepo to avoid circular dependency
      try {
        const auditRepo = require('../db/auditRepo');
        auditRepo.appendAudit(type, safePayload).catch(err => {
          console.error('[AuditLog] Async DB persistence failed:', err.message);
        });
      } catch (err) {
        console.error('[AuditLog] Failed to load auditRepo for persistence:', err.message);
      }
    }

    return entry;
  }

  entries() { return this._entries.slice(); }
  size()    { return this._entries.length; }
  head()    { return this._entries[this._entries.length - 1] || null; }

  /**
   * Recompute every hash from scratch and confirm the chain is intact.
   * Returns { ok: true } on success, or { ok: false, brokenAt, reason } on failure.
   */
  verify() {
    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      const expectedPrev = i === 0 ? NULL_HASH : this._entries[i - 1].hash;
      if (e.prevHash !== expectedPrev) {
        return { ok: false, brokenAt: i, reason: 'prevHash mismatch' };
      }
      const preimage = `${e.index}|${e.ts}|${canonicalize(e.payload)}|${e.prevHash}`;
      const recomputed = sha256Hex(preimage);
      if (recomputed !== e.hash) {
        return { ok: false, brokenAt: i, reason: 'hash mismatch' };
      }
    }
    return { ok: true, length: this._entries.length };
  }
}

const defaultAuditLog = new AuditLog();

module.exports = {
  AuditLog,
  defaultAuditLog,
  sha256Hex,
  canonicalize,
  NULL_HASH,
};
