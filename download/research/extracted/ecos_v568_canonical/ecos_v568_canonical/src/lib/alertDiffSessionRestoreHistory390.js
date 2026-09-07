'use strict';
/**
 * lib/alertDiffSessionRestoreHistory390.js — ECOS V390 (Phase P278)
 *
 * DIRECTION 3: Alert diff session restore history.
 *
 * getAlertDiffSessionRestoreHistory390(ctx, opts) is a read-side projection of
 * restoreAlertDiffPaginatorSession389 audit events appended to the audit log,
 * with limit/offset pagination and sinceTs filter; summary: totalRestores,
 * totalRestored, totalSkipped, totalFailed, firstRestoreAt, lastRestoreAt.
 * Mirrors getRestoreHistory387 for the alert-diff-session-restore surface.
 *
 * Exports:
 *   ALERT_DIFF_SESSION_RESTORE_HISTORY_VERSION_390
 *   ALERT_DIFF_SESSION_RESTORE_HISTORY_SCHEMA_390
 *   ALERT_DIFF_SESSION_RESTORE_EVENT_TYPE_390
 *   getAlertDiffSessionRestoreHistory390(ctx, opts)
 *     — returns { ok, schema, version, totalRestores, restores, summary }
 *
 * Endpoint: GET /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/restore/history [V390-T03]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 390 (R2).
 * Sacred untouched (R1). V361..V389 preserved (R6).
 *
 * @version 390.0.0
 */

const ALERT_DIFF_SESSION_RESTORE_HISTORY_VERSION_390 = '390.0.0';
const ALERT_DIFF_SESSION_RESTORE_HISTORY_SCHEMA_390  =
  'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history.diff.paginator.session.restore.history/v390';

/**
 * The audit event type appended by restoreAlertDiffPaginatorSession389
 * operations recorded via the server wiring.
 */
const ALERT_DIFF_SESSION_RESTORE_EVENT_TYPE_390 = 'alert_diff_session_restore_event_type_390';

/**
 * Project all alert_diff_session_restore_event_type_390 events from the
 * audit log.
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
 *   },
 * }}
 */
function getAlertDiffSessionRestoreHistory390(ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        ALERT_DIFF_SESSION_RESTORE_HISTORY_SCHEMA_390,
    version:       ALERT_DIFF_SESSION_RESTORE_HISTORY_VERSION_390,
    totalRestores: 0,
    restores:      [],
    summary: {
      totalRestores: 0,
      totalRestored: 0,
      totalSkipped:  0,
      totalFailed:   0,
      firstRestoreAt: null,
      lastRestoreAt:  null,
    },
  });

  if (!ctx || !ctx.auditLog) {
    return errorResult('ctx.auditLog is required');
  }

  // Extract all audit entries
  let allEntries;
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

  const RESTORE_TYPE = ALERT_DIFF_SESSION_RESTORE_EVENT_TYPE_390;

  // Filter to alert-diff-session-restore events
  // AuditLog stores entries as { type, ts, payload: { ... }, hash, ... }
  let matchingEntries = allEntries.filter(e => e && e.type === RESTORE_TYPE);

  // sinceTs filter — check payload.restoredAt or entry.ts
  if (o.sinceTs) {
    const since = new Date(o.sinceTs).getTime();
    if (!isNaN(since)) {
      matchingEntries = matchingEntries.filter(e => {
        const p  = e.payload || e;
        const ts = p.restoredAt || e.ts || null;
        return ts && new Date(ts).getTime() >= since;
      });
    }
  }

  const totalAll = matchingEntries.length;

  // Pagination
  const limit  = (typeof o.limit  === 'number' && o.limit  > 0) ? Math.floor(o.limit)  : 100;
  const offset = (typeof o.offset === 'number' && o.offset >= 0) ? Math.floor(o.offset) : 0;

  const paged = matchingEntries.slice(offset, offset + limit);

  const restores = paged.map((e, i) => {
    const p = e.payload || e;
    return {
      index:         offset + i,
      restoredAt:    p.restoredAt    || e.ts         || null,
      totalSessions: p.totalSessions != null ? p.totalSessions : 0,
      restored:      p.restored      != null ? p.restored      : 0,
      skipped:       p.skipped       != null ? p.skipped       : 0,
      failed:        p.failed        != null ? p.failed        : 0,
      recordedAt:    p.recordedAt    || null,
      hash:          e.hash          || null,
    };
  });

  // Summary across ALL matching (not just page)
  let totalRestored = 0;
  let totalSkipped  = 0;
  let totalFailed   = 0;
  let firstRestoreAt = null;
  let lastRestoreAt  = null;

  for (const e of matchingEntries) {
    const p = e.payload || e;
    totalRestored += (p.restored != null ? p.restored : 0);
    totalSkipped  += (p.skipped  != null ? p.skipped  : 0);
    totalFailed   += (p.failed   != null ? p.failed   : 0);
    const ts = p.restoredAt || e.ts || null;
    if (ts) {
      if (!firstRestoreAt || ts < firstRestoreAt) firstRestoreAt = ts;
      if (!lastRestoreAt  || ts > lastRestoreAt)  lastRestoreAt  = ts;
    }
  }

  return {
    ok:            true,
    schema:        ALERT_DIFF_SESSION_RESTORE_HISTORY_SCHEMA_390,
    version:       ALERT_DIFF_SESSION_RESTORE_HISTORY_VERSION_390,
    totalRestores: totalAll,
    restores,
    summary: {
      totalRestores: totalAll,
      totalRestored,
      totalSkipped,
      totalFailed,
      firstRestoreAt,
      lastRestoreAt,
    },
  };
}

module.exports = {
  ALERT_DIFF_SESSION_RESTORE_HISTORY_VERSION_390,
  ALERT_DIFF_SESSION_RESTORE_HISTORY_SCHEMA_390,
  ALERT_DIFF_SESSION_RESTORE_EVENT_TYPE_390,
  getAlertDiffSessionRestoreHistory390,
};
