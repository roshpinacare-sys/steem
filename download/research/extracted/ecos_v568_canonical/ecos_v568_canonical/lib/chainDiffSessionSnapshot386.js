'use strict';
/**
 * lib/chainDiffSessionSnapshot386.js — ECOS V386 (Phase P274)
 *
 * DIRECTION 2: Chain diff session snapshot.
 *
 * snapshotChainDiffPaginatorSession386(session, opts) is the snapshot
 * counterpart of createChainDiffPaginatorSession385 — it reads listSessions()
 * and getSessionCursor() from a V385 chain-diff session instance and returns a
 * fully serialisable JSON snapshot of all active named sessions
 * (name, cursor, startIndex, setAt, decoded?), mirroring
 * snapshotDiffPaginatorSession384 for the chain-diff surface.
 *
 * Exports:
 *   CHAIN_DIFF_SESSION_SNAPSHOT_VERSION_386
 *   CHAIN_DIFF_SESSION_SNAPSHOT_SCHEMA_386
 *   snapshotChainDiffPaginatorSession386(session, opts)
 *     — returns { ok, schema, version, snapshotAt, totalSessions, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/session/snapshot [V386-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 386 (R2).
 * Sacred untouched (R1). V361..V385 preserved (R6).
 *
 * @version 386.0.0
 */

const CRP384 = require('./chainReportDiffPaginator384.js');

const CHAIN_DIFF_SESSION_SNAPSHOT_VERSION_386 = '386.0.0';
const CHAIN_DIFF_SESSION_SNAPSHOT_SCHEMA_386  =
  'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain.report.diff.paginator.session.snapshot/v386';

/**
 * Take a serialisable snapshot of all active named sessions in a
 * createChainDiffPaginatorSession385 instance.
 *
 * @param {{
 *   listSessions: function(): Array<{ name: string, cursor: string|null, setAt: string|null }>,
 *   getSessionCursor: function(name: string): { ok: boolean, cursor: string|null, startIndex: number|null, setAt: string|null },
 * }} session  — a createChainDiffPaginatorSession385() instance
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
function snapshotChainDiffPaginatorSession386(session, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        CHAIN_DIFF_SESSION_SNAPSHOT_SCHEMA_386,
    version:       CHAIN_DIFF_SESSION_SNAPSHOT_VERSION_386,
    snapshotAt:    new Date().toISOString(),
    totalSessions: 0,
    sessions:      [],
  });

  if (!session || typeof session.listSessions !== 'function') {
    return errorResult('session must be a createChainDiffPaginatorSession385() instance with listSessions()');
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
        if (cursorInfo.cursor != null)     cursor     = cursorInfo.cursor;
        if (cursorInfo.startIndex != null) startIndex = cursorInfo.startIndex;
        if (cursorInfo.setAt != null)      setAt      = cursorInfo.setAt;
      }
    } catch (_) {}

    // Decode the cursor token to expose the step index
    if (includeDecoded && cursor) {
      try {
        const dec = CRP384.decodeChainDiffCursor384(cursor);
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
    schema:        CHAIN_DIFF_SESSION_SNAPSHOT_SCHEMA_386,
    version:       CHAIN_DIFF_SESSION_SNAPSHOT_VERSION_386,
    snapshotAt,
    totalSessions: sessions.length,
    sessions,
  };
}

module.exports = {
  CHAIN_DIFF_SESSION_SNAPSHOT_VERSION_386,
  CHAIN_DIFF_SESSION_SNAPSHOT_SCHEMA_386,
  snapshotChainDiffPaginatorSession386,
};
