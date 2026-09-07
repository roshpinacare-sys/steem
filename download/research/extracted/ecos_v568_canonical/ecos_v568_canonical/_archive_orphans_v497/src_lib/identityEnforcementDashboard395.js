'use strict';
/**
 * identityEnforcementDashboard395.js — ECOS V395 D1
 *
 * Aggregates V393 + V394 audit events into a single dashboard view:
 *   - total enforcements, bypasses, denials, batch outcomes,
 *     chain sync health, and bypass window status.
 *
 * Function: createIdentityEnforcementDashboard395({ auditLog, audit, bypassDays, alertThresholdDays })
 * Method:   getDashboard395(opts?)
 */

const IDENTITY_ENFORCEMENT_DASHBOARD_VERSION_395 = '395.0.0';

// ── Audit event types consumed ────────────────────────────────────────────────
const EVT_ENFORCE_TRANSFER_393   = 'identity_callsite_enforce_event_type_393';
const EVT_ENFORCE_REWARD_393     = 'identity_callsite_enforce_reward_event_type_393';
const EVT_BYPASS_393             = 'identity_callsite_bypass_event_type_393';
const EVT_DENY_393               = 'identity_callsite_deny_event_type_393';
const EVT_BATCH_ENFORCE_394      = 'identity_batch_enforce_event_type_394';
const EVT_BATCH_ITEM_394         = 'identity_batch_enforce_item_event_type_394';
const EVT_GATE_MW_394            = 'identity_gate_middleware_event_type_394';
const EVT_GATE_MW_DENY_394       = 'identity_gate_middleware_deny_event_type_394';
const EVT_CHAIN_SYNC_394         = 'commitment_chain_sync_event_type_394';
const EVT_CHAIN_SYNC_ERROR_394   = 'commitment_chain_sync_error_event_type_394';
const EVT_BYPASS_ALERT_394       = 'identity_bypass_window_alert_event_type_394';
const EVT_BYPASS_SCAN_394        = 'identity_bypass_monitor_scan_event_type_394';

// ── Produced event types ──────────────────────────────────────────────────────
const EVT_DASHBOARD_SNAPSHOT_395 = 'identity_enforcement_dashboard_snapshot_event_type_395';

