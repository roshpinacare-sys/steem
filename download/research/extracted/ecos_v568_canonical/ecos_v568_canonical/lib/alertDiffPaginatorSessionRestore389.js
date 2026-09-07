'use strict';
/**
 * lib/alertDiffPaginatorSessionRestore389.js — ECOS V389 (Phase P277)
 *
 * DIRECTION 2: Alert diff session restore.
 *
 * restoreAlertDiffPaginatorSession389(session, snapshot, opts) is the restore
 * counterpart of snapshotAlertDiffPaginatorSession388; re-hydrates named
 * cursors from a V388 alert-diff session snapshot into a live
 * createAlertDiffPaginatorSession387 instance via registry.set, mirroring
 * restoreChainDiffPaginatorSession387 for the alert-diff surface.
 *
 * Exports:
 *   ALERT_DIFF_SESSION_RESTORE_VERSION_389
 *   ALERT_DIFF_SESSION_RESTORE_SCHEMA_389
 *   restoreAlertDiffPaginatorSession389(session, snapshot, opts)
 *     — returns { ok, schema, version, restoredAt, totalSessions,
 *         restored, skipped, failed, sessions }
 *
 * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/restore [V389-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 389 (R2).
 * Sacred untouched (R1). V361..V388 preserved (R6).
 *
 * @version 389.0.0
 */

const ADS388 = require('./alertDiffPaginatorSessionSnapshot388.js');

const ALERT_DIFF_SESSION_RESTORE_VERSION_389 = '389.0.0';
const ALERT_DIFF_SESSION_RESTORE_SCHEMA_389  =
  'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history.diff.paginator.session.restore/v389';

/**
 * Re-hydrate all named cursors from a V388 alert-diff session snapshot into a
 * live createAlertDiffPaginatorSession387 instance.
 *
 * @param {{
 *   registry: {
 *     set: function(name: string, cursor: string, meta?: object): object,
 *   },
 *   listSessions: function(): Array<object>,
 *   getSessionCursor: function(name: string): object,
 * }} session  — a createAlertDiffPaginatorSession387() instance
 * @param {{
 *   ok: boolean,
 *   sessions: Array<{
 *     name: string,
 *     cursor: string|null,
 *     startIndex: number|null,
 *     setAt: string|null,
 *   }>,
 * }} snapshot  — a snapshotAlertDiffPaginatorSession388() result
 * @param {{
 *   overwrite?: boolean,  — if false (default), skip sessions already present in the live registry
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   restoredAt: string,
 *   totalSessions: number,
 *   restored: number,
 *   skipped: number,
 *   failed: number,
 *   sessions: Array<{ name: string, status: 'restored'|'skipped'|'failed', reason?: string }>,
 * }}
 */
function restoreAlertDiffPaginatorSession389(session, snapshot, opts) {
  const o = opts || {};
  const overwrite = o.overwrite === true;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        ALERT_DIFF_SESSION_RESTORE_SCHEMA_389,
    version:       ALERT_DIFF_SESSION_RESTORE_VERSION_389,
    restoredAt:    new Date().toISOString(),
    totalSessions: 0,
    restored: 0, skipped: 0, failed: 0,
    sessions: [],
  });

  if (!session || typeof session.registry !== 'object' || !session.registry) {
    return errorResult('session must be a createAlertDiffPaginatorSession387() instance with a registry');
  }
  if (typeof session.registry.set !== 'function') {
    return errorResult('session.registry.set must be a function');
  }
  if (typeof session.listSessions !== 'function') {
    return errorResult('session must expose listSessions()');
  }
  if (!snapshot || !snapshot.ok) {
    return errorResult('snapshot must be a valid snapshotAlertDiffPaginatorSession388() result');
  }
  if (!Array.isArray(snapshot.sessions)) {
    return errorResult('snapshot.sessions must be an array');
  }

  // Build set of names already live in the session for overwrite guard
  let liveNames = new Set();
  if (!overwrite) {
    try {
      const live = session.listSessions();
      for (const entry of live) {
        if (entry && entry.name) liveNames.add(entry.name);
      }
    } catch (_) {}
  }

  const restoredAt = new Date().toISOString();
  const sessions   = [];
  let   restored   = 0;
  let   skipped    = 0;
  let   failed     = 0;

  for (const entry of snapshot.sessions) {
    if (!entry || !entry.name) {
      failed++;
      sessions.push({ name: entry ? entry.name || '(unnamed)' : '(null)', status: 'failed', reason: 'missing name' });
      continue;
    }

    // Skip if already present and overwrite is false
    if (!overwrite && liveNames.has(entry.name)) {
      skipped++;
      sessions.push({ name: entry.name, status: 'skipped', reason: 'already present in live session' });
      continue;
    }

    // A null cursor means the session existed but had no cursor yet — skip it
    if (!entry.cursor) {
      skipped++;
      sessions.push({ name: entry.name, status: 'skipped', reason: 'no cursor in snapshot entry' });
      continue;
    }

    try {
      const setResult = session.registry.set(entry.name, entry.cursor, {
        restoredFrom: ADS388.ALERT_DIFF_SESSION_SNAPSHOT_SCHEMA_388,
        setAt:        entry.setAt      || null,
        startIndex:   entry.startIndex != null ? entry.startIndex : null,
      });

      if (setResult && setResult.ok === false) {
        failed++;
        sessions.push({ name: entry.name, status: 'failed', reason: setResult.error || 'registry.set returned ok=false' });
      } else {
        restored++;
        liveNames.add(entry.name);
        sessions.push({ name: entry.name, status: 'restored' });
      }
    } catch (e) {
      failed++;
      sessions.push({ name: entry.name, status: 'failed', reason: e.message });
    }
  }

  return {
    ok:            true,
    schema:        ALERT_DIFF_SESSION_RESTORE_SCHEMA_389,
    version:       ALERT_DIFF_SESSION_RESTORE_VERSION_389,
    restoredAt,
    totalSessions: snapshot.sessions.length,
    restored,
    skipped,
    failed,
    sessions,
  };
}

module.exports = {
  ALERT_DIFF_SESSION_RESTORE_VERSION_389,
  ALERT_DIFF_SESSION_RESTORE_SCHEMA_389,
  restoreAlertDiffPaginatorSession389,
};
