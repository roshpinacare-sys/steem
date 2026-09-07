'use strict';
  /**
   * lib/autoHealResetHistory381.js — ECOS V381 (Phase P269)
   *
   * DIRECTION 4: Auto-heal reset history.
   *
   * getAutoHealResetHistory381(ctx, opts) projects all
   * auto_heal_quota_reset_type_380 events from the audit log so operators can
   * audit the break-glass reset cadence without inspecting the raw audit log.
   *
   * Exports:
   *   AUTO_HEAL_RESET_HISTORY_VERSION_381
   *   AUTO_HEAL_RESET_HISTORY_SCHEMA_381
   *   getAutoHealResetHistory381(ctx, opts)
   *     — returns { ok, schema, version, totalResets, resets, summary }
   *
   * Endpoint: GET /api/v1/integrity/auto-heal/quota/reset/history [V381-T04]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 381 (R2).
   * Sacred untouched (R1). V361..V380 preserved (R6).
   *
   * @version 381.0.0
   */

  const QR380 = require('./autoHealQuotaReset380.js');

  const AUTO_HEAL_RESET_HISTORY_VERSION_381 = '381.0.0';
  const AUTO_HEAL_RESET_HISTORY_SCHEMA_381  = 'ecos.integrity.cross_chain.auto_heal.quota.reset.history/v381';

  /**
   * Project all auto_heal_quota_reset_type_380 events from the audit log.
   *
   * @param {{
   *   auditLog: object,
   * }} ctx
   * @param {{
   *   limit?: number,
   *   offset?: number,
   *   sinceTs?: string,
   *   now?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalResets: number,
   *   resets: Array<{
   *     index: number,
   *     resetAt: string,
   *     eventsCleared: number,
   *     reason: string,
   *     windowMs: number,
   *     hash: string,
   *   }>,
   *   summary: {
   *     totalEventsCleared: number,
   *     firstResetAt: string|null,
   *     lastResetAt: string|null,
   *     avgEventsCleared: number,
   *   },
   * }}
   */
  function getAutoHealResetHistory381(ctx, opts) {
    const o = opts || {};

    const errorResult = (msg) => ({
      ok: false, error: msg,
      schema: AUTO_HEAL_RESET_HISTORY_SCHEMA_381,
      version: AUTO_HEAL_RESET_HISTORY_VERSION_381,
      totalResets: 0, resets: [],
      summary: { totalEventsCleared: 0, firstResetAt: null, lastResetAt: null, avgEventsCleared: 0 },
    });

    if (!ctx || !ctx.auditLog) {
      return errorResult('ctx.auditLog is required');
    }

    // Extract all audit entries of the auto_heal_quota_reset_type_380 type
    let allEntries = [];
    try {
      // AuditLog exposes entries() or getAll() or similar
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

    // Filter to reset events
    const RESET_TYPE = QR380.AUTO_HEAL_QUOTA_RESET_TYPE_380;
    let resetEntries = allEntries.filter(e =>
      e && (e.type === RESET_TYPE || (e.payload && e.payload.type === RESET_TYPE))
    );

    // Normalise: unwrap payload if needed
    resetEntries = resetEntries.map(e => {
      if (e.payload && e.payload.type === RESET_TYPE) return e.payload;
      if (e.type === RESET_TYPE) return e;
      return e;
    });

    // Apply sinceTs filter
    if (o.sinceTs) {
      const since = new Date(o.sinceTs).getTime();
      if (!isNaN(since)) {
        resetEntries = resetEntries.filter(e => {
          const ts = e.resetAt ? new Date(e.resetAt).getTime() : 0;
          return ts >= since;
        });
      }
    }

    // Apply pagination
    const offset = (typeof o.offset === 'number' && o.offset >= 0) ? Math.floor(o.offset) : 0;
    const limit  = (typeof o.limit  === 'number' && o.limit  >  0) ? Math.floor(o.limit)  : resetEntries.length;

    const totalResets = resetEntries.length;
    const page = resetEntries.slice(offset, offset + limit);

    // Build output
    const resets = page.map((e, i) => ({
      index:         offset + i + 1,
      resetAt:       e.resetAt       || null,
      eventsCleared: e.eventsCleared != null ? e.eventsCleared : 0,
      reason:        e.reason        || 'operator-initiated quota reset',
      windowMs:      e.windowMs      || 0,
      hash:          e.hash          || null,
    }));

    // Summary across the full (un-paginated) set
    const totalEventsCleared = resetEntries.reduce((s, e) => s + (e.eventsCleared || 0), 0);
    const timestamps = resetEntries.map(e => e.resetAt).filter(Boolean).sort();
    const firstResetAt = timestamps[0] || null;
    const lastResetAt  = timestamps[timestamps.length - 1] || null;
    const avgEventsCleared = totalResets > 0 ? totalEventsCleared / totalResets : 0;

    return {
      ok: true,
      schema:  AUTO_HEAL_RESET_HISTORY_SCHEMA_381,
      version: AUTO_HEAL_RESET_HISTORY_VERSION_381,
      totalResets,
      resets,
      summary: { totalEventsCleared, firstResetAt, lastResetAt, avgEventsCleared },
    };
  }

  module.exports = {
    AUTO_HEAL_RESET_HISTORY_VERSION_381,
    AUTO_HEAL_RESET_HISTORY_SCHEMA_381,
    getAutoHealResetHistory381,
  };
  