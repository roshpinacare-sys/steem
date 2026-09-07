'use strict';
/**
 * lib/restoreHistoryProjection387.js — ECOS V387 (Phase P275)
 *
 * DIRECTION 1: Restore history projection.
 *
 * getRestoreHistory387(ctx, opts) mirrors getTtlSweepHistory386 for
 * restore_event_type_386 events — it projects all restore audit events from the
 * log with limit/offset pagination and sinceTs filter, and computes summary
 * fields: totalRestores, totalRestored, totalSkipped, totalFailed,
 * firstRestoreAt, lastRestoreAt, avgRestoredPerEvent.
 *
 * Exports:
 *   RESTORE_HISTORY_PROJECTION_VERSION_387
 *   RESTORE_HISTORY_PROJECTION_SCHEMA_387
 *   getRestoreHistory387(ctx, opts)
 *     — returns { ok, schema, version, totalRestores, restores, summary }
 *
 * Endpoint: GET /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history [V387-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 387 (R2).
 * Sacred untouched (R1). V361..V386 preserved (R6).
 *
 * @version 387.0.0
 */

const RHT386 = require('./restoreHistoryTracker386.js');

const RESTORE_HISTORY_PROJECTION_VERSION_387 = '387.0.0';
const RESTORE_HISTORY_PROJECTION_SCHEMA_387  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.restore.history.projection/v387';

/**
 * Project all restore_event_type_386 events from the audit log.
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
 *   totalRestores: number,
 *   restores: Array<{
 *     index: number,
 *     restoredAt: string,
 *     totalSessions: number,
 *     restored: number,
 *     skipped: number,
 *     failed: number,
 *     recordedAt: string|null,
 *     hash: string|null,
 *   }>,
 *   summary: {
 *     totalRestores: number,
 *     totalRestored: number,
 *     totalSkipped: number,
 *     totalFailed: number,
 *     firstRestoreAt: string|null,
 *     lastRestoreAt: string|null,
 *     avgRestoredPerEvent: number,
 *   },
 * }}
 */
function getRestoreHistory387(ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        RESTORE_HISTORY_PROJECTION_SCHEMA_387,
    version:       RESTORE_HISTORY_PROJECTION_VERSION_387,
    totalRestores: 0,
    restores:      [],
    summary: {
      totalRestores: 0, totalRestored: 0, totalSkipped: 0, totalFailed: 0,
      firstRestoreAt: null, lastRestoreAt: null, avgRestoredPerEvent: 0,
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

  // Filter to restore events
  const RESTORE_TYPE = RHT386.RESTORE_EVENT_TYPE_386;
  let restoreEntries = allEntries.filter(e =>
    e && (e.type === RESTORE_TYPE || (e.payload && e.payload.type === RESTORE_TYPE))
  );

  // Normalise: unwrap payload if needed
  restoreEntries = restoreEntries.map(e => {
    if (e.payload && e.payload.type === RESTORE_TYPE) return e.payload;
    if (e.type === RESTORE_TYPE) return e;
    return e;
  });

  // Apply sinceTs filter
  if (o.sinceTs) {
    const since = new Date(o.sinceTs).getTime();
    if (!isNaN(since)) {
      restoreEntries = restoreEntries.filter(e => {
        const ts = e.restoredAt ? new Date(e.restoredAt).getTime() : 0;
        return ts >= since;
      });
    }
  }

  // Apply pagination
  const offset = (typeof o.offset === 'number' && o.offset >= 0) ? Math.floor(o.offset) : 0;
  const limit  = (typeof o.limit  === 'number' && o.limit  >  0) ? Math.floor(o.limit)  : restoreEntries.length;

  const totalRestores = restoreEntries.length;
  const page          = restoreEntries.slice(offset, offset + limit);

  // Build output
  const restores = page.map((e, i) => ({
    index:         offset + i + 1,
    restoredAt:    e.restoredAt   || null,
    totalSessions: typeof e.totalSessions === 'number' ? e.totalSessions : 0,
    restored:      typeof e.restored      === 'number' ? e.restored      : 0,
    skipped:       typeof e.skipped       === 'number' ? e.skipped       : 0,
    failed:        typeof e.failed        === 'number' ? e.failed        : 0,
    recordedAt:    e.recordedAt   || null,
    hash:          e.hash         || null,
  }));

  // Summary across full (un-paginated) set
  const totalRestored  = restoreEntries.reduce((s, e) => s + (typeof e.restored === 'number' ? e.restored : 0), 0);
  const totalSkipped   = restoreEntries.reduce((s, e) => s + (typeof e.skipped  === 'number' ? e.skipped  : 0), 0);
  const totalFailed    = restoreEntries.reduce((s, e) => s + (typeof e.failed   === 'number' ? e.failed   : 0), 0);
  const timestamps     = restoreEntries.map(e => e.restoredAt).filter(Boolean).sort();
  const firstRestoreAt = timestamps[0] || null;
  const lastRestoreAt  = timestamps[timestamps.length - 1] || null;
  const avgRestoredPerEvent = totalRestores > 0 ? totalRestored / totalRestores : 0;

  return {
    ok:            true,
    schema:        RESTORE_HISTORY_PROJECTION_SCHEMA_387,
    version:       RESTORE_HISTORY_PROJECTION_VERSION_387,
    totalRestores,
    restores,
    summary: {
      totalRestores,
      totalRestored,
      totalSkipped,
      totalFailed,
      firstRestoreAt,
      lastRestoreAt,
      avgRestoredPerEvent,
    },
  };
}

module.exports = {
  RESTORE_HISTORY_PROJECTION_VERSION_387,
  RESTORE_HISTORY_PROJECTION_SCHEMA_387,
  getRestoreHistory387,
};
