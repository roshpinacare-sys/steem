'use strict';
/**
 * lib/restoreDiffPaginatorSession385.js — ECOS V385 (Phase P273)
 *
 * DIRECTION 1: Snapshot restore.
 *
 * restoreDiffPaginatorSession385(session, snapshot, opts) is the inverse of
 * snapshotDiffPaginatorSession384 — it reads a V384 snapshot object and
 * re-hydrates all named cursors into a live createDiffPaginatorSession383
 * instance via registry.set, returning a per-session restore result
 * ({ restored, skipped, failed }).
 *
 * Exports:
 *   RESTORE_DIFF_PAGINATOR_SESSION_VERSION_385
 *   RESTORE_DIFF_PAGINATOR_SESSION_SCHEMA_385
 *   restoreDiffPaginatorSession385(session, snapshot, opts)
 *     — returns { ok, schema, version, restoredAt, totalSessions,
 *         restored, skipped, failed, sessions }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore [V385-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 385 (R2).
 * Sacred untouched (R1). V361..V384 preserved (R6).
 *
 * @version 385.0.0
 */

const SSP384 = require('./sessionSnapshotDiffPaginator384.js');

const RESTORE_DIFF_PAGINATOR_SESSION_VERSION_385 = '385.0.0';
const RESTORE_DIFF_PAGINATOR_SESSION_SCHEMA_385  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.restore/v385';

/**
 * Re-hydrate all named cursors from a V384 snapshot into a live
 * createDiffPaginatorSession383 instance.
 *
 * @param {{
 *   registry: {
 *     set: function(name: string, cursor: string, meta?: object): object,
 *   },
 *   listSessions: function(): Array<object>,
 *   getSessionCursor: function(name: string): object,
 * }} session  — a createDiffPaginatorSession383() instance
 * @param {{
 *   ok: boolean,
 *   sessions: Array<{
 *     name: string,
 *     cursor: string|null,
 *     startIndex: number|null,
 *     setAt: string|null,
 *   }>,
 * }} snapshot  — a snapshotDiffPaginatorSession384() result
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
function restoreDiffPaginatorSession385(session, snapshot, opts) {
  const o = opts || {};
  const overwrite = !!o.overwrite;

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        RESTORE_DIFF_PAGINATOR_SESSION_SCHEMA_385,
    version:       RESTORE_DIFF_PAGINATOR_SESSION_VERSION_385,
    restoredAt:    new Date().toISOString(),
    totalSessions: 0,
    restored: 0, skipped: 0, failed: 0,
    sessions: [],
  });

  if (!session || typeof session.registry !== 'object' || !session.registry) {
    return errorResult('session must be a createDiffPaginatorSession383() instance with a registry');
  }
  if (typeof session.registry.set !== 'function') {
    return errorResult('session.registry must expose set(name, cursor, meta)');
  }
  if (typeof session.listSessions !== 'function') {
    return errorResult('session must expose listSessions()');
  }

  if (!snapshot || snapshot.ok === false) {
    return errorResult('snapshot must be a valid snapshotDiffPaginatorSession384() result');
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
        restoredFrom: SSP384.SESSION_SNAPSHOT_SCHEMA_384,
        setAt:        entry.setAt || null,
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
    schema:        RESTORE_DIFF_PAGINATOR_SESSION_SCHEMA_385,
    version:       RESTORE_DIFF_PAGINATOR_SESSION_VERSION_385,
    restoredAt,
    totalSessions: snapshot.sessions.length,
    restored,
    skipped,
    failed,
    sessions,
  };
}

module.exports = {
  RESTORE_DIFF_PAGINATOR_SESSION_VERSION_385,
  RESTORE_DIFF_PAGINATOR_SESSION_SCHEMA_385,
  restoreDiffPaginatorSession385,
};
