'use strict';
  /**
   * lib/evictionPolicyTelemetry378.js — ECOS V378 (Phase P266)
   *
   * DIRECTION 1: Eviction policy telemetry.
   *
   * `evictionPolicyTelemetry378(policyRepo, opts)` builds a read-only
   * summary of the V377 eviction cooldown state: lastRunAt, nextEligibleAt,
   * windowMs, and isBlocked — giving operations teams a single call to
   * diagnose whether eviction is eligible or cooling down.
   *
   * Exports:
   *   TELEMETRY_VERSION_378         — '378.0.0'
   *   TELEMETRY_SCHEMA_378          — schema tag
   *   DEFAULT_TELEMETRY_WINDOW_MS_378 — 6h (mirrors V377 default)
   *   evictionPolicyTelemetry378(policyRepo, opts)
   *     — pure read-only; returns { schema, version, lastRunAt,
   *       nextEligibleAt, windowMs, isBlocked, telemetryTs }
   *
   * Endpoint: GET /api/v1/missions/proof-index/evict/policy/status [V378-T01]
   *
   * Pure (R3 — no new npm deps). All new identifiers end with 378 (R2).
   * Sacred untouched (R1). V361..V377 preserved (R6).
   *
   * @version 378.0.0
   */

  const TELEMETRY_VERSION_378         = '378.0.0';
  const TELEMETRY_SCHEMA_378          = 'ecos.integrity.mission.proof.index.eviction.policy.telemetry/v378';
  const DEFAULT_TELEMETRY_WINDOW_MS_378 = 6 * 60 * 60 * 1000; // 6h — mirrors V377 default

  /**
   * Build a read-only telemetry summary of the V377 eviction cooldown state.
   *
   * @param {object} policyRepo  — result of createEvictionPolicyRepo377()
   * @param {{
   *   windowMs?: number,
   *   now?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   lastRunAt: string|null,
   *   nextEligibleAt: string|null,
   *   windowMs: number,
   *   isBlocked: boolean,
   *   telemetryTs: string,
   * }}
   */
  function evictionPolicyTelemetry378(policyRepo, opts) {
    const o = opts || {};
    const now      = (typeof o.now === 'number') ? o.now : Date.now();
    const windowMs = (typeof o.windowMs === 'number' && o.windowMs >= 0)
      ? o.windowMs
      : (Number(process.env.ECOS_PROOF_INDEX_EVICTION_WINDOW_MS_377) ||
         DEFAULT_TELEMETRY_WINDOW_MS_378);

    if (!policyRepo || typeof policyRepo.lastRunAt !== 'function') {
      return {
        ok:              false,
        error:           'policyRepo is required and must expose lastRunAt()',
        schema:          TELEMETRY_SCHEMA_378,
        version:         TELEMETRY_VERSION_378,
        lastRunAt:       null,
        nextEligibleAt:  null,
        windowMs,
        isBlocked:       false,
        telemetryTs:     new Date(now).toISOString(),
      };
    }

    const lastRunAt = policyRepo.lastRunAt();
    let nextEligibleAt = null;
    let isBlocked      = false;

    if (lastRunAt) {
      const lastRunMs   = new Date(lastRunAt).getTime();
      const nextEligMs  = lastRunMs + windowMs;
      nextEligibleAt    = new Date(nextEligMs).toISOString();
      isBlocked         = now < nextEligMs;
    }

    return {
      ok:             true,
      schema:         TELEMETRY_SCHEMA_378,
      version:        TELEMETRY_VERSION_378,
      lastRunAt:      lastRunAt || null,
      nextEligibleAt,
      windowMs,
      isBlocked,
      telemetryTs:    new Date(now).toISOString(),
    };
  }

  module.exports = {
    TELEMETRY_VERSION_378,
    TELEMETRY_SCHEMA_378,
    DEFAULT_TELEMETRY_WINDOW_MS_378,
    evictionPolicyTelemetry378,
  };
  