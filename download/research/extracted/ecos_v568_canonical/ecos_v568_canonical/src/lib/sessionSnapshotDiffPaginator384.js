'use strict';
/**
 * lib/sessionSnapshotDiffPaginator384.js — ECOS V384 (Phase P272)
 *
 * DIRECTION 1: Session snapshot.
 *
 * snapshotDiffPaginatorSession384(session, opts) returns a serialisable
 * snapshot of all active named sessions in a createDiffPaginatorSession383
 * instance (name, cursor, startIndex, setAt), useful for admin visibility
 * and backup/restore.
 *
 * Exports:
 *   SESSION_SNAPSHOT_VERSION_384
 *   SESSION_SNAPSHOT_SCHEMA_384
 *   snapshotDiffPaginatorSession384(session, opts)
 *     — returns { ok, schema, version, snapshotAt, totalSessions, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/snapshot [V384-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 384 (R2).
 * Sacred untouched (R1). V361..V383 preserved (R6).
 *
 * @version 384.0.0
 */

const ADP382 = require('./aggregatorHistoryDiffPaginator382.js');

const SESSION_SNAPSHOT_VERSION_384 = '384.0.0';
const SESSION_SNAPSHOT_SCHEMA_384  = 'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.snapshot/v384';

/**
 * Take a serialisable snapshot of all active named sessions in a
 * createDiffPaginatorSession383 instance.
 *
 * @param {{
 *   listSessions: function(): Array<{ name: string, cursor: string, setAt: string, meta: any }>,
 *   getSessionCursor: function(name: string): { ok: boolean, cursor: string|null, startIndex: number|null, setAt: string|null },
 *   version?: string,
 * }} session  — a createDiffPaginatorSession383() instance
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
 *     startIndex: number|null,
 *     setAt: string|null,
 *     decoded?: { stepIndex: number, ts: string|null }|null,
 *   }>,
 * }}
 */
function snapshotDiffPaginatorSession384(session, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: SESSION_SNAPSHOT_SCHEMA_384, version: SESSION_SNAPSHOT_VERSION_384,
    snapshotAt: new Date().toISOString(),
    totalSessions: 0, sessions: [],
  });

  if (!session || typeof session.listSessions !== 'function') {
    return errorResult('session must be a createDiffPaginatorSession383() instance with listSessions()');
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
  const sessions = [];

  for (const entry of rawSessions) {
    if (!entry || !entry.name) continue;

    // Get cursor details via getSessionCursor for richer output
    let startIndex = null;
    let setAt      = entry.setAt || null;
    let cursor     = entry.cursor || null;
    let decoded    = null;

    try {
      const cursorInfo = session.getSessionCursor(entry.name);
      if (cursorInfo && cursorInfo.ok) {
        startIndex = cursorInfo.startIndex != null ? cursorInfo.startIndex : null;
        setAt      = cursorInfo.setAt || setAt;
        cursor     = cursorInfo.cursor || cursor;
      }
    } catch (_) {}

    if (includeDecoded && cursor) {
      try {
        const dec = ADP382.decodeAggDiffCursor382(cursor);
        decoded = dec || null;
      } catch (_) {
        decoded = null;
      }
    }

    const sessionEntry = {
      name:       entry.name,
      cursor,
      startIndex,
      setAt,
    };

    if (includeDecoded) {
      sessionEntry.decoded = decoded;
    }

    sessions.push(sessionEntry);
  }

  return {
    ok:            true,
    schema:        SESSION_SNAPSHOT_SCHEMA_384,
    version:       SESSION_SNAPSHOT_VERSION_384,
    snapshotAt,
    totalSessions: sessions.length,
    sessions,
  };
}

module.exports = {
  SESSION_SNAPSHOT_VERSION_384,
  SESSION_SNAPSHOT_SCHEMA_384,
  snapshotDiffPaginatorSession384,
};
