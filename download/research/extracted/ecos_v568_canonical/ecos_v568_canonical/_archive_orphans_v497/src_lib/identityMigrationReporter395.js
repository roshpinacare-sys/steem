'use strict';
/**
 * identityMigrationReporter395.js — ECOS V395 D3
 *
 * Compares the list of known actor IDs (from audit log) against those who have
 * made at least one non-bypassed enforcement, producing a migration progress
 * report: migrated vs. pending vs. never-seen.
 *
 * Function: createIdentityMigrationReporter395({ auditLog, audit })
 * Method:   getMigrationReport395(opts?)
 */

'use strict';

const IDENTITY_MIGRATION_REPORTER_VERSION_395 = '395.0.0';

// Consumed event types
const EVT_ENFORCE_TRANSFER_393 = 'identity_callsite_enforce_event_type_393';
const EVT_ENFORCE_REWARD_393   = 'identity_callsite_enforce_reward_event_type_393';
const EVT_BYPASS_393           = 'identity_callsite_bypass_event_type_393';
const EVT_DENY_393             = 'identity_callsite_deny_event_type_393';
const EVT_BATCH_ITEM_394       = 'identity_batch_enforce_item_event_type_394';

// Produced event type
const EVT_MIGRATION_REPORT_395 = 'identity_migration_report_event_type_395';

function createIdentityMigrationReporter395(opts = {}) {
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
   * getMigrationReport395(opts?)
   *
   * opts.sinceTs       — only consider entries after this timestamp (ms)
   * opts.knownActors   — optional explicit Set/Array of actorIds to include
   *                      (merged with actors discovered from audit log)
   * opts.snapshot      — if true, append EVT_MIGRATION_REPORT_395 to audit log
   *
   * Returns:
   * {
   *   version, generatedAt, sinceTs,
   *   summary: { total, migrated, pending, neverSeen },
   *   migrated:  [ { actorId, enforcementCount, lastEnforcedAt, bypassCount, denyCount } ]
   *   pending:   [ { actorId, bypassCount, denyCount, lastSeenAt } ]
   *   neverSeen: [ { actorId } ]   — only if knownActors was provided
   * }
   */
  function getMigrationReport395(opts = {}) {
    const sinceTs    = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const doSnapshot = opts.snapshot === true;

    // Collect knownActors set (external list, if provided)
    const externalActors = new Set();
    if (opts.knownActors) {
      for (const id of opts.knownActors) {
        if (typeof id === 'string' && id.trim()) externalActors.add(id);
      }
    }

    const entries = _getEntries().filter(e => {
      const ts = e.ts || e.timestamp || 0;
      return ts >= sinceTs;
    });

    // Per-actor accumulators
    // Map<actorId, { enforcements, bypasses, denies, lastEnforcedAt, lastSeenAt }>
    const actors = new Map();

    function _ensure(actorId) {
      if (!actors.has(actorId)) {
        actors.set(actorId, {
          enforcementCount: 0,
          bypassCount:      0,
          denyCount:        0,
          lastEnforcedAt:   null,
          lastSeenAt:       null,
        });
      }
      return actors.get(actorId);
    }

    for (const e of entries) {
      const t      = e.type || e.eventType || '';
      const d      = e.data || e.payload   || e.details || {};
      const ts     = e.ts   || e.timestamp || 0;
      const actorId = d.actorId || d.actor;
      if (!actorId) continue;

      const rec = _ensure(actorId);
      rec.lastSeenAt = Math.max(rec.lastSeenAt || 0, ts) || null;

      switch (t) {
        case EVT_ENFORCE_TRANSFER_393:
        case EVT_ENFORCE_REWARD_393:
          rec.enforcementCount++;
          rec.lastEnforcedAt = Math.max(rec.lastEnforcedAt || 0, ts) || null;
          break;
        case EVT_BYPASS_393:
          rec.bypassCount++;
          break;
        case EVT_DENY_393:
          rec.denyCount++;
          break;
        case EVT_BATCH_ITEM_394:
          if (d.status === 'ok' || d.ok === true) {
            rec.enforcementCount++;
            rec.lastEnforcedAt = Math.max(rec.lastEnforcedAt || 0, ts) || null;
          } else if (d.status === 'bypass') {
            rec.bypassCount++;
          } else if (d.status === 'denied' || d.status === 'error') {
            rec.denyCount++;
          }
          break;
      }
    }

    // Add external actors not yet seen in audit log
    for (const id of externalActors) {
      _ensure(id);
    }

    // Classify actors
    const migratedList  = [];
    const pendingList   = [];
    const neverSeenList = [];

    for (const [actorId, rec] of actors.entries()) {
      const seenInLog = entries.some(e => {
        const d = e.data || e.payload || e.details || {};
        return (d.actorId || d.actor) === actorId;
      });

      if (rec.enforcementCount > 0) {
        migratedList.push({
          actorId,
          enforcementCount: rec.enforcementCount,
          lastEnforcedAt:   rec.lastEnforcedAt,
          bypassCount:      rec.bypassCount,
          denyCount:        rec.denyCount,
        });
      } else if (seenInLog) {
        pendingList.push({
          actorId,
          bypassCount: rec.bypassCount,
          denyCount:   rec.denyCount,
          lastSeenAt:  rec.lastSeenAt,
        });
      } else {
        // Only appears because it was in knownActors
        neverSeenList.push({ actorId });
      }
    }

    const now = Date.now();
    const report = {
      version:     IDENTITY_MIGRATION_REPORTER_VERSION_395,
      generatedAt: now,
      sinceTs,
      summary: {
        total:     actors.size,
        migrated:  migratedList.length,
        pending:   pendingList.length,
        neverSeen: neverSeenList.length,
      },
      migrated:  migratedList,
      pending:   pendingList,
      neverSeen: neverSeenList,
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_MIGRATION_REPORT_395,
        ts:   now,
        data: {
          total:    report.summary.total,
          migrated: report.summary.migrated,
          pending:  report.summary.pending,
        },
      });
    }

    return report;
  }

  return {
    getMigrationReport395,
    IDENTITY_MIGRATION_REPORTER_VERSION_395,
  };
}

module.exports = {
  createIdentityMigrationReporter395,
  IDENTITY_MIGRATION_REPORTER_VERSION_395,
  EVT_MIGRATION_REPORT_395,
};
