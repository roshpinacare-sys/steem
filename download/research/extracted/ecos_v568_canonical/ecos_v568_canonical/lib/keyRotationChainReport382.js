'use strict';
/**
 * lib/keyRotationChainReport382.js — ECOS V382 (Phase P270)
 *
 * DIRECTION 2: Key rotation chain summary report.
 *
 * buildKeyRotationChainReport382(chain) is a read-only projection of a
 * buildKeyRotationChain381 result that classifies each step as `rotation`,
 * `revocation`, `expansion`, or `identical` and emits an operator-readable
 * narrative summary.
 *
 * Exports:
 *   KEY_CHAIN_REPORT_VERSION_382
 *   KEY_CHAIN_REPORT_SCHEMA_382
 *   buildKeyRotationChainReport382(chain, opts)
 *     — returns { ok, schema, version, totalSteps, stepReports, narrative,
 *         stats }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report [V382-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 382 (R2).
 * Sacred untouched (R1). V361..V381 preserved (R6).
 *
 * @version 382.0.0
 */

const KRC381 = require('./keyRotationChain381.js');

const KEY_CHAIN_REPORT_VERSION_382 = '382.0.0';
const KEY_CHAIN_REPORT_SCHEMA_382  = 'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain.report/v382';

/**
 * Classify a single chain step.
 * - rotation:  activeKeyChanged AND no net change in key count (swap)
 * - revocation: removed > 0 AND added === 0
 * - expansion:  added > 0 AND removed === 0
 * - mixed:      added > 0 AND removed > 0 (and activeKeyChanged)
 * - identical:  no change at all
 * @param {object} step
 * @returns {'rotation'|'revocation'|'expansion'|'mixed'|'identical'}
 */
function _classifyStep382(step) {
  const added   = (step.added   || []).length;
  const removed = (step.removed || []).length;
  const changed = step.activeKeyChanged;

  if (step.identical)          return 'identical';
  if (added > 0 && removed > 0) return 'mixed';
  if (changed)                  return 'rotation';
  if (removed > 0)              return 'revocation';
  if (added > 0)                return 'expansion';
  return 'rotation'; // fallback: active key swapped with no tracked key movement
}

/**
 * Build a one-line human-readable description for a step.
 * @param {object} step
 * @param {'rotation'|'revocation'|'expansion'|'mixed'|'identical'} kind
 * @returns {string}
 */
function _describeStep382(step, kind) {
  const added   = (step.added   || []).length;
  const removed = (step.removed || []).length;

  switch (kind) {
    case 'identical':
      return `Step ${step.stepIndex}: no change (identical manifest)`;
    case 'rotation':
      return `Step ${step.stepIndex}: active key rotated from ${step.activeKeyBefore || '(none)'} → ${step.activeKeyAfter || '(none)'}`;
    case 'revocation':
      return `Step ${step.stepIndex}: ${removed} key(s) revoked (no new keys added)`;
    case 'expansion':
      return `Step ${step.stepIndex}: ${added} new key(s) added (no keys removed)`;
    case 'mixed':
      return `Step ${step.stepIndex}: ${added} key(s) added, ${removed} key(s) removed` +
        (step.activeKeyChanged ? `, active key rotated to ${step.activeKeyAfter || '(none)'}` : '');
    default:
      return `Step ${step.stepIndex}: unknown change type`;
  }
}

/**
 * Build a read-only summary report from a buildKeyRotationChain381 result.
 *
 * @param {object|object[]} chainOrManifests
 *   — a pre-built chain from buildKeyRotationChain381(), OR an array of
 *     manifests to build the chain on-demand.
 * @param {{
 *   includeIdentical?: boolean,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalSteps: number,
 *   stepReports: Array<{
 *     stepIndex: number,
 *     kind: 'rotation'|'revocation'|'expansion'|'mixed'|'identical',
 *     description: string,
 *     activeKeyBefore: string|null,
 *     activeKeyAfter: string|null,
 *     added: string[],
 *     removed: string[],
 *     diffTs: string,
 *   }>,
 *   narrative: string,
 *   stats: {
 *     rotations: number,
 *     revocations: number,
 *     expansions: number,
 *     mixed: number,
 *     identical: number,
 *   },
 * }}
 */
