'use strict';
/**
 * lib/autoHealResetRateAlert383.js — ECOS V383 (Phase P271)
 *
 * DIRECTION 4: Reset rate alert.
 *
 * emitAutoHealResetRateAlert383(ctx, opts) wraps monitorAutoHealResetRate382
 * and, when isOverused is true, appends a structured
 * auto_heal_rate_alert_type_383 audit event so the overuse condition is
 * traceable in the same audit log as the reset events themselves.
 *
 * Exports:
 *   RESET_RATE_ALERT_VERSION_383
 *   RESET_RATE_ALERT_SCHEMA_383
 *   AUTO_HEAL_RATE_ALERT_TYPE_383
 *   emitAutoHealResetRateAlert383(ctx, opts)
 *     — returns { ok, schema, version, alertEmitted, isOverused, monitor,
 *         entry }
 *
 * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset/rate/alert [V383-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 383 (R2).
 * Sacred untouched (R1). V361..V382 preserved (R6).
 *
 * @version 383.0.0
 */

const RRM382 = require('./autoHealResetRateMonitor382.js');

const RESET_RATE_ALERT_VERSION_383   = '383.0.0';
const RESET_RATE_ALERT_SCHEMA_383    = 'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.alert/v383';
const AUTO_HEAL_RATE_ALERT_TYPE_383  = 'auto_heal_rate_alert_type_383';

/**
 * Monitor the auto-heal reset rate and emit a structured audit alert if
 * the break-glass path is being overused.
 *
 * @param {{
 *   auditLog: object,
 *   hashFn?: function,
 *   canonicalize?: function,
 * }} ctx
 * @param {{
 *   windowHours?: number,
 *   threshold?: number,
 *   now?: number,
 *   force?: boolean,   — emit alert even if not overused (for testing)
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   alertEmitted: boolean,
 *   isOverused: boolean,
 *   monitor: object,
 *   entry: object|null,
 * }}
 */
function emitAutoHealResetRateAlert383(ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: RESET_RATE_ALERT_SCHEMA_383, version: RESET_RATE_ALERT_VERSION_383,
    alertEmitted: false, isOverused: false, monitor: null, entry: null,
  });

  if (!ctx || !ctx.auditLog) {
    return errorResult('ctx.auditLog is required');
  }

  // Run the rate monitor
  const monitor = RRM382.monitorAutoHealResetRate382(ctx, {
    windowHours: o.windowHours,
    threshold:   o.threshold,
    now:         o.now,
  });

  if (!monitor.ok) {
    return errorResult(monitor.error || 'rate monitor failed');
  }

  const shouldAlert = monitor.isOverused || !!o.force;

  if (!shouldAlert) {
    return {
      ok:           true,
      schema:       RESET_RATE_ALERT_SCHEMA_383,
      version:      RESET_RATE_ALERT_VERSION_383,
      alertEmitted: false,
      isOverused:   monitor.isOverused,
      monitor,
      entry:        null,
    };
  }

  // Build alert payload
  const alertedAt = new Date(o.now || Date.now()).toISOString();
  const payload = {
    type:           AUTO_HEAL_RATE_ALERT_TYPE_383,
    schema:         RESET_RATE_ALERT_SCHEMA_383,
    version:        RESET_RATE_ALERT_VERSION_383,
    alertedAt,
    isOverused:     monitor.isOverused,
    resetsPerHour:  monitor.resetsPerHour,
    resetsInWindow: monitor.resetsInWindow,
    windowHours:    monitor.windowHours,
    threshold:      monitor.threshold,
    lastResetAt:    monitor.lastResetAt,
    summary:        monitor.summary,
    forced:         !!o.force && !monitor.isOverused,
  };

  const hashFn       = ctx.hashFn       || ((s) => s);
  const canonicalize = ctx.canonicalize || ((x) => JSON.stringify(x));
  const hash = hashFn(canonicalize(payload));
  const entry = { ...payload, hash };

  try {
    ctx.auditLog.append(AUTO_HEAL_RATE_ALERT_TYPE_383, entry);
  } catch (_) {}

  return {
    ok:           true,
    schema:       RESET_RATE_ALERT_SCHEMA_383,
    version:      RESET_RATE_ALERT_VERSION_383,
    alertEmitted: true,
    isOverused:   monitor.isOverused,
    monitor,
    entry,
  };
}

module.exports = {
  RESET_RATE_ALERT_VERSION_383,
  RESET_RATE_ALERT_SCHEMA_383,
  AUTO_HEAL_RATE_ALERT_TYPE_383,
  emitAutoHealResetRateAlert383,
};
