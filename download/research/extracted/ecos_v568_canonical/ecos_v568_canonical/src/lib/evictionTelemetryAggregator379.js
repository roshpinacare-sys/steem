'use strict';
  /**
   * lib/evictionTelemetryAggregator379.js — ECOS V379 (Phase P267)
   *
   * DIRECTION 1: Telemetry aggregation.
   *
   * `aggregateEvictionTelemetry379(policyRepos, opts)` collects
   * `evictionPolicyTelemetry378` across multiple policy repo instances
   * (e.g. multi-tenant or multi-index setups) and returns a combined
   * health summary — mirrors the V352 fleet-aggregation pattern for
   * the eviction surface.
   *
   * Exports:
   *   AGGREGATOR_VERSION_379              — '379.0.0'
   *   AGGREGATOR_SCHEMA_379               — schema tag
   *   aggregateEvictionTelemetry379(policyRepos, opts)
   *     — pure; returns { ok, schema, version, totalRepos, blocked,
   *         notBlocked, summary[], aggregateTs }
   *
   * Endpoint: GET /api/v1/missions/proof-index/evict/policy/aggregate [V379-T01]
   *
   * Pure (R3 — no new npm deps). All new identifiers end with 379 (R2).
   * Sacred untouched (R1). V361..V378 preserved (R6).
   *
   * @version 379.0.0
   */

  const TELEM = require('./evictionPolicyTelemetry378.js');

  const AGGREGATOR_VERSION_379 = '379.0.0';
  const AGGREGATOR_SCHEMA_379  = 'ecos.integrity.mission.proof.index.eviction.policy.aggregate/v379';

  /**
   * Collect evictionPolicyTelemetry378 across multiple policy repos and
   * return a combined health summary.
   *
   * @param {object[]|object} policyRepos
   *   — A single repo or an array of { id?: string, repo: object } descriptors.
   *     Plain repo objects (with lastRunAt()) are accepted directly.
   * @param {{
   *   windowMs?: number,
   *   now?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalRepos: number,
   *   blocked: number,
   *   notBlocked: number,
   *   allHealthy: boolean,
   *   summary: Array<{ id: string, ok: boolean, isBlocked: boolean, lastRunAt: string|null, nextEligibleAt: string|null }>,
   *   aggregateTs: string,
   * }}
   */
  function aggregateEvictionTelemetry379(policyRepos, opts) {
    const o   = opts || {};
    const now = (typeof o.now === 'number') ? o.now : Date.now();

    if (!policyRepos) {
      return {
        ok:          false,
        error:       'policyRepos is required',
        schema:      AGGREGATOR_SCHEMA_379,
        version:     AGGREGATOR_VERSION_379,
        totalRepos:  0,
        blocked:     0,
        notBlocked:  0,
        allHealthy:  false,
        summary:     [],
        aggregateTs: new Date(now).toISOString(),
      };
    }

    // Normalise input: accept a single repo or array of { id, repo } or plain repos
    let entries = [];
    if (!Array.isArray(policyRepos)) {
      entries = [{ id: 'default', repo: policyRepos }];
    } else {
      entries = policyRepos.map((item, i) => {
        if (item && typeof item.lastRunAt === 'function') {
          // Plain repo
          return { id: 'repo-' + i, repo: item };
        }
        // { id?, repo } descriptor
        return { id: item.id || ('repo-' + i), repo: item.repo || item };
      });
    }

    const summary = [];
    let blocked   = 0;
    let notBlocked = 0;

    for (const { id, repo } of entries) {
      const t = TELEM.evictionPolicyTelemetry378(repo, { windowMs: o.windowMs, now });
      summary.push({
        id,
        ok:             t.ok,
        isBlocked:      t.isBlocked || false,
        lastRunAt:      t.lastRunAt || null,
        nextEligibleAt: t.nextEligibleAt || null,
        windowMs:       t.windowMs || null,
        telemetryTs:    t.telemetryTs || null,
      });
      if (t.ok && t.isBlocked)  blocked++;
      if (t.ok && !t.isBlocked) notBlocked++;
    }

    return {
      ok:          true,
      schema:      AGGREGATOR_SCHEMA_379,
      version:     AGGREGATOR_VERSION_379,
      totalRepos:  entries.length,
      blocked,
      notBlocked,
      allHealthy:  blocked === 0,
      summary,
      aggregateTs: new Date(now).toISOString(),
    };
  }

  module.exports = {
    AGGREGATOR_VERSION_379,
    AGGREGATOR_SCHEMA_379,
    aggregateEvictionTelemetry379,
  };
  