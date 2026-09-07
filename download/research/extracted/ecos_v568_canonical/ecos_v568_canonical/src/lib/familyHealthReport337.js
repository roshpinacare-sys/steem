'use strict';
/**
 * src/lib/familyHealthReport337.js — ECOS V337 (Phase P225) — Family Health Dashboard
 *
 * Aggregates four signals per capability family into a single health score:
 *   1. Lineage depth  — how many versioned copies exist (deeper = more redundancy debt)
 *   2. Drift status   — whether the latest version dropped symbols older versions exported
 *   3. Oracle equivalence — behavioral equivalence % between oldest and newest versions
 *   4. Bad-version count — how many versions are marked bad in the dispatcher registry
 *
 * Two concrete functions shipped:
 *
 *   buildFamilyHealthReport337(graph, detectFn, planFn, opts)
 *     -> full per-family health table with composite score [0..100] and tier classification.
 *
 *   diffDispatcherRegistry337(oldReg, newReg)
 *     -> delta between two registry snapshots: families that gained/lost bad versions.
 *
 * Pure / dependency-free (R6); all new public identifiers end with `337` (R2).
 * Sacred files untouched (R1). No new npm deps (R3).
 *
 * @version 337.0.0
 */

const FAMILY_HEALTH_VERSION_337 = '337.0.0';

/* helpers */
function _baseName337(name) { return String(name).replace(/\d+$/, ''); }
function _versionOf337(name) { const m = String(name).match(/(\d{2,4})$/); return m ? parseInt(m[1], 10) : null; }

function _buildLineageMap337(graph) {
  const fam = new Map();
  for (const [moduleName, entry] of (graph.byModule || new Map()).entries()) {
    const base    = _baseName337(moduleName);
    const version = _versionOf337(moduleName);
    if (!fam.has(base)) fam.set(base, { base, versions: [] });
    fam.get(base).versions.push({
      version, module: moduleName,
      symbols: new Set((entry.symbols || []).map(_baseName337)),
    });
  }
  for (const entry of fam.values()) {
    entry.versions.sort((a, b) => (a.version ?? -1) - (b.version ?? -1));
  }
  return fam;
}

/* scoreFamily337 */
function scoreFamily337(familyEntry) {
  let score = 100;
  const breakdown = {};

  const depthPenalty = Math.max(0, (familyEntry.depth || 0) - 3) * 5;
  score -= depthPenalty;
  breakdown.depthPenalty = -depthPenalty;

  const driftPenalty = familyEntry.drifted ? 20 : 0;
  score -= driftPenalty;
  breakdown.driftPenalty = -driftPenalty;

  const symbolPenalty = Math.min(15, (familyEntry.droppedSymbolCount || 0) * 3);
  score -= symbolPenalty;
  breakdown.symbolPenalty = -symbolPenalty;

  const badPenalty = Math.min(25, (familyEntry.badVersionCount || 0) * 8);
  score -= badPenalty;
  breakdown.badVersionPenalty = -badPenalty;

  const oracleBonus = familyEntry.equivalencePct != null
    ? Math.round((familyEntry.equivalencePct / 100) * 10)
    : 0;
  score += oracleBonus;
  breakdown.oracleBonus = +oracleBonus;

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 75 ? 'healthy' : score >= 45 ? 'watch' : 'critical';
  return { score, tier, breakdown };
}

