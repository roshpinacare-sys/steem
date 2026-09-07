'use strict';
/**
 * lib/ttlSweepHistoryProjection386.js — ECOS V386 (Phase P274)
 *
 * DIRECTION 3: Sweep history projection.
 *
 * getTtlSweepHistory386(ctx, opts) mirrors getAutoHealRateAlertHistory384 for
 * ttl_sweep_event_type_385 events — it projects all sweep audit events from the
 * log with limit/offset pagination and sinceTs filter, and computes summary
 * fields: totalSweeps, totalEvicted, totalRemaining, firstSweepAt, lastSweepAt,
 * avgEvictedPerSweep.
 *
 * Exports:
 *   TTL_SWEEP_HISTORY_PROJECTION_VERSION_386
 *   TTL_SWEEP_HISTORY_PROJECTION_SCHEMA_386
 *   getTtlSweepHistory386(ctx, opts)
 *     — returns { ok, schema, version, totalSweeps, sweeps, summary }
 *
 * Endpoint: GET /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history [V386-T03]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 386 (R2).
 * Sacred untouched (R1). V361..V385 preserved (R6).
 *
 * @version 386.0.0
 */

const TSH385 = require('./ttlSweepHistoryTracker385.js');

const TTL_SWEEP_HISTORY_PROJECTION_VERSION_386 = '386.0.0';
const TTL_SWEEP_HISTORY_PROJECTION_SCHEMA_386  =
  'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep.history.projection/v386';

/**
 * Project all ttl_sweep_event_type_385 events from the audit log.
 *
 * @param {{
 *   auditLog: object,
 * }} ctx
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   sinceTs?: string,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalSweeps: number,
 *   sweeps: Array<{
 *     index: number,
 *     sweptAt: string,
 *     evicted: number,
 *     remaining: number,
 *     recordedAt: string|null,
 *     hash: string|null,
 *   }>,
 *   summary: {
 *     totalSweeps: number,
 *     totalEvicted: number,
 *     totalRemaining: number,
 *     firstSweepAt: string|null,
 *     lastSweepAt: string|null,
 *     avgEvictedPerSweep: number,
 *   },
 * }}
 */
function getTtlSweepHistory386(ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:      TTL_SWEEP_HISTORY_PROJECTION_SCHEMA_386,
    version:     TTL_SWEEP_HISTORY_PROJECTION_VERSION_386,
    totalSweeps: 0,
    sweeps:      [],
    summary: {
      totalSweeps: 0, totalEvicted: 0, totalRemaining: 0,
      firstSweepAt: null, lastSweepAt: null, avgEvictedPerSweep: 0,
    },
  });

  if (!ctx || !ctx.auditLog) {
    return errorResult('ctx.auditLog is required');
  }

  // Extract all audit entries
  let allEntries = [];
  try {
    if (typeof ctx.auditLog.entries === 'function') {
      allEntries = ctx.auditLog.entries();
    } else if (typeof ctx.auditLog.getAll === 'function') {
      allEntries = ctx.auditLog.getAll();
    } else if (Array.isArray(ctx.auditLog._log)) {
      allEntries = ctx.auditLog._log;
    } else {
      return errorResult('auditLog must expose entries(), getAll(), or _log array');
    }
  } catch (e) {
    return errorResult('failed to read audit log: ' + e.message);
  }

  // Filter to sweep events
  const SWEEP_TYPE = TSH385.TTL_SWEEP_EVENT_TYPE_385;
  let sweepEntries = allEntries.filter(e =>
    e && (e.type === SWEEP_TYPE || (e.payload && e.payload.type === SWEEP_TYPE))
  );

  // Normalise: unwrap payload if needed
  sweepEntries = sweepEntries.map(e => {
    if (e.payload && e.payload.type === SWEEP_TYPE) return e.payload;
    if (e.type === SWEEP_TYPE) return e;
    return e;
  });

  // Apply sinceTs filter
  if (o.sinceTs) {
    const since = new Date(o.sinceTs).getTime();
    if (!isNaN(since)) {
      sweepEntries = sweepEntries.filter(e => {
        const ts = e.sweptAt ? new Date(e.sweptAt).getTime() : 0;
        return ts >= since;
      });
    }
  }

  // Apply pagination
  const offset = (typeof o.offset === 'number' && o.offset >= 0) ? Math.floor(o.offset) : 0;
  const limit  = (typeof o.limit  === 'number' && o.limit  >  0) ? Math.floor(o.limit)  : sweepEntries.length;

  const totalSweeps = sweepEntries.length;
  const page        = sweepEntries.slice(offset, offset + limit);

  // Build output
  const sweeps = page.map((e, i) => ({
    index:      offset + i + 1,
    sweptAt:    e.sweptAt    || null,
    evicted:    typeof e.evicted   === 'number' ? e.evicted   : 0,
    remaining:  typeof e.remaining === 'number' ? e.remaining : 0,
    recordedAt: e.recordedAt || null,
    hash:       e.hash       || null,
  }));

  // Summary across full (un-paginated) set
  const totalEvicted   = sweepEntries.reduce((s, e) => s + (typeof e.evicted   === 'number' ? e.evicted   : 0), 0);
  const totalRemaining = sweepEntries.reduce((s, e) => s + (typeof e.remaining === 'number' ? e.remaining : 0), 0);
  const timestamps     = sweepEntries.map(e => e.sweptAt).filter(Boolean).sort();
  const firstSweepAt   = timestamps[0] || null;
  const lastSweepAt    = timestamps[timestamps.length - 1] || null;
  const avgEvictedPerSweep = totalSweeps > 0 ? totalEvicted / totalSweeps : 0;

  return {
    ok:          true,
    schema:      TTL_SWEEP_HISTORY_PROJECTION_SCHEMA_386,
    version:     TTL_SWEEP_HISTORY_PROJECTION_VERSION_386,
    totalSweeps,
    sweeps,
    summary: {
      totalSweeps,
      totalEvicted,
      totalRemaining,
      firstSweepAt,
      lastSweepAt,
      avgEvictedPerSweep,
    },
  };
}

module.exports = {
  TTL_SWEEP_HISTORY_PROJECTION_VERSION_386,
  TTL_SWEEP_HISTORY_PROJECTION_SCHEMA_386,
  getTtlSweepHistory386,
};
