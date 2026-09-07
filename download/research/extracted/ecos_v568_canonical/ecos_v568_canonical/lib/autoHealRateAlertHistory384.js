'use strict';
/**
 * lib/autoHealRateAlertHistory384.js — ECOS V384 (Phase P272)
 *
 * DIRECTION 4: Alert history projection.
 *
 * getAutoHealRateAlertHistory384(ctx, opts) mirrors getAutoHealResetHistory381
 * for auto_heal_rate_alert_type_383 events, so operators can audit the cadence
 * of rate alerts without scanning the raw audit log.
 *
 * Exports:
 *   RATE_ALERT_HISTORY_VERSION_384
 *   RATE_ALERT_HISTORY_SCHEMA_384
 *   getAutoHealRateAlertHistory384(ctx, opts)
 *     — returns { ok, schema, version, totalAlerts, alerts, summary }
 *
 * Endpoint: GET /api/v1/integrity/auto-heal/quota/reset/rate/alert/history [V384-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 384 (R2).
 * Sacred untouched (R1). V361..V383 preserved (R6).
 *
 * @version 384.0.0
 */

const RRA383 = require('./autoHealResetRateAlert383.js');

const RATE_ALERT_HISTORY_VERSION_384 = '384.0.0';
const RATE_ALERT_HISTORY_SCHEMA_384  = 'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert.history/v384';

/**
 * Project all auto_heal_rate_alert_type_383 events from the audit log.
 *
 * @param {{
 *   auditLog: object,
 * }} ctx
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   sinceTs?: string,
 *   onlyOverused?: boolean,  — if true, filter to only isOverused=true alerts
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalAlerts: number,
 *   alerts: Array<{
 *     index: number,
 *     alertedAt: string,
 *     isOverused: boolean,
 *     resetsPerHour: number,
 *     resetsInWindow: number,
 *     windowHours: number,
 *     threshold: number,
 *     forced: boolean,
 *     hash: string|null,
 *   }>,
 *   summary: {
 *     overusedAlerts: number,
 *     forcedAlerts: number,
 *     firstAlertAt: string|null,
 *     lastAlertAt: string|null,
 *     avgResetsPerHour: number,
 *   },
 * }}
 */
function getAutoHealRateAlertHistory384(ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: RATE_ALERT_HISTORY_SCHEMA_384,
    version: RATE_ALERT_HISTORY_VERSION_384,
    totalAlerts: 0, alerts: [],
    summary: {
      overusedAlerts: 0, forcedAlerts: 0,
      firstAlertAt: null, lastAlertAt: null, avgResetsPerHour: 0,
    },
  });

  if (!ctx || !ctx.auditLog) {
    return errorResult('ctx.auditLog is required');
  }

  // Extract all audit entries
  let allEntries = [];
  try {
    if (typeof ctx.auditLog.entries === 'function') {
      allEntries = ctx.auditLog.entries();
    } else if (typeof ctx.auditLog.getAll === 'function') {
      allEntries = ctx.auditLog.getAll();
    } else if (Array.isArray(ctx.auditLog._log)) {
      allEntries = ctx.auditLog._log;
    } else {
      return errorResult('auditLog must expose entries(), getAll(), or _log array');
    }
  } catch (e) {
    return errorResult('failed to read audit log: ' + e.message);
  }

  // Filter to rate alert events
  const ALERT_TYPE = RRA383.AUTO_HEAL_RATE_ALERT_TYPE_383;
  let alertEntries = allEntries.filter(e =>
    e && (e.type === ALERT_TYPE || (e.payload && e.payload.type === ALERT_TYPE))
  );

  // Normalise: unwrap payload if needed
  alertEntries = alertEntries.map(e => {
    if (e.payload && e.payload.type === ALERT_TYPE) return e.payload;
    if (e.type === ALERT_TYPE) return e;
    return e;
  });

  // Apply sinceTs filter
  if (o.sinceTs) {
    const since = new Date(o.sinceTs).getTime();
    if (!isNaN(since)) {
      alertEntries = alertEntries.filter(e => {
        const ts = e.alertedAt ? new Date(e.alertedAt).getTime() : 0;
        return ts >= since;
      });
    }
  }

  // Apply onlyOverused filter
  if (o.onlyOverused) {
    alertEntries = alertEntries.filter(e => !!e.isOverused);
  }

  // Apply pagination
  const offset = (typeof o.offset === 'number' && o.offset >= 0) ? Math.floor(o.offset) : 0;
  const limit  = (typeof o.limit  === 'number' && o.limit  >  0) ? Math.floor(o.limit)  : alertEntries.length;

  const totalAlerts = alertEntries.length;
  const page        = alertEntries.slice(offset, offset + limit);

  // Build output
  const alerts = page.map((e, i) => ({
    index:          offset + i + 1,
    alertedAt:      e.alertedAt      || null,
    isOverused:     !!e.isOverused,
    resetsPerHour:  typeof e.resetsPerHour  === 'number' ? e.resetsPerHour  : 0,
    resetsInWindow: typeof e.resetsInWindow === 'number' ? e.resetsInWindow : 0,
    windowHours:    typeof e.windowHours    === 'number' ? e.windowHours    : 0,
    threshold:      typeof e.threshold      === 'number' ? e.threshold      : 0,
    forced:         !!e.forced,
    hash:           e.hash || null,
  }));

  // Summary across full (un-paginated) set
  const overusedAlerts   = alertEntries.filter(e => !!e.isOverused).length;
  const forcedAlerts     = alertEntries.filter(e => !!e.forced).length;
  const timestamps       = alertEntries.map(e => e.alertedAt).filter(Boolean).sort();
  const firstAlertAt     = timestamps[0] || null;
  const lastAlertAt      = timestamps[timestamps.length - 1] || null;
  const totalRph         = alertEntries.reduce((s, e) => s + (typeof e.resetsPerHour === 'number' ? e.resetsPerHour : 0), 0);
  const avgResetsPerHour = totalAlerts > 0 ? totalRph / totalAlerts : 0;

  return {
    ok:           true,
    schema:       RATE_ALERT_HISTORY_SCHEMA_384,
    version:      RATE_ALERT_HISTORY_VERSION_384,
    totalAlerts,
    alerts,
    summary: {
      overusedAlerts,
      forcedAlerts,
      firstAlertAt,
      lastAlertAt,
      avgResetsPerHour,
    },
  };
}

module.exports = {
  RATE_ALERT_HISTORY_VERSION_384,
  RATE_ALERT_HISTORY_SCHEMA_384,
  getAutoHealRateAlertHistory384,
};
