'use strict';
  /**
   * lib/autoHealQuotaTelemetry379.js — ECOS V379 (Phase P267)
   *
   * DIRECTION 4: Auto-heal quota telemetry.
   *
   * `autoHealQuotaTelemetry379(policyRepo, opts)` mirrors the V378 eviction
   * telemetry pattern for the auto-heal policy: reports `eventsInWindow`,
   * `quota`, `windowMs`, `isBlocked`, `nextEligibleAt`, and `lastRunAt` —
   * giving operations teams a single read-only call to diagnose whether
   * auto-heal is eligible or rate-limited.
   *
   * Exports:
   *   QUOTA_TELEMETRY_VERSION_379         — '379.0.0'
   *   QUOTA_TELEMETRY_SCHEMA_379          — schema tag
   *   autoHealQuotaTelemetry379(policyRepo, opts)
   *     — pure read-only; returns { ok, schema, version, eventsInWindow,
   *         quota, windowMs, isBlocked, nextEligibleAt, lastRunAt, telemetryTs }
   *
   * Endpoint: GET /api/v1/integrity/auto-heal/policy/status [V379-T04]
   *
   * Pure (R3 — no new npm deps). All new identifiers end with 379 (R2).
   * Sacred untouched (R1). V361..V378 preserved (R6).
   *
   * @version 379.0.0
   */

  const AHEAL = require('./autoHealPolicy378.js');

  const QUOTA_TELEMETRY_VERSION_379 = '379.0.0';
  const QUOTA_TELEMETRY_SCHEMA_379  = 'ecos.integrity.cross_chain.auto_heal.policy.telemetry/v379';

  /**
   * Build a read-only telemetry summary of the V378 auto-heal quota state.
   *
   * @param {object} policyRepo  — result of createAutoHealPolicyRepo378()
   * @param {{
   *   windowMs?: number,
   *   quota?: number,
   *   now?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   eventsInWindow: number,
   *   quota: number,
   *   windowMs: number,
   *   isBlocked: boolean,
   *   nextEligibleAt: string|null,
   *   lastRunAt: string|null,
   *   telemetryTs: string,
   * }}
   */
  function autoHealQuotaTelemetry379(policyRepo, opts) {
    const o       = opts || {};
    const now     = (typeof o.now === 'number') ? o.now : Date.now();
    const windowMs = (typeof o.windowMs === 'number' && o.windowMs >= 0)
      ? o.windowMs
      : (Number(process.env.ECOS_AUTO_HEAL_WINDOW_MS_378) || AHEAL.DEFAULT_AUTO_HEAL_WINDOW_MS_378);
    const quota   = (typeof o.quota === 'number' && o.quota >= 0)
      ? o.quota
      : AHEAL.DEFAULT_AUTO_HEAL_QUOTA_378;

    if (!policyRepo || typeof policyRepo.eventsInWindow !== 'function') {
      return {
        ok:             false,
        error:          'policyRepo is required and must expose eventsInWindow()',
        schema:         QUOTA_TELEMETRY_SCHEMA_379,
        version:        QUOTA_TELEMETRY_VERSION_379,
        eventsInWindow: 0,
        quota,
        windowMs,
        isBlocked:      false,
        nextEligibleAt: null,
        lastRunAt:      null,
        telemetryTs:    new Date(now).toISOString(),
      };
    }

    const eventsInWindow = policyRepo.eventsInWindow(windowMs, now);
    const isBlocked      = eventsInWindow >= quota;
    const lastRunAt      = typeof policyRepo.lastRunAt === 'function'
      ? policyRepo.lastRunAt()
      : null;

    let nextEligibleAt = null;
    if (isBlocked && lastRunAt) {
      nextEligibleAt = new Date(new Date(lastRunAt).getTime() + windowMs).toISOString();
    }

    return {
      ok:             true,
      schema:         QUOTA_TELEMETRY_SCHEMA_379,
      version:        QUOTA_TELEMETRY_VERSION_379,
      eventsInWindow,
      quota,
      windowMs,
      isBlocked,
      nextEligibleAt,
      lastRunAt,
      telemetryTs:    new Date(now).toISOString(),
    };
  }

  module.exports = {
    QUOTA_TELEMETRY_VERSION_379,
    QUOTA_TELEMETRY_SCHEMA_379,
    autoHealQuotaTelemetry379,
  };
  