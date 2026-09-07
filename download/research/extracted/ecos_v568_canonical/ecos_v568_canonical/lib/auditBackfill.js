/**
 * auditBackfill.js — ECOS V125
 * ==============================
 * Backfills pre-V123 audit_log entries into the MMR singleton.
 *
 * Design:
 *  - Queries `audit_log` table for entries not yet in `audit_backfill_log`.
 *  - For each entry, computes SHA-256 of `(entry.id || entry.type || entry.ts)`.
 *  - Appends hash to the MMR.
 *  - Records in `audit_backfill_log` to prevent re-processing.
 *  - Runs in configurable batch sizes to avoid memory pressure.
 *
 * Usage:
 *   const backfill = getAuditBackfill();
 *   backfill.setDeps({ pool, mmr });
 *   const result = await backfill.run({ batchSize: 100 });
 *   // → { processed: 342, skipped: 0, errors: 0 }
 *
 * [V125-P16-04] Initial implementation
 */

'use strict';

const crypto = require('node:crypto');

class AuditBackfill {
  constructor() {
    this._pool = null;
    this._mmr  = null;
    this._running = false;
  }

  setDeps({ pool, mmr }) {
    this._pool = pool;
    this._mmr  = mmr;
  }

  /**
   * Run a backfill pass.
   *
   * @param {object} opts
   * @param {number} [opts.batchSize=100]  — rows per DB query
   * @param {number} [opts.maxBatches=10]  — safety cap (stop after N batches)
   * @returns {{ processed: number, skipped: number, errors: number, done: boolean }}
   */
  async run(opts = {}) {
    if (!this._pool || !this._mmr) {
      return { processed: 0, skipped: 0, errors: 0, done: false,
               reason: 'pool or mmr not set' };
    }
    if (this._running) {
      return { processed: 0, skipped: 0, errors: 0, done: false,
               reason: 'already running' };
    }

    this._running = true;
    const batchSize  = opts.batchSize  || 100;
    const maxBatches = opts.maxBatches || 10;

    let processed = 0;
    let skipped   = 0;
    let errors    = 0;

    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        // Fetch entries not yet backfilled
        let rows;
        try {
          const result = await this._pool.query(
            `SELECT al.id, al.type, al.ts, al.payload
             FROM audit_log al
             LEFT JOIN audit_backfill_log bl ON bl.audit_entry_id = al.id::text
             WHERE bl.audit_entry_id IS NULL
             ORDER BY al.id ASC
             LIMIT $1`,
            [batchSize]
          );
          rows = result.rows;
        } catch (dbErr) {
          // audit_log table may not exist in test env
          errors++;
          break;
        }

        if (!rows || rows.length === 0) break; // done

        for (const row of rows) {
          try {
            const canonical = JSON.stringify({
              id:   String(row.id),
              type: row.type  || '',
              ts:   row.ts    || '',
            });
            const hash = crypto.createHash('sha256').update(canonical).digest('hex');

            // Append to MMR
            let leafIndex = -1;
            if (typeof this._mmr.append === 'function') {
              leafIndex = this._mmr.append(hash);
            }

            // Record in backfill log
            await this._pool.query(
              `INSERT INTO audit_backfill_log (audit_entry_id, leaf_index, entry_hash)
               VALUES ($1, $2, $3)
               ON CONFLICT (audit_entry_id) DO NOTHING`,
              [String(row.id), leafIndex, hash]
            );
            processed++;
          } catch (rowErr) {
            errors++;
          }
        }
      }
    } finally {
      this._running = false;
    }

    return { processed, skipped, errors, done: true };
  }

  stats() {
    return { running: this._running };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getAuditBackfill() {
  if (!_instance) _instance = new AuditBackfill();
  return _instance;
}

module.exports = { AuditBackfill, getAuditBackfill };
