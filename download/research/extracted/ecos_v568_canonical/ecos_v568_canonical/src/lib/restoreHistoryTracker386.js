'use strict';
/**
 * lib/restoreHistoryTracker386.js — ECOS V386 (Phase P274)
 *
 * DIRECTION 1: Restore history tracker.
 *
 * recordRestoreResult386(session, snapshot, restoreResult, ctx, opts) wraps
 * restoreDiffPaginatorSession385 and appends a restore_event_type_386 audit
 * event so operators can audit when and which sessions were restored, how many
 * succeeded vs. failed, without scanning server logs.
 * Mirrors the ttlSweepHistoryTracker385 pattern for restores.
 *
 * Exports:
 *   RESTORE_HISTORY_VERSION_386
 *   RESTORE_HISTORY_SCHEMA_386
 *   RESTORE_EVENT_TYPE_386
 *   recordRestoreResult386(session, snapshot, restoreResult, ctx, opts)
 *     — returns { ok, schema, version, eventRecorded, restore, entry }
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff/session/restore/record [V386-T01]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 386 (R2).
 * Sacred untouched (R1). V361..V385 preserved (R6).
 *
 * @version 386.0.0
 */

const RDS385 = require('./restoreDiffPaginatorSession385.js');

const RESTORE_HISTORY_VERSION_386 = '386.0.0';
const RESTORE_HISTORY_SCHEMA_386  =
  'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff.paginator.session.restore.history/v386';
const RESTORE_EVENT_TYPE_386 = 'restore_event_type_386';

/**
 * Wrap restoreDiffPaginatorSession385 and append a structured audit event so
 * operators can audit restore history.
 *
 * If restoreResult is already provided (pre-built), it is used directly.
 * Otherwise, restoreDiffPaginatorSession385 is called with session + snapshot.
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
 *   sessions: Array<object>,
 * }} snapshot  — a snapshotDiffPaginatorSession384() result
 * @param {object|null} restoreResult
 *   — a pre-built restoreDiffPaginatorSession385() result, or null to invoke it
 * @param {{
 *   auditLog: {
 *     append: function(type: string, payload: object): object|void,
 *   },
 *   hashFn?: function,
 *   canonicalize?: function,
 * }} ctx
 * @param {{
 *   overwrite?: boolean,  — passed to restoreDiffPaginatorSession385 when invoked internally
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   eventRecorded: boolean,
 *   restore: {
 *     ok: boolean,
 *     restoredAt: string,
 *     totalSessions: number,
 *     restored: number,
 *     skipped: number,
 *     failed: number,
 *     sessions: Array<object>,
 *   },
 *   entry: object|null,
 * }}
 */
function recordRestoreResult386(session, snapshot, restoreResult, ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        RESTORE_HISTORY_SCHEMA_386,
    version:       RESTORE_HISTORY_VERSION_386,
    eventRecorded: false,
    restore: {
      ok: false, restoredAt: new Date().toISOString(),
      totalSessions: 0, restored: 0, skipped: 0, failed: 0, sessions: [],
    },
    entry: null,
  });

  if (!ctx || !ctx.auditLog || typeof ctx.auditLog.append !== 'function') {
    return errorResult('ctx.auditLog must expose append(type, payload)');
  }

  // Perform or accept the restore
  let restore;
  if (restoreResult != null) {
    restore = restoreResult;
  } else {
    // Validate inputs before calling
    if (!session) {
      return errorResult('session must be a createDiffPaginatorSession383() instance');
    }
    if (!snapshot) {
      return errorResult('snapshot must be a valid snapshotDiffPaginatorSession384() result');
    }
    restore = RDS385.restoreDiffPaginatorSession385(session, snapshot, {
      overwrite: !!o.overwrite,
    });
  }

  if (!restore || restore.ok === false) {
    return {
      ok:            false,
      error:         (restore && restore.error) || 'restore failed',
      schema:        RESTORE_HISTORY_SCHEMA_386,
      version:       RESTORE_HISTORY_VERSION_386,
      eventRecorded: false,
      restore:       restore || { ok: false, restoredAt: new Date().toISOString(), totalSessions: 0, restored: 0, skipped: 0, failed: 0, sessions: [] },
      entry:         null,
    };
  }

  // Build the audit event payload
  const payload = {
    type:          RESTORE_EVENT_TYPE_386,
    restoredAt:    restore.restoredAt || new Date().toISOString(),
    totalSessions: restore.totalSessions,
    restored:      restore.restored,
    skipped:       restore.skipped,
    failed:        restore.failed,
    recordedAt:    new Date().toISOString(),
  };

  // Optional integrity hash
  if (typeof ctx.hashFn === 'function' && typeof ctx.canonicalize === 'function') {
    try {
      payload.hash = ctx.hashFn(ctx.canonicalize(payload));
    } catch (_) {}
  }

  let entry = null;
  let eventRecorded = false;

  try {
    const appendResult = ctx.auditLog.append(RESTORE_EVENT_TYPE_386, payload);
    entry = appendResult || payload;
    eventRecorded = true;
  } catch (e) {
    return {
      ok:            false,
      error:         'audit log append failed: ' + e.message,
      schema:        RESTORE_HISTORY_SCHEMA_386,
      version:       RESTORE_HISTORY_VERSION_386,
      eventRecorded: false,
      restore,
      entry:         null,
    };
  }

  return {
    ok:            true,
    schema:        RESTORE_HISTORY_SCHEMA_386,
    version:       RESTORE_HISTORY_VERSION_386,
    eventRecorded,
    restore,
    entry,
  };
}

module.exports = {
  RESTORE_HISTORY_VERSION_386,
  RESTORE_HISTORY_SCHEMA_386,
  RESTORE_EVENT_TYPE_386,
  recordRestoreResult386,
};
