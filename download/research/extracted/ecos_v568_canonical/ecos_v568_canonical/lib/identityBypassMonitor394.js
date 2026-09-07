'use strict';
/**
 * lib/identityBypassMonitor394.js — ECOS V394 (Phase P282) — Bypass Window Monitor
 *
 * Direction 1 (V394): Scan the audit log for identity_callsite_bypass_event_type_393 events
 * and aggregate bypass counts per actorId and action type. Expose getBypassSummary394()
 * so operators can track which actors have not yet migrated to signed claims.
 * Alert when bypass window nears expiry (configurable warning threshold).
 *
 * Exports:
 *   createIdentityBypassMonitor394(opts)
 *     — { getBypassSummary394, getActorBypassDetail394, resetStats394, stats394 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 394 (R2).
 * Sacred files untouched (R1). V361–V393 preserved (R6).
 *
 * @version 394.0.0
 */

const IDENTITY_BYPASS_MONITOR_VERSION_394  = '394.0.0';
const IDENTITY_BYPASS_MONITOR_SCHEMA_394   = 'ecos.sovereign.identity.bypass.monitor/v394';
const IDENTITY_BYPASS_MONITOR_EVENT_394    = 'identity_bypass_monitor_scan_event_type_394';
const IDENTITY_BYPASS_ALERT_EVENT_394      = 'identity_bypass_window_alert_event_type_394';

// The bypass event type emitted by V393
const BYPASS_EVENT_TYPE_393 = 'identity_callsite_bypass_event_type_393';

// V393 epoch: same epoch used by V393 enforcer
const IDENTITY_CALLSITE_EPOCH_393 = '2026-06-03T00:00:00.000Z';

class IdentityBypassMonitorError394 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'IdentityBypassMonitorError394';
    this.code = code || 'MONITOR_ERROR';
    this.statusCode = 400;
  }
}

/**
 * Create the bypass monitor.
 *
 * @param {object} opts
 * @param {object}   opts.auditLog            — auditLog instance (must expose readAll())
 * @param {function} [opts.audit]             — (type, payload) => void
 * @param {object}   [opts.logger]
 * @param {number}   [opts.bypassDays]        — bypass window length in days (from epoch); read from
 *                                              ECOS_IDENTITY_BYPASS_DAYS env if not supplied
 * @param {number}   [opts.alertThresholdDays]— warn when remaining days <= this value (default: 3)
 */
