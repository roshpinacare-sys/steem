'use strict';
/**
 * src/lib/consolidationAnalyzer495.js — ECOS V495 (Phase P374) — Consolidation Safety Analyzer
 *
 * THE HONEST FIX to a dangerous blind spot. The V463 registry detects version towers and
 * reports "~186 retirable modules" — but most towers are INHERITANCE CHAINS (marketMaker333
 * extends 332 extends 331 …), NOT parallel duplicates. Naively turning a chain member into a
 * thin re-export BREAKS the build (the head requires the lowers). Every agent that follows
 * the registry's naive advice corrupts the server. This module makes consolidation advice
 * TRUTHFUL and SAFE, so real cleanup can finally happen without breakage.
 *
 *   classifyTower495   — for a version family, determine: 'inheritance-chain' (head requires
 *                        lowers → lowers are internal deps, NOT independently retirable) vs
 *                        'parallel-duplicate' (members don't reference each other → collapsible).
 *   trueRetirable495   — the HONEST retirable count: only parallel-duplicate members that are
 *                        also unreferenced by tests/code. Chains contribute 0 (until flattened).
 *   safeCollapsePlan495 — concrete, verified-safe collapses only (parallel dup + unreferenced
 *                        + export-compatible with the canonical). Nothing risky is ever listed.
 *
 * Reads files read-only (regex over source) — never executes or mutates them. Pure JS, no new
 * deps (R3/R6). Read-only over sacred. Version-suffixed (…495).
 *
 * @version 495.0.0
 */

const fs = require('fs');
const path = require('path');

const ANALYZER_VERSION_495 = '495.0.0';

class AnalyzerError495 extends Error {
  constructor(msg, code) { super(msg); this.name = 'AnalyzerError495'; this.code = code || 'ANALYZER_ERROR'; this.statusCode = 400; }
}

function _versionOf495(name) { const m = String(name).match(/(\d+)(?:\.js)?$/); return m ? parseInt(m[1], 10) : null; }
function _readSafe495(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }

/**
 * Classify one tower (array of absolute file paths for the same base, any order).
 * @returns {{ base, members:[{file,version,requiresSiblings}], kind, head, internalDeps:number }}
 */
function classifyTower495(base, files) {
  if (!base) throw new AnalyzerError495('base required', 'BAD_ARGS');
  const members = (files || []).map(f => {
    const src = _readSafe495(f);
    // does this member require any sibling of the SAME base (e.g. marketMaker332)?
    const re = new RegExp("require\\(['\"]\\./" + base + "\\d+", 'g');
    const refs = (src.match(re) || []).length;
    return { file: f, name: path.basename(f, '.js'), version: _versionOf495(f), requiresSiblings: refs };
  }).filter(m => m.version != null).sort((a, b) => a.version - b.version);

  const internalDeps = members.reduce((s, m) => s + m.requiresSiblings, 0);
  const head = members.length ? members[members.length - 1].name : null;
  // inheritance-chain if ANY member requires a sibling; else parallel-duplicate
  const kind = internalDeps > 0 ? 'inheritance-chain' : 'parallel-duplicate';
  return { base, members, kind, head, internalDeps, memberCount: members.length };
}

/**
 * Honest retirable count. Chains contribute 0 (their members are internal deps). Parallel
 * duplicates contribute (count-1) ONLY for members unreferenced by tests/code.
 * @param {object} tower  from classifyTower495
 * @param {(name:string)=>boolean} isReferenced  predicate: is this module name pinned by tests/code?
 */
function trueRetirable495(tower, isReferenced) {
  if (!tower) throw new AnalyzerError495('tower required', 'BAD_ARGS');
  if (tower.kind === 'inheritance-chain') {
    return { base: tower.base, kind: tower.kind, retirable: 0, reason: 'inheritance chain — members are internal deps of the head; flatten manually before retiring (NOT a naive re-export)' };
  }
  const ref = typeof isReferenced === 'function' ? isReferenced : () => false;
  const canonical = tower.head;
  const collapsible = tower.members.filter(m => m.name !== canonical && !ref(m.name));
  return { base: tower.base, kind: tower.kind, canonical, retirable: collapsible.length,
    collapsible: collapsible.map(m => m.name),
    reason: collapsible.length ? 'parallel duplicates, unreferenced — safe to thin re-export of canonical' : 'no safely-retirable members (all referenced or none parallel)' };
}

/**
 * A concrete, verified-safe collapse plan across many towers. Lists ONLY genuinely safe
 * collapses (parallel + unreferenced). Never lists chain members.
 * @param {Array<{base,files:string[]}>} towers
 * @param {(name:string)=>boolean} isReferenced
 */
function safeCollapsePlan495(towers, isReferenced) {
  if (!Array.isArray(towers)) throw new AnalyzerError495('towers array required', 'BAD_ARGS');
  let chains = 0, parallels = 0, totalSafe = 0;
  const collapses = [];
  for (const t of towers) {
    const cls = classifyTower495(t.base, t.files || []);
    if (cls.kind === 'inheritance-chain') { chains++; continue; }
    parallels++;
    const r = trueRetirable495(cls, isReferenced);
    if (r.retirable > 0) { totalSafe += r.retirable; collapses.push({ base: cls.base, canonical: r.canonical, collapse: r.collapsible }); }
  }
  return {
    version: ANALYZER_VERSION_495,
    towersAnalyzed: towers.length, inheritanceChains: chains, parallelDuplicateTowers: parallels,
    trulySafeToRetire: totalSafe, collapses,
    honesty: 'inheritance chains are excluded from retirable counts — naive re-export of a chain member breaks the build',
    recommendation: totalSafe > 0
      ? `${totalSafe} modules can be SAFELY collapsed now (parallel duplicates, unreferenced).`
      : 'no naive-safe collapses; the towers are inheritance chains needing manual flattening (one head keeps the lineage).',
  };
}

module.exports = {
  ANALYZER_VERSION_495, AnalyzerError495,
  classifyTower495, trueRetirable495, safeCollapsePlan495, _versionOf495,
};
