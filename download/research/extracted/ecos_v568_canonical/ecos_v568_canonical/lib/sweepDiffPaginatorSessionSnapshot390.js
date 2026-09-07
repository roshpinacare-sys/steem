'use strict';
/**
 * lib/sweepDiffPaginatorSessionSnapshot390.js — ECOS V390 (Phase P278)
 *
 * DIRECTION 2: Sweep diff paginator session snapshot.
 *
 * snapshotSweepDiffPaginatorSession390(session, opts) is the snapshot
 * counterpart of createSweepDiffPaginatorSession389; reads listSessions() and
 * getSessionCursor() from a V389 sweep-diff session instance and returns a
 * fully serialisable JSON snapshot (name, cursor, startIndex, setAt, decoded?),
 * mirroring snapshotAlertDiffPaginatorSession388 for the sweep-diff-session
 * surface.
 *
 * Exports:
 *   SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_VERSION_390
 *   SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_SCHEMA_390
 *   snapshotSweepDiffPaginatorSession390(session, opts)
 *     — returns { ok, schema, version, snapshotAt, totalSessions, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/history/diff/session/snapshot [V390-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 390 (R2).
 * Sacred untouched (R1). V361..V389 preserved (R6).
 *
 * @version 390.0.0
 */

const TSP388 = require('./ttlSweepHistoryDiffPaginator388.js');

const SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_VERSION_390 = '390.0.0';
const SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_SCHEMA_390  =
  'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep.history.diff.paginator.session.snapshot/v390';

/**
 * Take a serialisable snapshot of all active named sessions in a
 * createSweepDiffPaginatorSession389 instance.
 *
 * @param {{
 *   listSessions: function(): Array<{ name: string, cursor: string|null, setAt: string|null }>,
 *   getSessionCursor: function(name: string): { ok: boolean, cursor: string|null, startIndex: number|null, setAt: string|null },
 * }} session  — a createSweepDiffPaginatorSession389() instance
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
function snapshotSweepDiffPaginatorSession390(session, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_SCHEMA_390,
    version:       SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_VERSION_390,
    snapshotAt:    new Date().toISOString(),
    totalSessions: 0,
    sessions:      [],
  });

  if (!session || typeof session.listSessions !== 'function') {
    return errorResult('session must be a createSweepDiffPaginatorSession389() instance with listSessions()');
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

    let cursor     = entry.cursor || null;
    let startIndex = null;
    let setAt      = entry.setAt  || null;
    let decoded    = null;

    // Enrich with getSessionCursor for richer output
    try {
      const cursorInfo = session.getSessionCursor(entry.name);
      if (cursorInfo) {
        if (cursorInfo.cursor     != null) cursor     = cursorInfo.cursor;
        if (cursorInfo.startIndex != null) startIndex = cursorInfo.startIndex;
        if (cursorInfo.setAt      != null) setAt      = cursorInfo.setAt;
      }
    } catch (_) {}

    // Decode the cursor token to expose the step index
    if (includeDecoded && cursor) {
      try {
        const dec = TSP388.decodeSweepDiffCursor388(cursor);
        decoded = dec || null;
      } catch (_) {
        decoded = null;
      }
    }

    const sessionEntry = {
      name: entry.name,
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
    schema:        SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_SCHEMA_390,
    version:       SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_VERSION_390,
    snapshotAt,
    totalSessions: sessions.length,
    sessions,
  };
}

module.exports = {
  SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_VERSION_390,
  SWEEP_DIFF_PAGINATOR_SESSION_SNAPSHOT_SCHEMA_390,
  snapshotSweepDiffPaginatorSession390,
};
