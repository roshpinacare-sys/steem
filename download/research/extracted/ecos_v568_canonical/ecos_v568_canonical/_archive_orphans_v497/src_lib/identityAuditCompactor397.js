'use strict';
/**
 * identityAuditCompactor397.js — ECOS V397 D4
 *
 * Produces a deduplicated, summary-only compacted snapshot of the audit log
 * for archiving. Supports max-age and max-entries thresholds.
 * Emits identity_audit_compact_event_type_397.
 *
 * Function: createIdentityAuditCompactor397({ auditLog, audit })
 * Method:   compactAuditLog397(opts?)
 */

const IDENTITY_AUDIT_COMPACTOR_VERSION_397 = '397.0.0';

// Produced event type
const EVT_AUDIT_COMPACT_397 = 'identity_audit_compact_event_type_397';

// Default thresholds
const DEFAULT_MAX_AGE_MS_397     = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_MAX_ENTRIES_397    = 5000;

function createIdentityAuditCompactor397(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  function _getEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  /**
   * compactAuditLog397(opts?)
   *
   * opts.maxAgeMs     — drop entries older than this (default: 30 days)
   * opts.maxEntries   — keep only the newest N entries (default: 5000)
   * opts.deduplicate  — if true (default), collapse consecutive identical event types per actor
   * opts.snapshot     — if true, append EVT_AUDIT_COMPACT_397
   *
   * Returns:
   * {
   *   version, compactedAt, originalCount, retainedCount, droppedCount,
   *   deduplicatedCount, byType: { [type]: count }, entries: compacted[]
   * }
   */
  function compactAuditLog397(opts = {}) {
    const maxAgeMs      = typeof opts.maxAgeMs    === 'number' && opts.maxAgeMs    > 0 ? opts.maxAgeMs    : DEFAULT_MAX_AGE_MS_397;
    const maxEntries    = typeof opts.maxEntries  === 'number' && opts.maxEntries  > 0 ? opts.maxEntries  : DEFAULT_MAX_ENTRIES_397;
    const deduplicate   = opts.deduplicate !== false; // default true
    const doSnapshot    = opts.snapshot === true;

    const now         = Date.now();
    const ageThreshold = now - maxAgeMs;

    const allEntries = _getEntries();
    const originalCount = allEntries.length;

    // Step 1: Drop entries older than maxAgeMs
    let retained = allEntries.filter(e => {
      const ts = e.ts || e.timestamp || 0;
      return ts >= ageThreshold;
    });

    const afterAgeFilter = retained.length;

    // Step 2: Keep only the newest maxEntries
    if (retained.length > maxEntries) {
      retained = retained.slice(retained.length - maxEntries);
    }

    // Step 3: Deduplicate — collapse adjacent same-type+same-actor runs into summary entries
    let deduplicatedCount = 0;
    if (deduplicate && retained.length > 0) {
      const deduped = [];
      let runStart  = 0;

      function _actorOf(e) {
        const d = e.data || e.payload || {};
        return d.actorId || d.actor || null;
      }

      for (let i = 1; i <= retained.length; i++) {
        const prev = retained[i - 1];
        const curr = retained[i];
        const sameType  = curr && (curr.type || curr.eventType) === (prev.type || prev.eventType);
        const sameActor = curr && _actorOf(curr) === _actorOf(prev);

        if (!sameType || !sameActor || i === retained.length) {
          const runLen = i - runStart;
          if (runLen === 1) {
            deduped.push(prev);
          } else {
            // Summarise the run into a single compact entry
            deduplicatedCount += runLen - 1; // collapsed N→1, so N-1 dropped
            const runEntries = retained.slice(runStart, i);
            const firstTs    = runEntries[0].ts  || runEntries[0].timestamp  || 0;
            const lastTs     = runEntries[runEntries.length - 1].ts || runEntries[runEntries.length - 1].timestamp || 0;
            deduped.push({
              type:       prev.type || prev.eventType,
              ts:         lastTs,
              compacted:  true,
              count:      runLen,
              firstTs,
              lastTs,
              data:       _actorOf(prev) ? { actorId: _actorOf(prev) } : {},
            });
          }
          runStart = i;
        }
      }
      retained = deduped;
    }

    // Step 4: Build byType summary
    const byType = {};
    for (const e of retained) {
      const type = e.type || e.eventType || 'unknown';
      byType[type] = (byType[type] || 0) + (e.count || 1);
    }

    const retainedCount    = retained.length;
    const droppedCount     = originalCount - afterAgeFilter + (afterAgeFilter - retained.length - deduplicatedCount);

    const result = {
      version:           IDENTITY_AUDIT_COMPACTOR_VERSION_397,
      compactedAt:       now,
      originalCount,
      retainedCount,
      droppedCount:      originalCount - retainedCount - deduplicatedCount,
      deduplicatedCount,
      maxAgeMs,
      maxEntries,
      byType,
      entries:           retained,
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_AUDIT_COMPACT_397,
        ts:   now,
        data: {
          originalCount,
          retainedCount,
          deduplicatedCount,
          maxAgeMs,
          maxEntries,
        },
      });
    }

    return result;
  }

  return {
    compactAuditLog397,
    IDENTITY_AUDIT_COMPACTOR_VERSION_397,
  };
}

module.exports = {
  createIdentityAuditCompactor397,
  IDENTITY_AUDIT_COMPACTOR_VERSION_397,
  EVT_AUDIT_COMPACT_397,
  DEFAULT_MAX_AGE_MS_397,
  DEFAULT_MAX_ENTRIES_397,
};
