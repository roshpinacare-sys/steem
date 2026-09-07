'use strict';
/**
 * lib/alertDiffPaginatorSessionSnapshot388.js — ECOS V388 (Phase P276)
 *
 * DIRECTION 2: Chain diff session snapshot v2 (alert-diff surface).
 *
 * snapshotAlertDiffPaginatorSession388(session, opts) is the snapshot
 * counterpart of createAlertDiffPaginatorSession387; reads listSessions() and
 * getSessionCursor() from a V387 alert-diff session instance and returns a
 * serialisable JSON snapshot (name, cursor, startIndex, setAt, decoded?),
 * mirroring snapshotChainDiffPaginatorSession386 for the alert-diff surface.
 *
 * Exports:
 *   ALERT_DIFF_SESSION_SNAPSHOT_VERSION_388
 *   ALERT_DIFF_SESSION_SNAPSHOT_SCHEMA_388
 *   snapshotAlertDiffPaginatorSession388(session, opts)
 *     — returns { ok, schema, version, snapshotAt, totalSessions, sessions }
 *
 * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset/rate/alert/history/diff/session/snapshot [V388-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 388 (R2).
 * Sacred untouched (R1). V361..V387 preserved (R6).
 *
 * @version 388.0.0
 */

const ADP386 = require('./alertHistoryDiffPaginator386.js');

const ALERT_DIFF_SESSION_SNAPSHOT_VERSION_388 = '388.0.0';
const ALERT_DIFF_SESSION_SNAPSHOT_SCHEMA_388  =
  'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history.diff.paginator.session.snapshot/v388';

/**
 * Take a serialisable snapshot of all active named sessions in a
 * createAlertDiffPaginatorSession387 instance.
 *
 * @param {{
 *   listSessions: function(): Array<{ name: string, cursor: string|null, setAt: string|null }>,
 *   getSessionCursor: function(name: string): { ok: boolean, cursor: string|null, startIndex: number|null, setAt: string|null },
 * }} session  — a createAlertDiffPaginatorSession387() instance
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
function snapshotAlertDiffPaginatorSession388(session, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        ALERT_DIFF_SESSION_SNAPSHOT_SCHEMA_388,
    version:       ALERT_DIFF_SESSION_SNAPSHOT_VERSION_388,
    snapshotAt:    new Date().toISOString(),
    totalSessions: 0,
    sessions:      [],
  });

  if (!session || typeof session.listSessions !== 'function') {
    return errorResult('session must be a createAlertDiffPaginatorSession387() instance with listSessions()');
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
        const dec = ADP386.decodeAlertDiffCursor386(cursor);
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
    schema:        ALERT_DIFF_SESSION_SNAPSHOT_SCHEMA_388,
    version:       ALERT_DIFF_SESSION_SNAPSHOT_VERSION_388,
    snapshotAt,
    totalSessions: sessions.length,
    sessions,
  };
}

module.exports = {
  ALERT_DIFF_SESSION_SNAPSHOT_VERSION_388,
  ALERT_DIFF_SESSION_SNAPSHOT_SCHEMA_388,
  snapshotAlertDiffPaginatorSession388,
};
