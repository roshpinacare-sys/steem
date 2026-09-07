'use strict';
/**
 * src/lib/capabilityLineage334.js — ECOS V334 (Phase P222) — Capability Lineage & Self-Healing
 *
 * BREAKTHROUGH REFRAME: ECOS carries 169 capability families that exist in many
 * versions (e.g. agentDispatchBridge 246→253, up to 36 deep). That redundancy
 * looks like pure debt — but a full *versioned lineage of every capability* is an
 * asset. This layer turns the weakness into four advantages, all built statically
 * on the V287 mesh graph (no require() → no side effects):
 *
 *   1. detectInterfaceDrift334 — flag families whose LATEST version DROPPED a
 *      symbol older versions exported = a silent breaking-change risk surfaced.
 *   2. resolveBestVersion334 — route to the newest HEALTHY version, falling back
 *      down the lineage if the latest is known-bad = self-healing from redundancy.
 *   3. planConsolidation334 — retire only the older versions the latest fully
 *      supersets ("safe_retire"); flag the rest for review = safe shrinking.
 *   4. compareVersions334 — run two versions of a pure capability over the same
 *      inputs and diff outputs = a built-in regression oracle (opt-in, fn refs).
 *
 * Pure + dependency-free (R6); version-suffixed (…334, BUG-L safe).
 * @version 334.0.0
 */

const LINEAGE_VERSION_334 = '334.0.0';

function _baseName334(name) { return String(name).replace(/\d+$/, ''); }
function _versionOf334(name) { const m = String(name).match(/(\d{2,4})$/); return m ? parseInt(m[1], 10) : null; }

/**
 * Build capability families from a V287 CapabilityGraph287 (uses its static
 * byModule index). Returns Map<familyKey, { base, versions:[{version, module, symbols:Set}] }>.
 */
function buildLineages334(graph) {
  if (!graph || !graph.byModule) throw new Error('a built CapabilityGraph287 is required');
  const fam = new Map();
  for (const [moduleName, entry] of graph.byModule.entries()) {
    const base = _baseName334(moduleName);
    const version = _versionOf334(moduleName);
    if (!fam.has(base)) fam.set(base, { base, versions: [] });
    fam.get(base).versions.push({
      version, module: moduleName,
      symbols: new Set((entry.symbols || []).map(_baseName334)),
    });
  }
  for (const f of fam.values()) f.versions.sort((a, b) => (a.version || 0) - (b.version || 0));
  return fam;
}

function lineageReport334(graph) {
  const fam = buildLineages334(graph);
  let multi = 0, deepest = 0, staleVersions = 0;
  for (const f of fam.values()) {
    const vs = f.versions.filter(v => v.version != null);
    if (vs.length > 1) { multi++; staleVersions += vs.length - 1; deepest = Math.max(deepest, vs.length); }
  }
  return { families: fam.size, multiVersionFamilies: multi, deepestLineage: deepest,
    retirableCandidates: staleVersions, version: LINEAGE_VERSION_334 };
}

/**
 * Detect interface drift: for each multi-version family, any symbol present in an
 * EARLIER version but missing from the LATEST version is flagged (silent removal).
 */
function detectInterfaceDrift334(graph) {
  const fam = buildLineages334(graph);
  const drifts = [];
  for (const f of fam.values()) {
    const vs = f.versions.filter(v => v.version != null);
    if (vs.length < 2) continue;
    const latest = vs[vs.length - 1];
    const dropped = new Set();
    for (let i = 0; i < vs.length - 1; i++) {
      for (const sym of vs[i].symbols) if (!latest.symbols.has(sym)) dropped.add(sym);
    }
    if (dropped.size > 0) {
      drifts.push({ base: f.base, latest: latest.module, latestVersion: latest.version,
        droppedSymbols: [...dropped], severity: dropped.size >= 3 ? 'high' : 'medium' });
    }
  }
  drifts.sort((a, b) => b.droppedSymbols.length - a.droppedSymbols.length);
  return { drifted: drifts.length, families: drifts };
}

