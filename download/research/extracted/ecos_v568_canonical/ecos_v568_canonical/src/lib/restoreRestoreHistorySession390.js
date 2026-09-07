'use strict';
/**
 * lib/restoreRestoreHistorySession390.js — ECOS V390 (Phase P278)
 *
 * DIRECTION 4: Restore history session restore.
 *
 * restoreRestoreHistorySession390(session, snapshot, opts) is the restore
 * counterpart of snapshotRestoreHistorySession389; re-hydrates named cursors
 * from a V389 restore-history-session snapshot into a live
 * createRestoreHistorySession388 instance via registry.set, mirroring
 * restoreAlertDiffPaginatorSession389 for the restore-history-session surface.
 *
 * Exports:
 *   RESTORE_RESTORE_HISTORY_SESSION_VERSION_390
 *   RESTORE_RESTORE_HISTORY_SESSION_SCHEMA_390
 *   restoreRestoreHistorySession390(session, snapshot, opts)
 *     — returns { ok, schema, version, restoredAt, totalSessions,
 *         restored, skipped, failed, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/session/restore [V390-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 390 (R2).
 * Sacred untouched (R1). V361..V389 preserved (R6).
 *
 * @version 390.0.0
 */

const RHSS389 = require('./restoreHistorySessionSnapshot389.js');

const RESTORE_RESTORE_HISTORY_SESSION_VERSION_390 = '390.0.0';
const RESTORE_RESTORE_HISTORY_SESSION_SCHEMA_390  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.restore.history.session.restore/v390';

/**
 * Re-hydrate all named cursors from a V389 restore-history-session snapshot
 * into a live createRestoreHistorySession388 instance.
 *
 * @param {{
 *   registry: {
 *     set: function(name: string, cursor: string, meta?: object): object,
 *   },
 *   listSessions: function(): Array<object>,
 *   getSessionCursor: function(name: string): object,
 * }} session  — a createRestoreHistorySession388() instance
 * @param {{
 *   ok: boolean,
 *   sessions: Array<{
 *     name: string,
 *     cursor: string|null,
 *     offset: number|null,
 *     setAt: string|null,
 *   }>,
 * }} snapshot  — a snapshotRestoreHistorySession389() result
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
function restoreRestoreHistorySession390(session, snapshot, opts) {
  const o = opts || {};
  const overwrite = o.overwrite === true;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        RESTORE_RESTORE_HISTORY_SESSION_SCHEMA_390,
    version:       RESTORE_RESTORE_HISTORY_SESSION_VERSION_390,
    restoredAt:    new Date().toISOString(),
    totalSessions: 0,
    restored: 0, skipped: 0, failed: 0,
    sessions: [],
  });

  if (!session || typeof session.registry !== 'object' || !session.registry) {
    return errorResult('session must be a createRestoreHistorySession388() instance with a registry');
  }
  if (typeof session.registry.set !== 'function') {
    return errorResult('session.registry.set must be a function');
  }
  if (typeof session.listSessions !== 'function') {
    return errorResult('session must expose listSessions()');
  }
  if (!snapshot || !snapshot.ok) {
    return errorResult('snapshot must be a valid snapshotRestoreHistorySession389() result');
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
      sessions.push({
        name:   entry ? entry.name || '(unnamed)' : '(null)',
        status: 'failed',
        reason: 'missing name',
      });
      continue;
    }

    // Skip if already present and overwrite is false
    if (!overwrite && liveNames.has(entry.name)) {
      skipped++;
      sessions.push({
        name:   entry.name,
        status: 'skipped',
        reason: 'already present in live session',
      });
      continue;
    }

    // A null cursor means the session existed but had no cursor yet — skip it
    if (!entry.cursor) {
      skipped++;
      sessions.push({
        name:   entry.name,
        status: 'skipped',
        reason: 'no cursor in snapshot entry',
      });
      continue;
    }

    try {
      const setResult = session.registry.set(entry.name, entry.cursor, {
        restoredFrom: RHSS389.RESTORE_HISTORY_SESSION_SNAPSHOT_SCHEMA_389,
        setAt:        entry.setAt   || null,
        offset:       entry.offset  != null ? entry.offset : null,
      });

      if (setResult && setResult.ok === false) {
        failed++;
        sessions.push({
          name:   entry.name,
          status: 'failed',
          reason: setResult.error || 'registry.set returned ok=false',
        });
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
    schema:        RESTORE_RESTORE_HISTORY_SESSION_SCHEMA_390,
    version:       RESTORE_RESTORE_HISTORY_SESSION_VERSION_390,
    restoredAt,
    totalSessions: snapshot.sessions.length,
    restored,
    skipped,
    failed,
    sessions,
  };
}

module.exports = {
  RESTORE_RESTORE_HISTORY_SESSION_VERSION_390,
  RESTORE_RESTORE_HISTORY_SESSION_SCHEMA_390,
  restoreRestoreHistorySession390,
};
