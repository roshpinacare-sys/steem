'use strict';
/**
 * identityAuditArchiver398.js — ECOS V398 D2
 *
 * Flushes aged-out entries from the live audit log into a separate in-memory
 * cold store. Exposes a read-only cold-store query API (time range, type filter,
 * limit). Complements the V397 D4 compactor by keeping data accessible rather
 * than dropping it.
 * Emits identity_audit_archive_event_type_398.
 *
 * Function: createIdentityAuditArchiver398({ auditLog, audit, archiveAgeMs })
 * Methods:
 *   archiveAuditLog398(opts?)     — move aged entries to cold store
 *   queryColdStore398(opts?)      — read-only cold-store query
 *   getColdStoreStats398()        — size, age range, type distribution
 *   clearColdStore398()           — admin wipe of cold store (test use)
 */

const IDENTITY_AUDIT_ARCHIVER_VERSION_398 = '398.0.0';

const EVT_AUDIT_ARCHIVE_398 = 'identity_audit_archive_event_type_398';

const DEFAULT_ARCHIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createIdentityAuditArchiver398(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  const archiveAgeMs = typeof opts.archiveAgeMs === 'number' && opts.archiveAgeMs > 0
    ? opts.archiveAgeMs : DEFAULT_ARCHIVE_AGE_MS;

  // In-memory cold store: array of archived entries
  const coldStore = [];

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _getLiveEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _removeLiveEntries(toRemove) {
    if (!auditLog) return;
    const removeSet = new Set(toRemove);
    // Mutate in place if entries array is exposed directly
    if (Array.isArray(auditLog.entries)) {
      const keep = auditLog.entries.filter(e => !removeSet.has(e));
      auditLog.entries.length = 0;
      for (const e of keep) auditLog.entries.push(e);
    }
    // If only getEntries/append is available, we cannot remove — mark as archived
    // (graceful degradation: cold store still captures the entries)
  }

  /**
   * archiveAuditLog398(opts?)
   * Moves entries older than archiveAgeMs (or opts.archiveAgeMs) from the live
   * log to the cold store.
   *
   * opts.archiveAgeMs  — override age threshold for this call
   * opts.typeFilter    — string[] — only archive these event types
   * opts.snapshot      — append EVT_AUDIT_ARCHIVE_398 to live log
   *
   * Returns { version, archivedAt, movedCount, coldStoreSize }
   */
  function archiveAuditLog398(opts = {}) {
    const ageMs     = typeof opts.archiveAgeMs === 'number' && opts.archiveAgeMs > 0
      ? opts.archiveAgeMs : archiveAgeMs;
    const typeFilter = Array.isArray(opts.typeFilter) ? new Set(opts.typeFilter) : null;

    const now       = Date.now();
    const cutoff    = now - ageMs;
    const live      = _getLiveEntries();

    const toArchive = [];
    const toKeep    = [];

    for (const e of live) {
      const ts   = e.ts || e.timestamp || 0;
      const type = e.type || e.eventType || '';
      if (ts < cutoff && (!typeFilter || typeFilter.has(type))) {
        toArchive.push({ ...e, _archivedAt: now });
      } else {
        toKeep.push(e);
      }
    }

    // Move to cold store
    for (const e of toArchive) coldStore.push(e);
    _removeLiveEntries(new Set(live.filter(e => {
      const ts   = e.ts || e.timestamp || 0;
      const type = e.type || e.eventType || '';
      return ts < cutoff && (!typeFilter || typeFilter.has(type));
    })));

    const result = {
      version:       IDENTITY_AUDIT_ARCHIVER_VERSION_398,
      archivedAt:    now,
      movedCount:    toArchive.length,
      coldStoreSize: coldStore.length,
      archiveAgeMs:  ageMs,
    };

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_AUDIT_ARCHIVE_398, ts: now, data: result });
    }

    return result;
  }

  /**
   * queryColdStore398(opts?)
   * Read-only query against the cold store.
   *
   * opts.sinceTs      — lower time bound (inclusive)
   * opts.untilTs      — upper time bound (inclusive)
   * opts.typeFilter   — string[] — restrict to these event types
   * opts.actorFilter  — string[] — restrict to these actorIds
   * opts.limit        — max results (default: 200)
   *
   * Returns { version, queriedAt, totalMatched, returned, entries[] }
   */
  function queryColdStore398(opts = {}) {
    const sinceTs    = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const untilTs    = typeof opts.untilTs === 'number' ? opts.untilTs : Infinity;
    const typeFilter = Array.isArray(opts.typeFilter) ? new Set(opts.typeFilter) : null;
    const actorFilter = Array.isArray(opts.actorFilter) ? new Set(opts.actorFilter) : null;
    const limit      = typeof opts.limit  === 'number' && opts.limit > 0 ? opts.limit : 200;

    const now = Date.now();

    let matched = coldStore.filter(e => {
      const ts    = e.ts || e.timestamp || 0;
      const type  = e.type || e.eventType || '';
      const d     = e.data || e.payload || {};
      const actor = d.actorId || d.actor || null;

      if (ts < sinceTs || ts > untilTs) return false;
      if (typeFilter  && !typeFilter.has(type))   return false;
      if (actorFilter && actor && !actorFilter.has(actor)) return false;
      return true;
    });

    const totalMatched = matched.length;
    // Newest first
    matched = matched.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);

    return {
      version:      IDENTITY_AUDIT_ARCHIVER_VERSION_398,
      queriedAt:    now,
      totalMatched,
      returned:     matched.length,
      entries:      matched,
    };
  }

  /**
   * getColdStoreStats398()
   * Returns stats about the cold store: size, oldest/newest ts, type distribution.
   */
  function getColdStoreStats398() {
    const now    = Date.now();
    const byType = {};
    let   oldest = Infinity;
    let   newest = 0;

    for (const e of coldStore) {
      const type = e.type || e.eventType || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      const ts = e.ts || e.timestamp || 0;
      if (ts < oldest) oldest = ts;
      if (ts > newest) newest = ts;
    }

    return {
      version:       IDENTITY_AUDIT_ARCHIVER_VERSION_398,
      statsAt:       now,
      coldStoreSize: coldStore.length,
      oldestTs:      coldStore.length ? oldest : null,
      newestTs:      coldStore.length ? newest : null,
      byType,
    };
  }

  /**
   * clearColdStore398()
   * Admin wipe — removes all entries from the cold store.
   * Returns { cleared, version }
   */
  function clearColdStore398() {
    const cleared = coldStore.length;
    coldStore.length = 0;
    return { cleared, version: IDENTITY_AUDIT_ARCHIVER_VERSION_398, ts: Date.now() };
  }

  return {
    archiveAuditLog398,
    queryColdStore398,
    getColdStoreStats398,
    clearColdStore398,
    IDENTITY_AUDIT_ARCHIVER_VERSION_398,
    EVT_AUDIT_ARCHIVE_398,
  };
}

module.exports = {
  createIdentityAuditArchiver398,
  IDENTITY_AUDIT_ARCHIVER_VERSION_398,
  EVT_AUDIT_ARCHIVE_398,
  DEFAULT_ARCHIVE_AGE_MS_398: DEFAULT_ARCHIVE_AGE_MS,
};
