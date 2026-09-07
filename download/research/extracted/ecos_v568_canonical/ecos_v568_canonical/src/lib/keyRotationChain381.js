'use strict';
  /**
   * lib/keyRotationChain381.js — ECOS V381 (Phase P269)
   *
   * DIRECTION 2: Key rotation manifest chain.
   *
   * buildKeyRotationChain381(manifests, opts) chains diffKeyRotationManifests380
   * across an ordered array of manifests and returns a cumulative rotation audit
   * trail with per-step diffs and totals.
   *
   * Exports:
   *   KEY_CHAIN_VERSION_381
   *   KEY_CHAIN_SCHEMA_381
   *   buildKeyRotationChain381(manifests, opts)
   *     — pure; returns { ok, schema, version, totalManifests, totalSteps,
   *         activeKeyChangeCount, steps, cumulativeTotals }
   *
   * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain [V381-T02]
   *
   * Pure (R3 no new npm deps). All new identifiers end with 381 (R2).
   * Sacred untouched (R1). V361..V380 preserved (R6).
   *
   * @version 381.0.0
   */

  const KD380 = require('./keyRotationManifestDiff380.js');

  const KEY_CHAIN_VERSION_381 = '381.0.0';
  const KEY_CHAIN_SCHEMA_381  = 'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain/v381';

  /**
   * Chain diffKeyRotationManifests380 across an ordered array of manifests and
   * return a cumulative rotation audit trail.
   *
   * @param {object[]} manifests — ordered array of V378 key rotation manifests
   * @param {{
   *   includeUnchanged?: boolean,
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   schema: string,
   *   version: string,
   *   totalManifests: number,
   *   totalSteps: number,
   *   activeKeyChangeCount: number,
   *   steps: Array<{
   *     stepIndex: number,
   *     activeKeyBefore: string|null,
   *     activeKeyAfter: string|null,
   *     activeKeyChanged: boolean,
   *     added: string[],
   *     removed: string[],
   *     unchanged: string[],
   *     identical: boolean,
   *     diffTs: string,
   *   }>,
   *   cumulativeTotals: {
   *     totalAdded: number,
   *     totalRemoved: number,
   *     activeKeyChangeCount: number,
   *     identicalSteps: number,
   *   },
   * }}
   */
  function buildKeyRotationChain381(manifests, opts) {
    const o = opts || {};

    const errorResult = (msg) => ({
      ok: false, error: msg,
      schema: KEY_CHAIN_SCHEMA_381, version: KEY_CHAIN_VERSION_381,
      totalManifests: 0, totalSteps: 0, activeKeyChangeCount: 0, steps: [],
      cumulativeTotals: { totalAdded: 0, totalRemoved: 0, activeKeyChangeCount: 0, identicalSteps: 0 },
    });

    if (!Array.isArray(manifests)) {
      return errorResult('manifests must be an array');
    }
    if (manifests.length < 2) {
      return errorResult('at least 2 manifests are required to build a chain');
    }

    const steps = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    let activeKeyChangeCount = 0;
    let identicalSteps = 0;

    for (let i = 1; i < manifests.length; i++) {
      const diff = KD380.diffKeyRotationManifests380(manifests[i - 1], manifests[i], {
        includeUnchanged: o.includeUnchanged !== false,
      });

      if (!diff.ok) {
        return errorResult(`step ${i}: ${diff.error || 'diff failed'}`);
      }

      totalAdded         += diff.added.length;
      totalRemoved       += diff.removed.length;
      if (diff.activeKeyChanged) activeKeyChangeCount++;
      if (diff.identical)        identicalSteps++;

      steps.push({
        stepIndex:        i,
        activeKeyBefore:  diff.activeKeyBefore,
        activeKeyAfter:   diff.activeKeyAfter,
        activeKeyChanged: diff.activeKeyChanged,
        added:            diff.added,
        removed:          diff.removed,
        unchanged:        diff.unchanged,
        identical:        diff.identical,
        diffTs:           diff.diffTs,
      });
    }

    return {
      ok: true,
      schema:  KEY_CHAIN_SCHEMA_381,
      version: KEY_CHAIN_VERSION_381,
      totalManifests:      manifests.length,
      totalSteps:          steps.length,
      activeKeyChangeCount,
      steps,
      cumulativeTotals: {
        totalAdded,
        totalRemoved,
        activeKeyChangeCount,
        identicalSteps,
      },
    };
  }

  module.exports = {
    KEY_CHAIN_VERSION_381,
    KEY_CHAIN_SCHEMA_381,
    buildKeyRotationChain381,
  };
  