/**
 * Self-healing version resolver. Given a family base and a set of known-bad
 * versions, return the newest version NOT marked bad (falling back down lineage).
 * @returns {{ base, chosen, chosenVersion, fellBack, healthyVersions } | null}
 */
function resolveBestVersion334(graph, base, opts = {}) {
  const fam = buildLineages334(graph).get(_baseName334(base));
  if (!fam) return null;
  const bad = new Set((opts.knownBad || []).map(Number));
  const vs = fam.versions.filter(v => v.version != null).sort((a, b) => b.version - a.version);
  const healthy = vs.filter(v => !bad.has(v.version));
  if (healthy.length === 0) return { base: fam.base, chosen: null, chosenVersion: null, fellBack: false, healthyVersions: [] };
  const chosen = healthy[0];
  const latest = vs[0];
  return {
    base: fam.base, chosen: chosen.module, chosenVersion: chosen.version,
    fellBack: chosen.version !== latest.version,           // true = self-healed past a bad latest
    healthyVersions: healthy.map(v => v.version),
  };
}

/**
 * Consolidation planner. A family is "safe_retire" when the latest version's symbol
 * set is a SUPERSET of every older version (nothing is lost by retiring the old ones);
 * otherwise "review" (the latest dropped something — see detectInterfaceDrift334).
 */
function planConsolidation334(graph) {
  const fam = buildLineages334(graph);
  const safeRetire = [], review = [];
  let modulesRetirable = 0;
  for (const f of fam.values()) {
    const vs = f.versions.filter(v => v.version != null);
    if (vs.length < 2) continue;
    const latest = vs[vs.length - 1];
    let superset = true;
    for (let i = 0; i < vs.length - 1; i++) {
      for (const sym of vs[i].symbols) if (!latest.symbols.has(sym)) { superset = false; break; }
      if (!superset) break;
    }
    const olderModules = vs.slice(0, -1).map(v => v.module);
    if (superset) { safeRetire.push({ base: f.base, keep: latest.module, retire: olderModules }); modulesRetirable += olderModules.length; }
    else { review.push({ base: f.base, keep: latest.module, reason: 'latest dropped symbols present in older versions' }); }
  }
  return {
    safeRetireFamilies: safeRetire.length, reviewFamilies: review.length,
    modulesRetirable,
    estimatedSurfaceReductionPct: graph.byModule.size ? Math.round((modulesRetirable / graph.byModule.size) * 1000) / 10 : 0,
    safeRetire: safeRetire.slice(0, 100), review: review.slice(0, 100),
  };
}

/**
 * Regression oracle: run two versions of a PURE capability over the same inputs and
 * diff outputs. Opt-in — the caller passes the two function refs (no auto-require).
 * @returns {{ total, identical, diverged, mismatches:[] }}
 */
function compareVersions334(fnOld, fnNew, inputs) {
  if (typeof fnOld !== 'function' || typeof fnNew !== 'function') throw new Error('two functions are required');
  if (!Array.isArray(inputs)) throw new Error('inputs must be an array of argument-arrays');
  let identical = 0; const mismatches = [];
  for (let i = 0; i < inputs.length; i++) {
    const args = Array.isArray(inputs[i]) ? inputs[i] : [inputs[i]];
    let a, b, ea = null, eb = null;
    try { a = fnOld(...args); } catch (e) { ea = e.message; }
    try { b = fnNew(...args); } catch (e) { eb = e.message; }
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa === sb && ea === eb) identical++;
    else mismatches.push({ index: i, args, old: ea ? { error: ea } : a, new: eb ? { error: eb } : b });
  }
  return { total: inputs.length, identical, diverged: mismatches.length, mismatches };
}

module.exports = {
  LINEAGE_VERSION_334,
  buildLineages334, lineageReport334, detectInterfaceDrift334,
  resolveBestVersion334, planConsolidation334, compareVersions334,
  _baseName334, _versionOf334,
};
