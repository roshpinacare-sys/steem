'use strict';
  /**
   * lib/autoHealQuotaReset380.js — ECOS V380 (Phase P268)
   *
   * DIRECTION 4: Auto-heal quota reset.
   *
   * resetAutoHealQuota380(ctx, policyRepo, opts) — an operator-controlled
   * function that flushes the rolling-window events array and records an
   * auto_heal_quota_reset_type_380 audit event, giving operators a break-glass
   * path when the quota is persistently saturated by a legitimate workload.
   *
   * Exports:
   *   AUTO_HEAL_RESET_VERSION_380
   *   AUTO_HEAL_RESET_SCHEMA_380
   *   AUTO_HEAL_QUOTA_RESET_TYPE_380
   *   resetAutoHealQuota380(ctx, policyRepo, opts)
   *     — records audit event and flushes quota; returns { ok, schema, version,
   *         eventsCleared, resetAt, entry }
   *
   * Endpoint: POST /api/v1/integrity/auto-heal/quota/reset [V380-T04]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 380 (R2).
   * Sacred untouched (R1). V361..V379 preserved (R6).
   *
   * @version 380.0.0
   */

  const AHEAL = require('./autoHealPolicy378.js');

  const AUTO_HEAL_RESET_VERSION_380   = '380.0.0';
  const AUTO_HEAL_RESET_SCHEMA_380    = 'ecos.integrity.cross_chain.auto_heal.quota.reset/v380';
  const AUTO_HEAL_QUOTA_RESET_TYPE_380 = 'auto_heal_quota_reset_type_380';

  /**
   * Flush the rolling-window events array for the V378 auto-heal policy repo
   * and record an audit event so the reset is traceable.
   *
   * @param {{
   *   auditLog: object,
   *   hashFn: function,
   *   canonicalize: function,
   * }} ctx
   * @param {object} policyRepo   — result of createAutoHealPolicyRepo378()
   * @param {{
   *   reason?: string,
   *   windowMs?: number,
   *   now?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   eventsCleared: number,
   *   resetAt: string,
   *   entry: object,
   * }}
   */
  function resetAutoHealQuota380(ctx, policyRepo, opts) {
    const o   = opts || {};
    const now = (typeof o.now === 'number') ? o.now : Date.now();
    const resetAt  = new Date(now).toISOString();
    const windowMs = (typeof o.windowMs === 'number' && o.windowMs >= 0)
      ? o.windowMs
      : (Number(process.env.ECOS_AUTO_HEAL_WINDOW_MS_378) || AHEAL.DEFAULT_AUTO_HEAL_WINDOW_MS_378);

    if (!ctx || !ctx.auditLog) {
      return {
        ok: false, error: 'ctx.auditLog is required',
        schema: AUTO_HEAL_RESET_SCHEMA_380, version: AUTO_HEAL_RESET_VERSION_380,
        eventsCleared: 0, resetAt, entry: null,
      };
    }
    if (!policyRepo || typeof policyRepo.eventsInWindow !== 'function') {
      return {
        ok: false, error: 'policyRepo is required and must expose eventsInWindow()',
        schema: AUTO_HEAL_RESET_SCHEMA_380, version: AUTO_HEAL_RESET_VERSION_380,
        eventsCleared: 0, resetAt, entry: null,
      };
    }

    // Count events before reset
    const eventsCleared = policyRepo.eventsInWindow(windowMs, now);

    // Flush the rolling window
    // createAutoHealPolicyRepo378 exposes _reset() (internal reset hook)
    if (typeof policyRepo._reset === 'function') {
      policyRepo._reset();
    } else if (typeof policyRepo.reset === 'function') {
      policyRepo.reset();
    } else if (typeof policyRepo.flush === 'function') {
      policyRepo.flush();
    }

    // Build audit entry
    const payload = {
      type:          AUTO_HEAL_QUOTA_RESET_TYPE_380,
      schema:        AUTO_HEAL_RESET_SCHEMA_380,
      version:       AUTO_HEAL_RESET_VERSION_380,
      eventsCleared,
      reason:        o.reason || 'operator-initiated quota reset',
      windowMs,
      resetAt,
    };

    const hashFn       = ctx.hashFn       || ((s) => s);
    const canonicalize = ctx.canonicalize || ((x) => JSON.stringify(x));
    const hash = hashFn(canonicalize(payload));

    const entry = { ...payload, hash };

    try {
      ctx.auditLog.append(AUTO_HEAL_QUOTA_RESET_TYPE_380, entry);
    } catch (_) {}

    return {
      ok:            true,
      schema:        AUTO_HEAL_RESET_SCHEMA_380,
      version:       AUTO_HEAL_RESET_VERSION_380,
      eventsCleared,
      resetAt,
      entry,
    };
  }

  module.exports = {
    AUTO_HEAL_RESET_VERSION_380,
    AUTO_HEAL_RESET_SCHEMA_380,
    AUTO_HEAL_QUOTA_RESET_TYPE_380,
    resetAutoHealQuota380,
  };
  