function buildKeyRotationChainReport382(chainOrManifests, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: KEY_CHAIN_REPORT_SCHEMA_382, version: KEY_CHAIN_REPORT_VERSION_382,
    totalSteps: 0, stepReports: [], narrative: '',
    stats: { rotations: 0, revocations: 0, expansions: 0, mixed: 0, identical: 0 },
  });

  // Accept either a pre-built chain or an array of manifests
  let chain = chainOrManifests;
  if (Array.isArray(chainOrManifests)) {
    chain = KRC381.buildKeyRotationChain381(chainOrManifests, {
      includeUnchanged: o.includeUnchanged !== false,
    });
  }

  if (!chain || chain.ok === false) {
    return errorResult((chain && chain.error) || 'chain must be a valid buildKeyRotationChain381 result');
  }
  if (!Array.isArray(chain.steps)) {
    return errorResult('chain.steps must be an array');
  }

  const includeIdentical = o.includeIdentical !== false;
  const stepReports = [];
  const stats = { rotations: 0, revocations: 0, expansions: 0, mixed: 0, identical: 0 };

  for (const step of chain.steps) {
    const kind = _classifyStep382(step);
    stats[kind === 'rotation' ? 'rotations' :
          kind === 'revocation' ? 'revocations' :
          kind === 'expansion'  ? 'expansions'  :
          kind === 'mixed'      ? 'mixed'        : 'identical']++;

    if (!includeIdentical && kind === 'identical') continue;

    stepReports.push({
      stepIndex:       step.stepIndex,
      kind,
      description:     _describeStep382(step, kind),
      activeKeyBefore: step.activeKeyBefore || null,
      activeKeyAfter:  step.activeKeyAfter  || null,
      added:           step.added   || [],
      removed:         step.removed || [],
      diffTs:          step.diffTs  || null,
    });
  }

  // Build narrative
  const lines = [];
  const totals = chain.cumulativeTotals || {};
  lines.push(`Key rotation chain report — ${chain.totalManifests} manifests, ${chain.totalSteps} step(s).`);
  if (chain.activeKeyChangeCount > 0) {
    lines.push(`Active key changed ${chain.activeKeyChangeCount} time(s) across the chain.`);
  }
  if (totals.totalAdded > 0)   lines.push(`${totals.totalAdded} key(s) were added in total.`);
  if (totals.totalRemoved > 0) lines.push(`${totals.totalRemoved} key(s) were removed in total.`);
  if (totals.identicalSteps > 0) {
    lines.push(`${totals.identicalSteps} step(s) were identical (no change).`);
  }
  if (stats.rotations  > 0) lines.push(`${stats.rotations} pure rotation(s) (active key swap).`);
  if (stats.revocations > 0) lines.push(`${stats.revocations} revocation(s) (keys removed only).`);
  if (stats.expansions  > 0) lines.push(`${stats.expansions} expansion(s) (keys added only).`);
  if (stats.mixed       > 0) lines.push(`${stats.mixed} mixed operation(s) (keys added and removed).`);
  if (chain.activeKeyChangeCount === 0 && totals.identicalSteps === chain.totalSteps) {
    lines.push('All steps were identical — the manifest did not change.');
  }

  const narrative = lines.join(' ');

  return {
    ok:           true,
    schema:       KEY_CHAIN_REPORT_SCHEMA_382,
    version:      KEY_CHAIN_REPORT_VERSION_382,
    totalSteps:   chain.totalSteps,
    stepReports,
    narrative,
    stats,
  };
}

module.exports = {
  KEY_CHAIN_REPORT_VERSION_382,
  KEY_CHAIN_REPORT_SCHEMA_382,
  buildKeyRotationChainReport382,
};
