'use strict';
/**
 * lib/autoHealResetRateMonitor382.js — ECOS V382 (Phase P270)
 *
 * DIRECTION 4: Auto-heal reset rate monitor.
 *
 * monitorAutoHealResetRate382(ctx, opts) reads the auto-heal reset history via
 * getAutoHealResetHistory381 and calculates the rolling reset rate (resets per
 * hour over the last N hours), flagging if the break-glass path is being
 * overused.
 *
 * Exports:
 *   RESET_RATE_MONITOR_VERSION_382
 *   RESET_RATE_MONITOR_SCHEMA_382
 *   DEFAULT_RESET_RATE_WINDOW_HOURS_382
 *   DEFAULT_RESET_RATE_THRESHOLD_382
 *   monitorAutoHealResetRate382(ctx, opts)
 *     — returns { ok, schema, version, windowHours, windowMs, totalResets,
 *         resetsInWindow, resetsPerHour, isOverused, threshold, lastResetAt,
 *         summary }
 *
 * Endpoint: GET /api/v1/integrity/auto-heal/quota/reset/rate [V382-T04]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 382 (R2).
 * Sacred untouched (R1). V361..V381 preserved (R6).
 *
 * @version 382.0.0
 */

const ARH381 = require('./autoHealResetHistory381.js');

const RESET_RATE_MONITOR_VERSION_382         = '382.0.0';
const RESET_RATE_MONITOR_SCHEMA_382          = 'ecos.integrity.cross_chain.auto_heal.quota.reset.rate.monitor/v382';
const DEFAULT_RESET_RATE_WINDOW_HOURS_382    = 24;
const DEFAULT_RESET_RATE_THRESHOLD_382       = 3; // resets per hour is "overused"

/**
 * Monitor the rolling auto-heal reset rate.
 *
 * @param {{
 *   auditLog: object,
 * }} ctx
 * @param {{
 *   windowHours?: number,        — look-back window in hours (default 24)
 *   threshold?: number,          — resets/hour threshold for overuse flag (default 3)
 *   now?: number,                — override current time (ms since epoch)
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   windowHours: number,
 *   windowMs: number,
 *   totalResets: number,         — total resets across all time
 *   resetsInWindow: number,      — resets within the look-back window
 *   resetsPerHour: number,       — rolling rate = resetsInWindow / windowHours
 *   isOverused: boolean,         — resetsPerHour >= threshold
 *   threshold: number,
 *   lastResetAt: string|null,
 *   summary: string,
 * }}
 */
function monitorAutoHealResetRate382(ctx, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: RESET_RATE_MONITOR_SCHEMA_382, version: RESET_RATE_MONITOR_VERSION_382,
    windowHours: 0, windowMs: 0, totalResets: 0, resetsInWindow: 0,
    resetsPerHour: 0, isOverused: false,
    threshold: DEFAULT_RESET_RATE_THRESHOLD_382,
    lastResetAt: null, summary: '',
  });

  if (!ctx || !ctx.auditLog) {
    return errorResult('ctx.auditLog is required');
  }

  const windowHours = (typeof o.windowHours === 'number' && o.windowHours > 0)
    ? o.windowHours
    : DEFAULT_RESET_RATE_WINDOW_HOURS_382;
  const threshold = (typeof o.threshold === 'number' && o.threshold >= 0)
    ? o.threshold
    : DEFAULT_RESET_RATE_THRESHOLD_382;
  const now       = (typeof o.now === 'number') ? o.now : Date.now();
  const windowMs  = windowHours * 60 * 60 * 1000;
  const sinceTs   = new Date(now - windowMs).toISOString();

  // Fetch all resets (no pagination limit — we need all for the summary)
  const allHistory = ARH381.getAutoHealResetHistory381(ctx);
  if (!allHistory.ok) {
    return errorResult(allHistory.error || 'failed to read auto-heal reset history');
  }

  // Fetch resets within the window
  const windowHistory = ARH381.getAutoHealResetHistory381(ctx, { sinceTs });
  if (!windowHistory.ok) {
    return errorResult(windowHistory.error || 'failed to read windowed auto-heal reset history');
  }

  const resetsInWindow = windowHistory.totalResets;
  const totalResets    = allHistory.totalResets;
  const resetsPerHour  = windowHours > 0 ? resetsInWindow / windowHours : 0;
  const isOverused     = resetsPerHour >= threshold;
  const lastResetAt    = allHistory.summary.lastResetAt || null;

  // Build human-readable summary
  let summary;
  if (resetsInWindow === 0) {
    summary = `No auto-heal quota resets in the last ${windowHours}h. Break-glass path usage is nominal.`;
  } else if (isOverused) {
    summary = `WARNING: ${resetsInWindow} reset(s) in the last ${windowHours}h ` +
      `(${resetsPerHour.toFixed(2)}/h), exceeding the threshold of ${threshold}/h. ` +
      `The break-glass path may be masking a persistent auto-heal overload.`;
  } else {
    summary = `${resetsInWindow} reset(s) in the last ${windowHours}h ` +
      `(${resetsPerHour.toFixed(2)}/h). Break-glass usage is within normal bounds (threshold: ${threshold}/h).`;
  }

  return {
    ok:             true,
    schema:         RESET_RATE_MONITOR_SCHEMA_382,
    version:        RESET_RATE_MONITOR_VERSION_382,
    windowHours,
    windowMs,
    totalResets,
    resetsInWindow,
    resetsPerHour,
    isOverused,
    threshold,
    lastResetAt,
    summary,
  };
}

module.exports = {
  RESET_RATE_MONITOR_VERSION_382,
  RESET_RATE_MONITOR_SCHEMA_382,
  DEFAULT_RESET_RATE_WINDOW_HOURS_382,
  DEFAULT_RESET_RATE_THRESHOLD_382,
  monitorAutoHealResetRate382,
};
