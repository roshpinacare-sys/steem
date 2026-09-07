'use strict';
/**
 * postgresAuditBloomAdapter271 — PostgreSQL persistence adapter for AuditBloom V267/V268.
 * Additive V271 implementation. Zero new npm dependencies.
 * 
 * Usage:
 *   const { createPostgresAuditBloomAdapter271 } = require('./src/lib/postgresAuditBloomAdapter271');
 *   const adapter = createPostgresAuditBloomAdapter271(pool);
 *   await auditBloom268.setPersistenceAdapter(adapter);
 */
function createPostgresAuditBloomAdapter271(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createPostgresAuditBloomAdapter271 requires a PostgreSQL pool-like object');
  }
  return {
    async saveState(state = {}) {
      const rawBits = state.bits || state.filter_bits || state.filterBits || [];
      const bits = Buffer.isBuffer(rawBits) ? rawBits : Buffer.from(rawBits);
      const count = Number.isFinite(Number(state.count)) ? Number(state.count) : 0;
      await pool.query(
        `INSERT INTO audit_bloom_state (id, filter_bits, count, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE
           SET filter_bits = EXCLUDED.filter_bits,
               count       = EXCLUDED.count,
               updated_at  = now()`,
        [bits, count]
      );
      return { ok: true, count };
    },
    async loadState() {
      const result = await pool.query(
        'SELECT filter_bits, count FROM audit_bloom_state WHERE id = 1'
      );
      if (!result.rows || result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        bits:  new Uint8Array(row.filter_bits || []),
        count: Number(row.count || 0),
      };
    },
  };
}

module.exports = { createPostgresAuditBloomAdapter271 };
