'use strict';
/**
 * lib/chainDiffSessionRestore387.js — ECOS V387 (Phase P275)
 *
 * DIRECTION 2: Chain diff session restore.
 *
 * restoreChainDiffPaginatorSession387(session, snapshot, opts) is the inverse
 * of snapshotChainDiffPaginatorSession386 — it reads a V386 chain-diff session
 * snapshot and re-hydrates all named cursors into a live
 * createChainDiffPaginatorSession385 instance via registry.set, returning a
 * per-session result ({ restored, skipped, failed }). Mirrors
 * restoreDiffPaginatorSession385 for the chain-diff surface.
 *
 * Exports:
 *   CHAIN_DIFF_SESSION_RESTORE_VERSION_387
 *   CHAIN_DIFF_SESSION_RESTORE_SCHEMA_387
 *   restoreChainDiffPaginatorSession387(session, snapshot, opts)
 *     — returns { ok, schema, version, restoredAt, totalSessions,
 *         restored, skipped, failed, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff/session/restore [V387-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 387 (R2).
 * Sacred untouched (R1). V361..V386 preserved (R6).
 *
 * @version 387.0.0
 */

const CDS386 = require('./chainDiffSessionSnapshot386.js');

const CHAIN_DIFF_SESSION_RESTORE_VERSION_387 = '387.0.0';
const CHAIN_DIFF_SESSION_RESTORE_SCHEMA_387  =
  'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain.report.diff.paginator.session.restore/v387';

/**
 * Re-hydrate all named cursors from a V386 chain-diff session snapshot into a
 * live createChainDiffPaginatorSession385 instance.
 *
 * @param {{
 *   registry: {
 *     set: function(name: string, cursor: string, meta?: object): object,
 *   },
 *   listSessions: function(): Array<object>,
 *   getSessionCursor: function(name: string): object,
 * }} session  — a createChainDiffPaginatorSession385() instance
 * @param {{
 *   ok: boolean,
 *   sessions: Array<{
 *     name: string,
 *     cursor: string|null,
 *     startIndex: number|null,
 *     setAt: string|null,
 *   }>,
 * }} snapshot  — a snapshotChainDiffPaginatorSession386() result
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
 *   sessions: Array<{
 *     name: string,
 *     status: 'restored'|'skipped'|'failed',
 *     reason?: string,
 *   }>,
 * }}
 */
function restoreChainDiffPaginatorSession387(session, snapshot, opts) {
  const o = opts || {};
  const overwrite = !!o.overwrite;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        CHAIN_DIFF_SESSION_RESTORE_SCHEMA_387,
    version:       CHAIN_DIFF_SESSION_RESTORE_VERSION_387,
    restoredAt:    new Date().toISOString(),
    totalSessions: 0,
    restored: 0, skipped: 0, failed: 0,
    sessions: [],
  });

  if (!session || typeof session.registry !== 'object' || !session.registry) {
    return errorResult('session must be a createChainDiffPaginatorSession385() instance with a registry');
  }
  if (typeof session.registry.set !== 'function') {
    return errorResult('session.registry must expose set(name, cursor, meta)');
  }
  if (typeof session.listSessions !== 'function') {
    return errorResult('session must expose listSessions()');
  }

  if (!snapshot || snapshot.ok === false) {
    return errorResult('snapshot must be a valid snapshotChainDiffPaginatorSession386() result');
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
        restoredFrom: CDS386.CHAIN_DIFF_SESSION_SNAPSHOT_SCHEMA_386,
        setAt:        entry.setAt    || null,
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
    schema:        CHAIN_DIFF_SESSION_RESTORE_SCHEMA_387,
    version:       CHAIN_DIFF_SESSION_RESTORE_VERSION_387,
    restoredAt,
    totalSessions: snapshot.sessions.length,
    restored,
    skipped,
    failed,
    sessions,
  };
}

module.exports = {
  CHAIN_DIFF_SESSION_RESTORE_VERSION_387,
  CHAIN_DIFF_SESSION_RESTORE_SCHEMA_387,
  restoreChainDiffPaginatorSession387,
};