function createIdentityBypassMonitor394(opts = {}) {
  if (!opts.auditLog || typeof opts.auditLog.readAll !== 'function') {
    throw new IdentityBypassMonitorError394(
      'identityBypassMonitor394: opts.auditLog must expose readAll()',
      'BAD_CONFIG'
    );
  }

  const auditLog = opts.auditLog;
  const audit    = typeof opts.audit === 'function' ? opts.audit : null;

  const _envRaw  = process.env.ECOS_IDENTITY_BYPASS_DAYS;
  const _envDays = _envRaw !== undefined ? parseInt(_envRaw, 10) : NaN;
  const _bypassDays = Number.isFinite(_envDays) && _envDays >= 0 ? _envDays
    : (Number.isFinite(opts.bypassDays) && opts.bypassDays >= 0 ? opts.bypassDays : 30);

  const _alertThreshold = Number.isFinite(opts.alertThresholdDays) && opts.alertThresholdDays >= 0
    ? opts.alertThresholdDays : 3;

  const _epoch394 = new Date(IDENTITY_CALLSITE_EPOCH_393).getTime();

  const _stats394 = {
    scansPerformed:  0,
    alertsEmitted:   0,
  };

  /**
   * Returns the number of milliseconds remaining in the bypass window.
   * Negative means window has already closed.
   */
  function _remainingMs() {
    const windowEnd = _epoch394 + _bypassDays * 24 * 60 * 60 * 1000;
    return windowEnd - Date.now();
  }

  /**
   * Returns true if the bypass window is still open.
   */
  function _bypassOpen() {
    return _remainingMs() > 0;
  }

  /**
   * Scan the audit log for bypass events and return aggregated summary.
   *
   * @param {object} [scanOpts]
   * @param {string}   [scanOpts.sinceTs]     — ISO timestamp: only include events after this time
   * @param {string}   [scanOpts.actorId]     — filter to specific actorId
   * @returns {{
   *   scannedAt: string,
   *   bypassWindowOpen: boolean,
   *   remainingMs: number,
   *   remainingDays: number,
   *   nearExpiry: boolean,
   *   totalBypassEvents: number,
   *   byActorId: Record<string, { count: number, actions: Record<string, number>, lastSeen: string }>,
   *   byAction: Record<string, { count: number, uniqueActors: number }>,
   *   alertMessage?: string,
   * }}
   */
  function getBypassSummary394(scanOpts = {}) {
    const scannedAt = new Date().toISOString();
    _stats394.scansPerformed++;

    const sinceTs  = scanOpts.sinceTs ? new Date(scanOpts.sinceTs).getTime() : 0;
    const filterActor = scanOpts.actorId || null;

    let allEvents;
    try {
      allEvents = auditLog.readAll();
    } catch (e) {
      throw new IdentityBypassMonitorError394('Failed to read audit log: ' + e.message, 'AUDIT_READ_ERROR');
    }

    const bypassEvents = allEvents.filter(ev => {
      if (ev.type !== BYPASS_EVENT_TYPE_393) return false;
      if (sinceTs && ev.ts && new Date(ev.ts).getTime() < sinceTs) return false;
      if (filterActor && ev.payload && ev.payload.actorId !== filterActor) return false;
      return true;
    });

    // aggregate by actor
    const byActorId = {};
    const byAction  = {};

    for (const ev of bypassEvents) {
      const actorId = (ev.payload && ev.payload.actorId) || 'unknown';
      const action  = (ev.payload && ev.payload.action)  || 'unknown';
      const ts      = ev.ts || ev.payload && ev.payload.ts || scannedAt;

      if (!byActorId[actorId]) {
        byActorId[actorId] = { count: 0, actions: {}, lastSeen: ts };
      }
      byActorId[actorId].count++;
      byActorId[actorId].actions[action] = (byActorId[actorId].actions[action] || 0) + 1;
      if (ts > byActorId[actorId].lastSeen) byActorId[actorId].lastSeen = ts;

      if (!byAction[action]) byAction[action] = { count: 0, uniqueActors: 0 };
      byAction[action].count++;
    }

    // compute unique actors per action
    for (const [action, data] of Object.entries(byAction)) {
      const uniqueSet = new Set();
      for (const ev of bypassEvents) {
        if ((ev.payload && ev.payload.action) === action) {
          uniqueSet.add((ev.payload && ev.payload.actorId) || 'unknown');
        }
      }
      data.uniqueActors = uniqueSet.size;
    }

    const remaining    = _remainingMs();
    const remainingDays = Math.max(0, remaining / (24 * 60 * 60 * 1000));
    const nearExpiry   = _bypassOpen() && remainingDays <= _alertThreshold;

    let alertMessage = null;
    if (nearExpiry) {
      _stats394.alertsEmitted++;
      alertMessage = `Bypass window closes in ${remainingDays.toFixed(1)} days — ` +
        `${Object.keys(byActorId).length} actor(s) still using bypass.`;
      if (audit) {
        try {
          audit(IDENTITY_BYPASS_ALERT_EVENT_394, {
            scannedAt, remainingDays, actorCount: Object.keys(byActorId).length,
            bypassEventCount: bypassEvents.length, ts: scannedAt,
          });
        } catch (_) {}
      }
    }

    if (audit) {
      try {
        audit(IDENTITY_BYPASS_MONITOR_EVENT_394, {
          scannedAt, totalBypassEvents: bypassEvents.length,
          uniqueActors: Object.keys(byActorId).length, nearExpiry, ts: scannedAt,
        });
      } catch (_) {}
    }

    return {
      scannedAt,
      bypassWindowOpen: _bypassOpen(),
      remainingMs:      Math.max(0, remaining),
      remainingDays:    parseFloat(remainingDays.toFixed(3)),
      nearExpiry,
      totalBypassEvents: bypassEvents.length,
      byActorId,
      byAction,
      alertMessage,
    };
  }

  /**
   * Return bypass event detail for a single actorId.
   *
   * @param {string} actorId
   * @param {object} [detailOpts]
   * @param {number} [detailOpts.limit]    — max events to return (default 100)
   * @param {number} [detailOpts.offset]   — pagination offset
   * @param {string} [detailOpts.sinceTs]  — ISO timestamp filter
   * @returns {{ actorId, events: Array, total: number }}
   */
  function getActorBypassDetail394(actorId, detailOpts = {}) {
    if (!actorId || typeof actorId !== 'string') {
      throw new IdentityBypassMonitorError394('actorId required', 'NO_ACTOR_ID');
    }
    const limit  = Number.isFinite(detailOpts.limit)  ? detailOpts.limit  : 100;
    const offset = Number.isFinite(detailOpts.offset) ? detailOpts.offset : 0;
    const sinceTs = detailOpts.sinceTs ? new Date(detailOpts.sinceTs).getTime() : 0;

    let allEvents;
    try { allEvents = auditLog.readAll(); } catch (e) {
      throw new IdentityBypassMonitorError394('Failed to read audit log: ' + e.message, 'AUDIT_READ_ERROR');
    }

    const filtered = allEvents.filter(ev => {
      if (ev.type !== BYPASS_EVENT_TYPE_393) return false;
      if (!ev.payload || ev.payload.actorId !== actorId) return false;
      if (sinceTs && ev.ts && new Date(ev.ts).getTime() < sinceTs) return false;
      return true;
    });

    const total  = filtered.length;
    const paged  = filtered.slice(offset, offset + limit);
    return { actorId, events: paged, total, limit, offset };
  }

  /**
   * Reset internal counters (useful for testing).
   */
  function resetStats394() {
    _stats394.scansPerformed = 0;
    _stats394.alertsEmitted  = 0;
  }

  /**
   * Return monitor stats snapshot.
   */
  function stats394() {
    return {
      ..._stats394,
      bypassWindowOpen:     _bypassOpen(),
      remainingDays:        parseFloat(Math.max(0, _remainingMs() / (24 * 60 * 60 * 1000)).toFixed(3)),
      bypassDays:           _bypassDays,
      alertThresholdDays:   _alertThreshold,
      version:              IDENTITY_BYPASS_MONITOR_VERSION_394,
    };
  }

  return {
    getBypassSummary394,
    getActorBypassDetail394,
    resetStats394,
    stats394,
    IDENTITY_BYPASS_MONITOR_VERSION_394,
    IDENTITY_BYPASS_MONITOR_EVENT_394,
    IDENTITY_BYPASS_ALERT_EVENT_394,
  };
}

module.exports = {
  createIdentityBypassMonitor394,
  IDENTITY_BYPASS_MONITOR_VERSION_394,
  IDENTITY_BYPASS_MONITOR_SCHEMA_394,
  IDENTITY_BYPASS_MONITOR_EVENT_394,
  IDENTITY_BYPASS_ALERT_EVENT_394,
  BYPASS_EVENT_TYPE_393,
  IdentityBypassMonitorError394,
};
