'use strict';
  /**
   * lib/aggregatorHistory380.js — ECOS V380 (Phase P268)
   *
   * DIRECTION 1: Aggregator history.
   *
   * buildAggregatorHistory380(policyRepos, snapshotFn, opts) calls
   * aggregateEvictionTelemetry379 at multiple points in time (via snapshotFn)
   * and builds a timeline of fleet-health changes — mirrors the V378
   * comparator-history pattern for the aggregator surface.
   *
   * Exports:
   *   AGGREGATOR_HISTORY_VERSION_380
   *   AGGREGATOR_HISTORY_SCHEMA_380
   *   buildAggregatorHistory380(policyRepos, snapshotFn, opts)
   *     — returns { ok, schema, version, totalSnapshots, steps, cumulativeTotals }
   *
   * Endpoint: GET /api/v1/missions/proof-index/evict/policy/aggregate/history [V380-T01]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 380 (R2).
   * Sacred untouched (R1). V361..V379 preserved (R6).
   *
   * @version 380.0.0
   */

  const AGG = require('./evictionTelemetryAggregator379.js');

  const AGGREGATOR_HISTORY_VERSION_380 = '380.0.0';
  const AGGREGATOR_HISTORY_SCHEMA_380  = 'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history/v380';

  /**
   * Build a timeline of fleet-health changes by taking N snapshots of
   * aggregateEvictionTelemetry379 and comparing successive pairs.
   *
   * @param {object[]|object} policyRepos
   *   — Repos as accepted by aggregateEvictionTelemetry379.
   * @param {function|object[]} snapshotFn
   *   — Either (a) a synchronous zero-arg function that returns a snapshot
   *     (called opts.snapshotCount times), or (b) an already-collected array
   *     of aggregation results.
   * @param {{
   *   snapshotCount?: number,
   *   windowMs?: number,
   *   now?: number,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalSnapshots: number,
   *   steps: Array<{
   *     stepIndex: number,
   *     fromTs: string, toTs: string,
   *     blockedBefore: number, blockedAfter: number,
   *     allHealthyBefore: boolean, allHealthyAfter: boolean,
   *     degraded: boolean,
   *     recovered: boolean,
   *   }>,
   *   cumulativeTotals: { totalDegraded: number, totalRecovered: number, stableSteps: number },
   * }}
   */
  function buildAggregatorHistory380(policyRepos, snapshotFn, opts) {
    const o   = opts || {};
    const now = (typeof o.now === 'number') ? o.now : Date.now();

    let snapshots = [];

    if (Array.isArray(snapshotFn)) {
      // Pre-collected array of aggregation results
      snapshots = snapshotFn;
    } else if (typeof snapshotFn === 'function') {
      const count = (typeof o.snapshotCount === 'number' && o.snapshotCount >= 2)
        ? o.snapshotCount
        : 2;
      for (let i = 0; i < count; i++) {
        try {
          snapshots.push(snapshotFn());
        } catch (e) {
          // Record error snapshot
          snapshots.push({ ok: false, error: e.message, aggregateTs: new Date(now).toISOString() });
        }
      }
    } else if (policyRepos && !snapshotFn) {
      // No snapshotFn — take a single live snapshot
      snapshots = [AGG.aggregateEvictionTelemetry379(policyRepos, { windowMs: o.windowMs, now })];
    } else {
      return {
        ok:             false,
        error:          'snapshotFn must be a function or an array of pre-collected snapshots',
        schema:         AGGREGATOR_HISTORY_SCHEMA_380,
        version:        AGGREGATOR_HISTORY_VERSION_380,
        totalSnapshots: 0,
        steps:          [],
        cumulativeTotals: { totalDegraded: 0, totalRecovered: 0, stableSteps: 0 },
      };
    }

    if (snapshots.length < 2) {
      return {
        ok:             false,
        error:          'at least 2 snapshots are required to build a history',
        schema:         AGGREGATOR_HISTORY_SCHEMA_380,
        version:        AGGREGATOR_HISTORY_VERSION_380,
        totalSnapshots: snapshots.length,
        steps:          [],
        cumulativeTotals: { totalDegraded: 0, totalRecovered: 0, stableSteps: 0 },
      };
    }

    const steps = [];
    let totalDegraded = 0, totalRecovered = 0, stableSteps = 0;

    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      const blockedBefore   = prev.blocked  || 0;
      const blockedAfter    = curr.blocked  || 0;
      const allHealthyBefore = prev.allHealthy !== false;
      const allHealthyAfter  = curr.allHealthy !== false;
      const degraded  = !allHealthyAfter && allHealthyBefore;
      const recovered =  allHealthyAfter && !allHealthyBefore;
      const stable    = !degraded && !recovered;

      if (degraded)  totalDegraded++;
      if (recovered) totalRecovered++;
      if (stable)    stableSteps++;

      steps.push({
        stepIndex:        i,
        fromTs:           prev.aggregateTs || null,
        toTs:             curr.aggregateTs || null,
        blockedBefore,
        blockedAfter,
        blockedDelta:     blockedAfter - blockedBefore,
        notBlockedBefore: prev.notBlocked || 0,
        notBlockedAfter:  curr.notBlocked || 0,
        totalRepos:       curr.totalRepos || 0,
        allHealthyBefore,
        allHealthyAfter,
        degraded,
        recovered,
        stable,
      });
    }

    return {
      ok:             true,
      schema:         AGGREGATOR_HISTORY_SCHEMA_380,
      version:        AGGREGATOR_HISTORY_VERSION_380,
      totalSnapshots: snapshots.length,
      steps,
      cumulativeTotals: { totalDegraded, totalRecovered, stableSteps },
    };
  }

  module.exports = {
    AGGREGATOR_HISTORY_VERSION_380,
    AGGREGATOR_HISTORY_SCHEMA_380,
    buildAggregatorHistory380,
  };
  