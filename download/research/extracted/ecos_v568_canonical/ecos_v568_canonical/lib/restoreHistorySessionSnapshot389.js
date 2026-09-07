'use strict';
/**
 * lib/restoreHistorySessionSnapshot389.js — ECOS V389 (Phase P277)
 *
 * DIRECTION 4: Restore history session snapshot.
 *
 * snapshotRestoreHistorySession389(session, opts) is the snapshot counterpart
 * of createRestoreHistorySession388; reads listSessions() and
 * getSessionCursor() from a V388 restore-history session instance and returns
 * a serialisable JSON snapshot (name, cursor, offset, setAt, decoded?),
 * mirroring snapshotAlertDiffPaginatorSession388 for the
 * restore-history-session surface.
 *
 * Exports:
 *   RESTORE_HISTORY_SESSION_SNAPSHOT_VERSION_389
 *   RESTORE_HISTORY_SESSION_SNAPSHOT_SCHEMA_389
 *   snapshotRestoreHistorySession389(session, opts)
 *     — returns { ok, schema, version, snapshotAt, totalSessions, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/history/session/snapshot [V389-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 389 (R2).
 * Sacred untouched (R1). V361..V388 preserved (R6).
 *
 * @version 389.0.0
 */

const RHS388 = require('./restoreHistorySession388.js');

const RESTORE_HISTORY_SESSION_SNAPSHOT_VERSION_389 = '389.0.0';
const RESTORE_HISTORY_SESSION_SNAPSHOT_SCHEMA_389  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.restore.history.session.snapshot/v389';

/**
 * Take a serialisable snapshot of all active named sessions in a
 * createRestoreHistorySession388 instance.
 *
 * @param {{
 *   listSessions: function(): Array<{ name: string, cursor: string|null, setAt: string|null }>,
 *   getSessionCursor: function(name: string): { ok: boolean, cursor: string|null, offset: number|null, setAt: string|null },
 * }} session  — a createRestoreHistorySession388() instance
 * @param {{
 *   includeDecoded?: boolean,  — whether to include decoded cursor fields (default true)
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   snapshotAt: string,
 *   totalSessions: number,
 *   sessions: Array<{
 *     name: string,
 *     cursor: string|null,
 *     offset: number|null,
 *     setAt: string|null,
 *     decoded?: { offset: number, ts: string|null }|null,
 *   }>,
 * }}
 */
function snapshotRestoreHistorySession389(session, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        RESTORE_HISTORY_SESSION_SNAPSHOT_SCHEMA_389,
    version:       RESTORE_HISTORY_SESSION_SNAPSHOT_VERSION_389,
    snapshotAt:    new Date().toISOString(),
    totalSessions: 0,
    sessions:      [],
  });

  if (!session || typeof session.listSessions !== 'function') {
    return errorResult('session must be a createRestoreHistorySession388() instance with listSessions()');
  }
  if (typeof session.getSessionCursor !== 'function') {
    return errorResult('session must expose getSessionCursor()');
  }

  const includeDecoded = o.includeDecoded !== false;

  let rawSessions;
  try {
    rawSessions = session.listSessions();
  } catch (e) {
    return errorResult('listSessions() failed: ' + e.message);
  }

  const snapshotAt = new Date().toISOString();
  const sessions   = [];

  for (const entry of rawSessions) {
    if (!entry || !entry.name) continue;

    let cursor  = entry.cursor || null;
    let offset  = null;
    let setAt   = entry.setAt  || null;
    let decoded = null;

    // Enrich with getSessionCursor for richer output
    try {
      const cursorInfo = session.getSessionCursor(entry.name);
      if (cursorInfo) {
        if (cursorInfo.cursor != null) cursor = cursorInfo.cursor;
        if (cursorInfo.offset != null) offset = cursorInfo.offset;
        if (cursorInfo.setAt  != null) setAt  = cursorInfo.setAt;
      }
    } catch (_) {}

    // Decode the cursor token to expose the offset
    if (includeDecoded && cursor) {
      try {
        const dec = RHS388.decodeRestoreSessionCursor388(cursor);
        decoded = dec || null;
      } catch (_) {
        decoded = null;
      }
    }

    const sessionEntry = {
      name:   entry.name,
      cursor,
      offset,
      setAt,
    };

    if (includeDecoded) {
      sessionEntry.decoded = decoded;
    }

    sessions.push(sessionEntry);
  }

  return {
    ok:            true,
    schema:        RESTORE_HISTORY_SESSION_SNAPSHOT_SCHEMA_389,
    version:       RESTORE_HISTORY_SESSION_SNAPSHOT_VERSION_389,
    snapshotAt,
    totalSessions: sessions.length,
    sessions,
  };
}

module.exports = {
  RESTORE_HISTORY_SESSION_SNAPSHOT_VERSION_389,
  RESTORE_HISTORY_SESSION_SNAPSHOT_SCHEMA_389,
  snapshotRestoreHistorySession389,
};
