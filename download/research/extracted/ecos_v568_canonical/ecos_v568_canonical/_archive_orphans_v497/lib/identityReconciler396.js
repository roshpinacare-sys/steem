'use strict';
/**
 * identityReconciler396.js — ECOS V396 D4
 *
 * Compares V393 call-site actors against V394 batch actors and V395 migration
 * reporter output; identifies actors present in some but not all enforcement
 * channels; emits reconciliation summary as
 * identity_reconciliation_event_type_396.
 *
 * Function: createIdentityReconciler396({ auditLog, audit })
 * Method:   reconcileIdentities396(opts?)
 */

const IDENTITY_RECONCILER_VERSION_396 = '396.0.0';

// Produced event type
const EVT_RECONCILIATION_396 = 'identity_reconciliation_event_type_396';

// Consumed event types
const EVT_ENFORCE_TRANSFER_393 = 'identity_callsite_enforce_event_type_393';
const EVT_ENFORCE_REWARD_393   = 'identity_callsite_enforce_reward_event_type_393';
const EVT_BYPASS_393           = 'identity_callsite_bypass_event_type_393';
const EVT_DENY_393             = 'identity_callsite_deny_event_type_393';
const EVT_BATCH_ITEM_394       = 'identity_batch_enforce_item_event_type_394';
const EVT_MIGRATION_REPORT_395 = 'identity_migration_report_event_type_395';

// Channels
const CHANNEL_V393_CALLSITE = 'v393_callsite';
const CHANNEL_V394_BATCH    = 'v394_batch';
const CHANNEL_V395_MIGRATION = 'v395_migration';

function createIdentityReconciler396(opts = {}) {
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
   * reconcileIdentities396(opts?)
   *
   * Scans the audit log and builds per-channel actor sets:
   *   - V393 call-site: enforce + bypass + deny events
   *   - V394 batch:     batch item events
   *   - V395 migration: migration report snapshots (actors in migrated/pending fields)
   *
   * Then produces reconciliation groups:
   *   - inAll:      actors present in all observed channels
   *   - callsiteOnly: actors seen only in V393 call-site
   *   - batchOnly:    actors seen only in V394 batch
   *   - migrationOnly: actors seen only in V395 migration report
   *   - partial:    actors present in some but not all channels (the key signal)
   *
   * opts.sinceTs   — restrict to events after this timestamp
   * opts.snapshot  — if true, append EVT_RECONCILIATION_396 to audit log
   *
   * Returns:
   * {
   *   version, reconciledAt, sinceTs,
   *   channels: { v393_callsite, v394_batch, v395_migration },   // Set sizes
   *   summary: { total, inAll, partial, uniqueChannels },
   *   inAll:          [ actorId ]
   *   partial:        [ { actorId, channels: string[] } ]
   *   callsiteOnly:   [ actorId ]
   *   batchOnly:      [ actorId ]
   *   migrationOnly:  [ actorId ]
   * }
   */
  function reconcileIdentities396(opts = {}) {
    const sinceTs    = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const doSnapshot = opts.snapshot === true;

    const entries = _getEntries().filter(e => {
      const ts = e.ts || e.timestamp || 0;
      return ts >= sinceTs;
    });

    // Per-channel actor sets
    const setCallsite  = new Set();
    const setBatch     = new Set();
    const setMigration = new Set();

    for (const e of entries) {
      const type    = e.type || e.eventType || '';
      const d       = e.data || e.payload   || e.details || {};
      const actorId = d.actorId || d.actor;

      switch (type) {
        case EVT_ENFORCE_TRANSFER_393:
        case EVT_ENFORCE_REWARD_393:
        case EVT_BYPASS_393:
        case EVT_DENY_393:
          if (actorId) setCallsite.add(actorId);
          break;

        case EVT_BATCH_ITEM_394:
          if (actorId) setBatch.add(actorId);
          break;

        case EVT_MIGRATION_REPORT_395: {
          // Migration report snapshot events embed actors in their data arrays
          const migrated = Array.isArray(d.migrated)  ? d.migrated  : [];
          const pending  = Array.isArray(d.pending)   ? d.pending   : [];
          for (const actor of [...migrated, ...pending]) {
            const id = typeof actor === 'string' ? actor : (actor && actor.actorId);
            if (id) setMigration.add(id);
          }
          break;
        }
      }
    }

    // Determine which channels were observed
    const observedChannels = [];
    if (setCallsite.size  > 0) observedChannels.push(CHANNEL_V393_CALLSITE);
    if (setBatch.size     > 0) observedChannels.push(CHANNEL_V394_BATCH);
    if (setMigration.size > 0) observedChannels.push(CHANNEL_V395_MIGRATION);

    const totalChannels = observedChannels.length;

    // Union of all actors
    const allActors = new Set([...setCallsite, ...setBatch, ...setMigration]);

    const inAll          = [];
    const partial        = [];
    const callsiteOnly   = [];
    const batchOnly      = [];
    const migrationOnly  = [];

    for (const id of allActors) {
      const inCallsite  = setCallsite.has(id);
      const inBatch     = setBatch.has(id);
      const inMigration = setMigration.has(id);

      const channels = [];
      if (inCallsite)  channels.push(CHANNEL_V393_CALLSITE);
      if (inBatch)     channels.push(CHANNEL_V394_BATCH);
      if (inMigration) channels.push(CHANNEL_V395_MIGRATION);

      // An actor is "inAll" only if it appears in every *active* channel
      // AND there are at least 2 active channels (so "only" actors don't end up here)
      if (totalChannels >= 2 && channels.length === totalChannels) {
        inAll.push(id);
      } else if (channels.length === 1) {
        // Present in exactly one channel
        if (inCallsite)  callsiteOnly.push(id);
        if (inBatch)     batchOnly.push(id);
        if (inMigration) migrationOnly.push(id);
        partial.push({ actorId: id, channels });
      } else if (channels.length > 0) {
        // Present in some but not all channels
        partial.push({ actorId: id, channels });
      }
    }

    const now = Date.now();
    const report = {
      version:      IDENTITY_RECONCILER_VERSION_396,
      reconciledAt: now,
      sinceTs,
      channels: {
        [CHANNEL_V393_CALLSITE]:  setCallsite.size,
        [CHANNEL_V394_BATCH]:     setBatch.size,
        [CHANNEL_V395_MIGRATION]: setMigration.size,
        observed: observedChannels,
      },
      summary: {
        total:          allActors.size,
        inAll:          inAll.length,
        partial:        partial.length,
        uniqueChannels: totalChannels,
      },
      inAll,
      partial,
      callsiteOnly,
      batchOnly,
      migrationOnly,
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_RECONCILIATION_396,
        ts:   now,
        data: {
          total:          allActors.size,
          inAll:          inAll.length,
          partial:        partial.length,
          channels:       observedChannels,
        },
      });
    }

    return report;
  }

  return {
    reconcileIdentities396,
    IDENTITY_RECONCILER_VERSION_396,
  };
}

module.exports = {
  createIdentityReconciler396,
  IDENTITY_RECONCILER_VERSION_396,
  EVT_RECONCILIATION_396,
  CHANNEL_V393_CALLSITE,
  CHANNEL_V394_BATCH,
  CHANNEL_V395_MIGRATION,
};
