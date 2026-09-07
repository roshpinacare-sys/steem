'use strict';
  /**
   * lib/comparatorHistory378.js — ECOS V378 (Phase P266)
   *
   * DIRECTION 3: Comparator history.
   *
   * `buildComparatorHistory378(snaps, opts)` chains `compareIndexSnapshots377`
   * across an ordered array of signed proof-index snapshots and emits a
   * cumulative timeline of adds, removes, and changes — useful for
   * multi-restart audit trails and external auditor workflows.
   *
   * Exports:
   *   HISTORY_VERSION_378         — '378.0.0'
   *   HISTORY_SCHEMA_378          — schema tag
   *   buildComparatorHistory378(snaps, opts)
   *     — pure; returns { ok, schema, version, totalSnapshots, steps,
   *         cumulativeTotals, identical }
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/history [V378-T03]
   *
   * Pure (R3 — no new npm deps). All new identifiers end with 378 (R2).
   * Sacred untouched (R1). V361..V377 preserved (R6).
   *
   * @version 378.0.0
   */

  const CMP = require('./snapshotComparator377.js');

  const HISTORY_VERSION_378 = '378.0.0';
  const HISTORY_SCHEMA_378  = 'ecos.integrity.mission.proof.index.comparator.history/v378';

  /**
   * Chain compareIndexSnapshots377 across an ordered array of signed
   * proof-index snapshots and build a cumulative timeline.
   *
   * @param {object[]} snaps  — array of signed snapshots in chronological order
   * @param {{ includeDetails?: boolean }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalSnapshots: number,
   *   steps: Array<{
   *     stepIndex: number,
   *     added: string[],
   *     removed: string[],
   *     changed: Array<{missionId, hashA, hashB}>,
   *     unchanged: number,
   *     totalA: number,
   *     totalB: number,
   *     identical: boolean,
   *   }>,
   *   cumulativeTotals: {
   *     totalAdded: number,
   *     totalRemoved: number,
   *     totalChanged: number,
   *     identicalSteps: number,
   *   },
   *   identical: boolean,
   * }}
   */
  function buildComparatorHistory378(snaps, opts) {
    const o = opts || {};

    if (!Array.isArray(snaps) || snaps.length < 2) {
      return {
        ok:    false,
        error: 'snaps must be an array of at least 2 signed snapshots',
        schema:         HISTORY_SCHEMA_378,
        version:        HISTORY_VERSION_378,
        totalSnapshots: Array.isArray(snaps) ? snaps.length : 0,
        steps:          [],
        cumulativeTotals: {
          totalAdded:     0,
          totalRemoved:   0,
          totalChanged:   0,
          identicalSteps: 0,
        },
        identical: false,
      };
    }

    const steps = [];
    let totalAdded     = 0;
    let totalRemoved   = 0;
    let totalChanged   = 0;
    let identicalSteps = 0;

    for (let i = 0; i < snaps.length - 1; i++) {
      const snapA = snaps[i];
      const snapB = snaps[i + 1];

      const diff = CMP.compareIndexSnapshots377(snapA, snapB, { includeDetails: o.includeDetails });

      const step = {
        stepIndex: i,
        added:     diff.added     || [],
        removed:   diff.removed   || [],
        changed:   diff.changed   || [],
        unchanged: diff.unchanged || 0,
        totalA:    diff.totalA    || 0,
        totalB:    diff.totalB    || 0,
        identical: diff.identical || false,
      };

      steps.push(step);
      totalAdded   += step.added.length;
      totalRemoved += step.removed.length;
      totalChanged += step.changed.length;
      if (step.identical) identicalSteps++;
    }

    const allIdentical = totalAdded === 0 && totalRemoved === 0 && totalChanged === 0;

    return {
      ok:             true,
      schema:         HISTORY_SCHEMA_378,
      version:        HISTORY_VERSION_378,
      totalSnapshots: snaps.length,
      steps,
      cumulativeTotals: {
        totalAdded,
        totalRemoved,
        totalChanged,
        identicalSteps,
      },
      identical: allIdentical,
    };
  }

  module.exports = {
    HISTORY_VERSION_378,
    HISTORY_SCHEMA_378,
    buildComparatorHistory378,
  };
  