function createIdentityEnforcementDashboard395(opts = {}) {
  const auditLog         = opts.auditLog || opts.audit || null;
  const bypassDays       = typeof opts.bypassDays === 'number' ? opts.bypassDays : 30;
  const alertThresholdDays = typeof opts.alertThresholdDays === 'number' ? opts.alertThresholdDays : 3;

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
   * getDashboard395(opts?)
   *   opts.sinceTs  — only consider entries after this timestamp (ms)
   *   opts.snapshot — if true, append EVT_DASHBOARD_SNAPSHOT_395 to audit log
   *
   * Returns a rich dashboard object.
   */
  function getDashboard395(opts = {}) {
    const sinceTs    = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const doSnapshot = opts.snapshot === true;

    const entries = _getEntries().filter(e => {
      const ts = e.ts || e.timestamp || 0;
      return ts >= sinceTs;
    });

    // ── V393 enforcement counts ──────────────────────────────────────────────
    const enforcements = {
      transfer: 0,
      reward:   0,
      total:    0,
    };
    const bypasses = {
      total:        0,
      byActor:      {},
      byAction:     {},
      nearExpiry:   false,
      alertMessage: null,
    };
    const denials = {
      total:    0,
      byActor:  {},
      byAction: {},
    };

    // ── V394 batch ───────────────────────────────────────────────────────────
    const batch = {
      batchesProcessed: 0,
      itemsProcessed:   0,
      itemsSucceeded:   0,
      itemsFailed:      0,
    };

    // ── V394 gate middleware ─────────────────────────────────────────────────
    const middleware = {
      requestsChecked: 0,
      requestsDenied:  0,
    };

    // ── V394 chain sync ──────────────────────────────────────────────────────
    const chainSync = {
      totalSyncs:     0,
      totalErrors:    0,
      lastHeadHash:   null,
      lastSyncTs:     null,
      lastChainLength:null,
      healthy:        true,
    };

    // ── Bypass window ────────────────────────────────────────────────────────
    const now = Date.now();
    const bypassWindowMs = bypassDays * 24 * 60 * 60 * 1000;

    // ── Scan entries ─────────────────────────────────────────────────────────
    for (const e of entries) {
      const t = e.type || e.eventType || '';
      const d = e.data || e.payload || e.details || {};

      switch (t) {
        case EVT_ENFORCE_TRANSFER_393:
          enforcements.transfer++;
          enforcements.total++;
          break;

        case EVT_ENFORCE_REWARD_393:
          enforcements.reward++;
          enforcements.total++;
          break;

        case EVT_BYPASS_393: {
          bypasses.total++;
          const actorId = d.actorId || d.actor || 'unknown';
          const action  = d.action  || 'unknown';
          bypasses.byActor[actorId]   = (bypasses.byActor[actorId]   || 0) + 1;
          bypasses.byAction[action]   = (bypasses.byAction[action]   || 0) + 1;
          // Check proximity to expiry
          const firstBypassTs = d.ts || d.timestamp || (e.ts || 0);
          const expiresAt = firstBypassTs + bypassWindowMs;
          const remainingMs = expiresAt - now;
          const remainingDays = remainingMs / (24 * 60 * 60 * 1000);
          if (remainingDays <= alertThresholdDays && remainingDays > 0) {
            bypasses.nearExpiry   = true;
            bypasses.alertMessage = `Bypass window expires in ${remainingDays.toFixed(1)} days for actor ${actorId}`;
          }
          break;
        }

        case EVT_DENY_393: {
          denials.total++;
          const actorId = d.actorId || d.actor || 'unknown';
          const action  = d.action  || 'unknown';
          denials.byActor[actorId]   = (denials.byActor[actorId]   || 0) + 1;
          denials.byAction[action]   = (denials.byAction[action]   || 0) + 1;
          break;
        }

        case EVT_BATCH_ENFORCE_394:
          batch.batchesProcessed++;
          batch.itemsProcessed  += (d.total     || 0);
          batch.itemsSucceeded  += (d.succeeded || 0);
          batch.itemsFailed     += (d.failed    || 0);
          break;

        case EVT_GATE_MW_394:
          middleware.requestsChecked++;
          break;

        case EVT_GATE_MW_DENY_394:
          middleware.requestsDenied++;
          middleware.requestsChecked++;
          break;

        case EVT_CHAIN_SYNC_394:
          chainSync.totalSyncs++;
          chainSync.lastHeadHash    = d.headHash    || chainSync.lastHeadHash;
          chainSync.lastChainLength = d.chainLength || chainSync.lastChainLength;
          chainSync.lastSyncTs      = e.ts || e.timestamp || chainSync.lastSyncTs;
          break;

        case EVT_CHAIN_SYNC_ERROR_394:
          chainSync.totalErrors++;
          chainSync.healthy = false;
          break;
      }
    }

    // Chain is considered healthy if no error has occurred or last sync was after last error
    if (chainSync.totalErrors > 0 && chainSync.lastSyncTs != null) {
      // Re-evaluate: find most recent sync vs most recent error
      const lastSyncEntry  = [...entries].reverse().find(e => (e.type || e.eventType) === EVT_CHAIN_SYNC_394);
      const lastErrorEntry = [...entries].reverse().find(e => (e.type || e.eventType) === EVT_CHAIN_SYNC_ERROR_394);
      if (lastSyncEntry && lastErrorEntry) {
        const syncTs  = lastSyncEntry.ts  || lastSyncEntry.timestamp  || 0;
        const errorTs = lastErrorEntry.ts || lastErrorEntry.timestamp || 0;
        chainSync.healthy = syncTs > errorTs;
      }
    }

    const bypassWindowStatus = {
      bypassDays,
      alertThresholdDays,
      nearExpiry:   bypasses.nearExpiry,
      alertMessage: bypasses.alertMessage,
    };

    const dashboard = {
      version:    IDENTITY_ENFORCEMENT_DASHBOARD_VERSION_395,
      generatedAt: now,
      sinceTs,
      enforcements,
      bypasses: {
        total:             bypasses.total,
        byActor:           bypasses.byActor,
        byAction:          bypasses.byAction,
        bypassWindowStatus,
      },
      denials,
      batch,
      middleware,
      chainSync,
    };

    if (doSnapshot) {
      _appendAudit({
        type:      EVT_DASHBOARD_SNAPSHOT_395,
        ts:        now,
        data: {
          enforcementsTotal: enforcements.total,
          bypassesTotal:     bypasses.total,
          denialsTotal:      denials.total,
          batchesProcessed:  batch.batchesProcessed,
          chainSyncHealthy:  chainSync.healthy,
          nearExpiry:        bypasses.nearExpiry,
        },
      });
    }

    return dashboard;
  }

  return {
    getDashboard395,
    IDENTITY_ENFORCEMENT_DASHBOARD_VERSION_395,
  };
}

module.exports = {
  createIdentityEnforcementDashboard395,
  IDENTITY_ENFORCEMENT_DASHBOARD_VERSION_395,
  EVT_DASHBOARD_SNAPSHOT_395,
};
