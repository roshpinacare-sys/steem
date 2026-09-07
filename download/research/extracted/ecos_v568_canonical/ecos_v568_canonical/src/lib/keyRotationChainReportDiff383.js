'use strict';
/**
 * lib/keyRotationChainReportDiff383.js — ECOS V383 (Phase P271)
 *
 * DIRECTION 2: Key rotation chain report diff.
 *
 * diffKeyRotationChainReports383(reportA, reportB) is a pure function that
 * compares two buildKeyRotationChainReport382 outputs side-by-side, reporting
 * which step classifications changed between the two chains.
 *
 * Exports:
 *   CHAIN_REPORT_DIFF_VERSION_383
 *   CHAIN_REPORT_DIFF_SCHEMA_383
 *   diffKeyRotationChainReports383(reportA, reportB, opts)
 *     — returns { ok, schema, version, totalSteps, changedSteps, unchangedSteps,
 *         steps, summary, narrative }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/key-rotation/manifest/chain/report/diff [V383-T02]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 383 (R2).
 * Sacred untouched (R1). V361..V382 preserved (R6).
 *
 * @version 383.0.0
 */

const CHAIN_REPORT_DIFF_VERSION_383 = '383.0.0';
const CHAIN_REPORT_DIFF_SCHEMA_383  = 'ecos.integrity.mission.proof.index.snapshot.signing.key.rotation.chain.report.diff/v383';

/**
 * Compare two buildKeyRotationChainReport382 results step-by-step and report
 * which step classifications changed.
 *
 * @param {object} reportA — result of buildKeyRotationChainReport382(...)
 * @param {object} reportB — result of buildKeyRotationChainReport382(...)
 * @param {{
 *   includeUnchanged?: boolean,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   totalSteps: number,
 *   changedSteps: number,
 *   unchangedSteps: number,
 *   firstChangeStep: number|null,
 *   steps: Array<{
 *     stepIndex: number,
 *     changed: boolean,
 *     kindA: string|null,
 *     kindB: string|null,
 *     descriptionA: string|null,
 *     descriptionB: string|null,
 *   }>,
 *   summary: {
 *     statsA: object,
 *     statsB: object,
 *     statsDelta: object,
 *     identical: boolean,
 *   },
 *   narrative: string,
 * }}
 */
function diffKeyRotationChainReports383(reportA, reportB, opts) {
  const o = opts || {};

  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: CHAIN_REPORT_DIFF_SCHEMA_383, version: CHAIN_REPORT_DIFF_VERSION_383,
    totalSteps: 0, changedSteps: 0, unchangedSteps: 0, firstChangeStep: null,
    steps: [],
    summary: { statsA: {}, statsB: {}, statsDelta: {}, identical: false },
    narrative: '',
  });

  if (!reportA || !Array.isArray(reportA.stepReports)) {
    return errorResult('reportA must be a buildKeyRotationChainReport382 result with stepReports array');
  }
  if (!reportB || !Array.isArray(reportB.stepReports)) {
    return errorResult('reportB must be a buildKeyRotationChainReport382 result with stepReports array');
  }

  // Build index maps by stepIndex
  const mapA = new Map();
  const mapB = new Map();
  for (const s of reportA.stepReports) mapA.set(s.stepIndex, s);
  for (const s of reportB.stepReports) mapB.set(s.stepIndex, s);

  const allIndexes = new Set([...mapA.keys(), ...mapB.keys()]);
  // Also include steps that were identical (not in stepReports if includeIdentical=false)
  // We compare totals via totalSteps
  const maxStep = Math.max(reportA.totalSteps || 0, reportB.totalSteps || 0);

  const steps = [];
  let changedSteps = 0;
  let unchangedSteps = 0;
  let firstChangeStep = null;
  const includeUnchanged = o.includeUnchanged !== false;

  for (let i = 1; i <= maxStep; i++) {
    const sA = mapA.get(i) || null;
    const sB = mapB.get(i) || null;
    const kindA = sA ? sA.kind : 'identical';
    const kindB = sB ? sB.kind : 'identical';
    const changed = kindA !== kindB;

    if (changed) {
      changedSteps++;
      if (firstChangeStep === null) firstChangeStep = i;
    } else {
      unchangedSteps++;
    }

    if (changed || includeUnchanged) {
      steps.push({
        stepIndex:    i,
        changed,
        kindA,
        kindB,
        descriptionA: sA ? sA.description : `Step ${i}: no change (identical manifest)`,
        descriptionB: sB ? sB.description : `Step ${i}: no change (identical manifest)`,
      });
    }
  }

  // Stats delta
  const statsA = reportA.stats || {};
  const statsB = reportB.stats || {};
  const statsDelta = {};
  const allKeys = new Set([...Object.keys(statsA), ...Object.keys(statsB)]);
  for (const k of allKeys) {
    statsDelta[k] = (statsB[k] || 0) - (statsA[k] || 0);
  }

  const identical = changedSteps === 0;

  // Build narrative
  const lines = [];
  lines.push(`Key rotation chain report diff — ${maxStep} step(s) compared.`);
  if (identical) {
    lines.push('Both chain reports are identical: all step classifications match.');
  } else {
    lines.push(`${changedSteps} step(s) changed classification, ${unchangedSteps} step(s) unchanged.`);
    if (firstChangeStep !== null) lines.push(`First change at step ${firstChangeStep}.`);
    for (const s of steps.filter(s => s.changed).slice(0, 3)) {
      lines.push(`  Step ${s.stepIndex}: ${s.kindA} → ${s.kindB}.`);
    }
    if (changedSteps > 3) lines.push(`  ... and ${changedSteps - 3} more.`);
  }
  const narrative = lines.join(' ');

  return {
    ok: true,
    schema:  CHAIN_REPORT_DIFF_SCHEMA_383,
    version: CHAIN_REPORT_DIFF_VERSION_383,
    totalSteps:    maxStep,
    changedSteps,
    unchangedSteps,
    firstChangeStep,
    steps,
    summary: { statsA, statsB, statsDelta, identical },
    narrative,
  };
}

module.exports = {
  CHAIN_REPORT_DIFF_VERSION_383,
  CHAIN_REPORT_DIFF_SCHEMA_383,
  diffKeyRotationChainReports383,
};