/* buildFamilyHealthReport337 */
function buildFamilyHealthReport337(graph, detectFn, planFn, opts) {
  opts = opts || {};
  const badRegistry    = opts.badRegistry    || {};
  const equivalenceMap = opts.equivalenceMap || {};
  const topN           = typeof opts.topN === 'number' && opts.topN > 0 ? opts.topN : null;
  const sortBy         = opts.sortBy || 'score';

  if (!graph || !graph.byModule) {
    return {
      ok: false, families: [], totalFamilies: 0,
      criticalCount: 0, watchCount: 0, healthyCount: 0,
      summary: 'V337 health report: invalid graph (byModule missing)',
      version: FAMILY_HEALTH_VERSION_337,
    };
  }

  const lineageMap = _buildLineageMap337(graph);

  let driftByFamily = {};
  try {
    const driftResult = detectFn(graph);
    for (const f of (driftResult.families || [])) {
      driftByFamily[f.base] = { drifted: true, droppedSymbols: f.droppedSymbols || [], severity: f.severity || 'unknown' };
    }
  } catch (_) {}

  let retirableByFamily = {};
  try {
    const plan = planFn(graph);
    for (const f of (plan.families || [])) {
      retirableByFamily[f.base] = { retirableCount: (f.safe_retire || []).length, keepVersion: f.latest };
    }
  } catch (_) {}

  const families = [];
  for (const [base, lineage] of lineageMap.entries()) {
    const versionedMembers = lineage.versions.filter(v => v.version != null);
    const depth  = versionedMembers.length;
    const drift  = driftByFamily[base]  || { drifted: false, droppedSymbols: [], severity: null };
    const retire = retirableByFamily[base] || { retirableCount: 0, keepVersion: null };
    const badVersions    = (badRegistry[base] || []);
    const equivalencePct = equivalenceMap[base] != null ? equivalenceMap[base] : null;

    const scoreResult = scoreFamily337({
      depth, drifted: drift.drifted, droppedSymbolCount: drift.droppedSymbols.length,
      badVersionCount: badVersions.length, equivalencePct,
    });

    families.push({
      base, depth,
      versions:       versionedMembers.map(v => v.version),
      latestVersion:  versionedMembers.length ? versionedMembers[versionedMembers.length - 1].version : null,
      drifted:        drift.drifted,
      droppedSymbols: drift.droppedSymbols,
      severity:       drift.severity,
      retirableCount: retire.retirableCount,
      keepVersion:    retire.keepVersion,
      badVersions, badVersionCount: badVersions.length,
      equivalencePct,
      score: scoreResult.score, tier: scoreResult.tier, breakdown: scoreResult.breakdown,
    });
  }

  if (sortBy === 'depth')       families.sort((a, b) => b.depth - a.depth);
  else if (sortBy === 'name')   families.sort((a, b) => a.base.localeCompare(b.base));
  else                          families.sort((a, b) => a.score - b.score); // worst first

  const result        = topN != null ? families.slice(0, topN) : families;
  const criticalCount = result.filter(f => f.tier === 'critical').length;
  const watchCount    = result.filter(f => f.tier === 'watch').length;
  const healthyCount  = result.filter(f => f.tier === 'healthy').length;

  return {
    ok: true, families: result,
    totalFamilies: lineageMap.size, reportedCount: result.length,
    criticalCount, watchCount, healthyCount,
    summary: `V337 health report: ${result.length} families — ${criticalCount} critical, ${watchCount} watch, ${healthyCount} healthy`,
    version: FAMILY_HEALTH_VERSION_337,
  };
}

/* diffDispatcherRegistry337 */
function diffDispatcherRegistry337(oldReg, newReg) {
  oldReg = oldReg || {};
  newReg = newReg || {};

  const allBases = new Set([...Object.keys(oldReg), ...Object.keys(newReg)]);
  const gained = [], lost = [], unchanged = [];

  for (const base of allBases) {
    const oldSet = new Set((oldReg[base] || []).map(Number));
    const newSet = new Set((newReg[base] || []).map(Number));
    const addedVersions   = [...newSet].filter(v => !oldSet.has(v)).sort((a, b) => a - b);
    const removedVersions = [...oldSet].filter(v => !newSet.has(v)).sort((a, b) => a - b);
    if (addedVersions.length)   gained.push({ base, versions: addedVersions });
    if (removedVersions.length) lost.push({ base, versions: removedVersions });
    if (!addedVersions.length && !removedVersions.length) unchanged.push(base);
  }

  gained.sort((a, b) => a.base.localeCompare(b.base));
  lost.sort((a, b) => a.base.localeCompare(b.base));
  unchanged.sort();

  const totalGained = gained.reduce((s, f) => s + f.versions.length, 0);
  const totalLost   = lost.reduce((s, f) => s + f.versions.length, 0);
  const netChange   = totalGained - totalLost;

  return {
    gained, lost, unchanged,
    totalGained, totalLost, netChange,
    summary: `V337 registry diff: +${totalGained} bad versions gained, -${totalLost} recovered, net ${netChange > 0 ? '+' : ''}${netChange}`,
    version: FAMILY_HEALTH_VERSION_337,
  };
}

module.exports = {
  FAMILY_HEALTH_VERSION_337,
  buildFamilyHealthReport337,
  diffDispatcherRegistry337,
  scoreFamily337,
  _baseName337,
  _versionOf337,
};
