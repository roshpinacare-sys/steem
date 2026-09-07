'use strict';
  /**
   * lib/aggregatorHistoryDiff381.js — ECOS V381 (Phase P269)
   *
   * DIRECTION 1: Aggregator history diff.
   *
   * diffAggregatorHistories381(historyA, historyB, opts) is a pure function that
   * compares two V380 aggregator history timelines step-by-step and reports where
   * the fleet-health trajectories diverged — useful for A/B eviction policy
   * comparisons.
   *
   * Exports:
   *   AGG_HISTORY_DIFF_VERSION_381
   *   AGG_HISTORY_DIFF_SCHEMA_381
   *   diffAggregatorHistories381(historyA, historyB, opts)
   *     — pure; returns { ok, schema, version, totalSteps, divergedSteps,
   *         matchedSteps, steps, summary }
   *
   * Endpoint: POST /api/v1/missions/proof-index/evict/policy/aggregate/history/diff [V381-T01]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 381 (R2).
   * Sacred untouched (R1). V361..V380 preserved (R6).
   *
   * @version 381.0.0
   */

  const AGG_HISTORY_DIFF_VERSION_381 = '381.0.0';
  const AGG_HISTORY_DIFF_SCHEMA_381  = 'ecos.integrity.mission.proof.index.eviction.policy.aggregate.history.diff/v381';

  /**
   * Compare two V380 aggregator history timelines step-by-step and report where
   * the fleet-health trajectories diverged.
   *
   * @param {object} historyA  — result of buildAggregatorHistory380(...)
   * @param {object} historyB  — result of buildAggregatorHistory380(...)
   * @param {{
   *   includeMatched?: boolean,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalSteps: number,
   *   divergedSteps: number,
   *   matchedSteps: number,
   *   firstDivergenceStep: number|null,
   *   steps: Array<{
   *     stepIndex: number,
   *     diverged: boolean,
   *     degradedA: boolean, degradedB: boolean,
   *     recoveredA: boolean, recoveredB: boolean,
   *     stableA: boolean, stableB: boolean,
   *     blockedDeltaA: number, blockedDeltaB: number,
   *     blockedDeltaDiff: number,
   *   }>,
   *   summary: {
   *     cumulativeDeltaDiff: number,
   *     aMoreDegraded: boolean,
   *     bMoreDegraded: boolean,
   *     identical: boolean,
   *   },
   * }}
   */
  function diffAggregatorHistories381(historyA, historyB, opts) {
    const o = opts || {};

    const errorResult = (msg) => ({
      ok: false, error: msg,
      schema: AGG_HISTORY_DIFF_SCHEMA_381,
      version: AGG_HISTORY_DIFF_VERSION_381,
      totalSteps: 0, divergedSteps: 0, matchedSteps: 0,
      firstDivergenceStep: null, steps: [],
      summary: { cumulativeDeltaDiff: 0, aMoreDegraded: false, bMoreDegraded: false, identical: false },
    });

    if (!historyA || !Array.isArray(historyA.steps)) {
      return errorResult('historyA must be a V380 aggregator history result with a steps array');
    }
    if (!historyB || !Array.isArray(historyB.steps)) {
      return errorResult('historyB must be a V380 aggregator history result with a steps array');
    }

    const stepsA = historyA.steps;
    const stepsB = historyB.steps;
    const totalSteps = Math.max(stepsA.length, stepsB.length);

    if (totalSteps === 0) {
      return {
        ok: true,
        schema: AGG_HISTORY_DIFF_SCHEMA_381, version: AGG_HISTORY_DIFF_VERSION_381,
        totalSteps: 0, divergedSteps: 0, matchedSteps: 0, firstDivergenceStep: null, steps: [],
        summary: { cumulativeDeltaDiff: 0, aMoreDegraded: false, bMoreDegraded: false, identical: true },
      };
    }

    const steps = [];
    let divergedSteps = 0;
    let matchedSteps = 0;
    let firstDivergenceStep = null;
    let cumulativeDeltaDiff = 0;
    let aDegradedCount = 0;
    let bDegradedCount = 0;

    for (let i = 0; i < totalSteps; i++) {
      const a = stepsA[i] || {};
      const b = stepsB[i] || {};

      const degradedA  = !!a.degraded;
      const degradedB  = !!b.degraded;
      const recoveredA = !!a.recovered;
      const recoveredB = !!b.recovered;
      const stableA    = !!a.stable;
      const stableB    = !!b.stable;
      const blockedDeltaA = typeof a.blockedDelta === 'number' ? a.blockedDelta : 0;
      const blockedDeltaB = typeof b.blockedDelta === 'number' ? b.blockedDelta : 0;
      const blockedDeltaDiff = blockedDeltaB - blockedDeltaA;

      const diverged = (degradedA !== degradedB) || (recoveredA !== recoveredB) || (blockedDeltaA !== blockedDeltaB);

      if (diverged) {
        divergedSteps++;
        if (firstDivergenceStep === null) firstDivergenceStep = i + 1;
      } else {
        matchedSteps++;
      }

      if (degradedA)  aDegradedCount++;
      if (degradedB)  bDegradedCount++;
      cumulativeDeltaDiff += blockedDeltaDiff;

      const includeMatched = o.includeMatched !== false;
      if (diverged || includeMatched) {
        steps.push({
          stepIndex:       i + 1,
          diverged,
          degradedA,       degradedB,
          recoveredA,      recoveredB,
          stableA,         stableB,
          blockedDeltaA,   blockedDeltaB,
          blockedDeltaDiff,
          fromTsA:         a.fromTs || null,
          fromTsB:         b.fromTs || null,
          toTsA:           a.toTs   || null,
          toTsB:           b.toTs   || null,
        });
      }
    }

    const identical = divergedSteps === 0;

    return {
      ok: true,
      schema: AGG_HISTORY_DIFF_SCHEMA_381,
      version: AGG_HISTORY_DIFF_VERSION_381,
      totalSteps,
      divergedSteps,
      matchedSteps,
      firstDivergenceStep,
      steps,
      summary: {
        cumulativeDeltaDiff,
        aMoreDegraded: aDegradedCount > bDegradedCount,
        bMoreDegraded: bDegradedCount > aDegradedCount,
        identical,
      },
    };
  }

  module.exports = {
    AGG_HISTORY_DIFF_VERSION_381,
    AGG_HISTORY_DIFF_SCHEMA_381,
    diffAggregatorHistories381,
  };
  