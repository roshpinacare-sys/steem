'use strict';
/**
 * lib/recoveryAuditHistory393.js — ECOS V393 (Phase P281) — Recovery Guardian Audit History
 *
 * Direction 3 (V393): Read-side projection of all identity recovery audit events
 * for a given actorId. Mirrors getRestoreHistory387 for the identity-recovery surface.
 *
 * V392 appends identity_recovery_*_392 events to the sacred audit log on every
 * guardian set, vote submission, and recovery execution. V393 adds the read-side
 * counterpart: getRecoveryAuditHistory393(actorId, opts) — scans the audit log for
 * all identity_recovery_event_type_392 and identity_recovery_guardian_set_event_type_392
 * events for a given actorId, with limit / offset / sinceTs support.
 *
 * Exports:
 *   createRecoveryAuditHistoryReader393(opts)
 *     — { getRecoveryAuditHistory393, stats393 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 393 (R2).
 * Sacred files untouched (R1). V361–V392 preserved (R6).
 *
 * @version 393.0.0
 */

const RECOVERY_AUDIT_HISTORY_VERSION_393 = '393.0.0';
const RECOVERY_AUDIT_HISTORY_SCHEMA_393  = 'ecos.sovereign.identity.recovery.audit.history/v393';

// The V392 event types we aggregate
const RECOVERY_EVENT_TYPES_393 = [
  'identity_recovery_event_type_392',
  'identity_recovery_guardian_set_event_type_392',
];

class RecoveryAuditHistoryError393 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name  = 'RecoveryAuditHistoryError393';
    this.code  = code || 'RECOVERY_HISTORY_ERROR';
    this.statusCode = 400;
  }
}

/**
 * Create a read-side projection reader for recovery audit history.
 *
 * @param {object} opts
 * @param {object}   opts.auditLog           — audit log instance; must expose readAll() or entries()
 *                                             returning an iterable of { type, payload, ts }
 * @param {object}   [opts.logger]
 */
function createRecoveryAuditHistoryReader393(opts = {}) {
  if (!opts.auditLog) {
    throw new RecoveryAuditHistoryError393(
      'recoveryAuditHistory393: opts.auditLog required',
      'BAD_CONFIG'
    );
  }

  const auditLog = opts.auditLog;
  const _stats393 = { reads: 0, eventsScanned: 0 };

  /**
   * Read all identity-recovery audit events for a given actorId.
   *
   * @param {string}  actorId
   * @param {object}  [opts2]
   * @param {number}  [opts2.limit]    — max events to return (default 50)
   * @param {number}  [opts2.offset]   — skip first N matching events (default 0)
   * @param {string}  [opts2.sinceTs]  — ISO timestamp; only events at or after this time
   * @param {string[]}[opts2.eventTypes] — subset of RECOVERY_EVENT_TYPES_393 to include
   * @returns {{ ok: true, actorId, events, total, hasMore, version }}
   */
  function getRecoveryAuditHistory393(actorId, opts2 = {}) {
    if (!actorId || typeof actorId !== 'string') {
      throw new RecoveryAuditHistoryError393('actorId required', 'NO_ACTOR_ID');
    }

    const limit  = Number.isFinite(opts2.limit)  && opts2.limit  > 0 ? opts2.limit  : 50;
    const offset = Number.isFinite(opts2.offset) && opts2.offset >= 0 ? opts2.offset : 0;
    const sinceTs = opts2.sinceTs ? new Date(opts2.sinceTs).getTime() : 0;
    const filterTypes = Array.isArray(opts2.eventTypes) && opts2.eventTypes.length > 0
      ? opts2.eventTypes
      : RECOVERY_EVENT_TYPES_393;

    // Read all entries from the audit log
    let allEntries = [];
    try {
      if (typeof auditLog.readAll === 'function') {
        allEntries = auditLog.readAll();
      } else if (typeof auditLog.entries === 'function') {
        allEntries = [...auditLog.entries()];
      } else if (typeof auditLog.getAll === 'function') {
        allEntries = auditLog.getAll();
      } else if (auditLog._entries && Array.isArray(auditLog._entries)) {
        allEntries = auditLog._entries;
      } else if (auditLog._log && Array.isArray(auditLog._log)) {
        allEntries = auditLog._log;
      } else {
        // Final fallback: try direct iteration
        for (const e of auditLog) { allEntries.push(e); }
      }
    } catch (e) {
      throw new RecoveryAuditHistoryError393(`auditLog read failed: ${e.message}`, 'AUDIT_READ_FAILED');
    }

    _stats393.eventsScanned += allEntries.length;

    // Filter: match event type, actorId in payload, and sinceTs
    const matching = [];
    for (const entry of allEntries) {
      const type    = entry.type    || entry.eventType;
      const payload = entry.payload || entry.data || {};
      const ts      = entry.ts || entry.timestamp || entry.createdAt || null;

      if (!filterTypes.includes(type)) continue;

      // actorId check: may be in payload.actorId or payload.id
      const entryActor = payload.actorId || payload.id;
      if (entryActor !== actorId) continue;

      // sinceTs filter
      if (sinceTs > 0 && ts) {
        const entryMs = new Date(ts).getTime();
        if (isNaN(entryMs) || entryMs < sinceTs) continue;
      }

      matching.push({
        type,
        payload,
        ts: ts || null,
      });
    }

    const total   = matching.length;
    const page    = matching.slice(offset, offset + limit);
    const hasMore = offset + page.length < total;

    _stats393.reads++;

    return {
      ok: true,
      actorId,
      events:  page,
      total,
      offset,
      limit,
      hasMore,
      sinceTs: sinceTs ? new Date(sinceTs).toISOString() : null,
      version: RECOVERY_AUDIT_HISTORY_VERSION_393,
    };
  }

  function stats393() {
    return { ..._stats393, version: RECOVERY_AUDIT_HISTORY_VERSION_393 };
  }

  return {
    getRecoveryAuditHistory393,
    stats393,
    RECOVERY_AUDIT_HISTORY_VERSION_393,
    RECOVERY_AUDIT_HISTORY_SCHEMA_393,
    RECOVERY_EVENT_TYPES_393,
  };
}

module.exports = {
  createRecoveryAuditHistoryReader393,
  RECOVERY_AUDIT_HISTORY_VERSION_393,
  RECOVERY_AUDIT_HISTORY_SCHEMA_393,
  RECOVERY_EVENT_TYPES_393,
  RecoveryAuditHistoryError393,
};
