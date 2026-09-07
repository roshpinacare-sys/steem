'use strict';
/**
 * src/lib/canonicalCapabilityRegistry463.js — ECOS V463 (Phase P351) — Canonical Capability Registry
 *
 * THE ANTI-DUPLICATION IMMUNE SYSTEM. The system grew to 600+ modules with real version
 * towers (marketMaker ×36, providerAdapters ×17, …) because the autonomous brain (the
 * Diamond V453/V462) and the Orchestrator (V437) were BLIND to what already exists — so
 * agents kept adding parallel versions. The cure already half-existed but was DISCONNECTED:
 * moduleMesh287 (capability graph) and capabilityLineage334 (version families + consolidation
 * plans). V463 composes them into ONE registry the brain queries BEFORE proposing/building.
 *
 * This is connection > addition: not a new capability, but the layer that lets the system
 * SEE itself and stop fragmenting.
 *
 *   buildRegistry463      — fuse the mesh capability graph + lineage families into one index.
 *   resolveCapability463  — "does a capability for X already exist?" → the canonical/latest
 *                           match (so the Orchestrator/Diamond ROUTE to it, not rebuild it).
 *   duplicationReport463  — version towers ranked, with a consolidation plan (from lineage334).
 *   shouldBuildNew463     — THE GATE: given an intended capability, recommend reuse |
 *                           consolidate | build_new, with the existing matches and a reason.
 *
 * Reuses moduleMesh287 + capabilityLineage334 (no reinvention). Pure JS, no new deps (R3/R6).
 * Read-only over sacred. Version-suffixed (…463).
 *
 * @version 463.0.0
 */

const REGISTRY_VERSION_463 = '463.0.0';
let _Mesh463 = null, _Lineage463 = null;
try { _Mesh463 = require('./moduleMesh287.js'); } catch (_) {}
try { _Lineage463 = require('./capabilityLineage334.js'); } catch (_) {}

class RegistryError463 extends Error {
  constructor(msg, code) { super(msg); this.name = 'RegistryError463'; this.code = code || 'REGISTRY_ERROR'; this.statusCode = 400; }
}

function _baseName463(name) {
  // strip a trailing version number + .js → family base (e.g. marketMaker298 → marketMaker)
  return String(name).replace(/\.js$/, '').replace(/[0-9]+$/, '');
}

/**
 * Build the unified registry by composing the mesh graph and lineage families.
 * @param {{ libDirs?:string[], graph?:object }} opts
 */
function buildRegistry463(opts = {}) {
  if (!_Mesh463 || !_Mesh463.CapabilityGraph287) throw new RegistryError463('moduleMesh287 unavailable', 'NO_MESH');
  const libDirs = opts.libDirs || [process.cwd() + '/lib'];
  let graph = opts.graph || null;
  if (!graph) { graph = new _Mesh463.CapabilityGraph287(); try { graph.build(libDirs); } catch (e) { throw new RegistryError463('graph build failed: ' + e.message, 'GRAPH_BUILD'); } }

  // lineage families (version towers) — reuse lineage334 if present. Returns a Map(base → info).
  let lineMap = null;
  try { if (_Lineage463 && _Lineage463.buildLineages334) lineMap = _Lineage463.buildLineages334(graph); } catch (_) {}

  // normalise families into {base, versions[], count, canonical}
  const families = [];
  if (lineMap && typeof lineMap.entries === 'function') {
    for (const [base, info] of lineMap.entries()) {
      const v = (info && (info.versions || info.members || info.healthyVersions)) || [];
      const versions = Array.isArray(v) ? v : [];
      let canonical = info && (info.canonical || info.chosen || info.latest) || null;
      if (!canonical) { try { const r = _Lineage463.resolveBestVersion334(graph, base); canonical = r && r.chosen; } catch (_) {} }
      families.push({ base, versions, count: versions.length || (info && info.count) || 0, canonical });
    }
  }

  return {
    version: REGISTRY_VERSION_463,
    builtAt: new Date().toISOString(),
    graph,
    families,
    familyCount: families.length,
    capabilityCount: (typeof graph.size === 'function' ? graph.size() : (graph.capabilities ? graph.capabilities.length : null)),
  };
}

/**
 * Resolve whether a capability for `query` already exists — returns the canonical/latest
 * match so callers ROUTE to it instead of building a parallel version.
 */
function resolveCapability463(registry, query) {
  if (!registry || !registry.graph) throw new RegistryError463('built registry required', 'NO_REGISTRY');
  if (!query) throw new RegistryError463('query required', 'BAD_ARGS');
  let matches = [];
  try {
    const g = registry.graph;
    const res = (typeof g.searchLatest === 'function') ? g.searchLatest(query) : (typeof g.search === 'function' ? g.search(query) : null);
    if (Array.isArray(res)) matches = res;
    else if (res && Array.isArray(res.results)) matches = res.results;
    else if (res && res.best) matches = [res.best].concat(res.alternatives || []);
  } catch (_) {}
  const best = matches.length ? matches[0] : null;
  const bestId = best ? (best.id || best.name || best.module || String(best)) : null;
  // map to its family (so caller sees the whole tower, not just one node)
  let family = null;
  if (bestId) {
    const moduleSeg = String(bestId).split('.')[0];       // module, not method
    const b = _baseName463(moduleSeg);
    family = registry.families.find(f => f.base === b)
      || registry.families.find(f => moduleSeg.indexOf(f.base) === 0)   // substring fallback
      || null;
  }
  return {
    exists: !!best,
    canonical: bestId,
    matchCount: matches.length,
    alternatives: matches.slice(1, 5).map(m => m.id || m.name || m.module || String(m)),
    family: family ? { base: family.base, versions: family.count, canonical: family.canonical } : null,
  };
}

/** Version towers ranked by size, with a consolidation plan (from lineage334 if available). */
function duplicationReport463(registry, opts = {}) {
  if (!registry) throw new RegistryError463('built registry required', 'NO_REGISTRY');
  const minVersions = opts.minVersions || 3;
  const towers = (registry.families || []).filter(f => f.count >= minVersions).sort((a, b) => b.count - a.count)
    .map(f => ({ base: f.base, versions: f.count, canonical: f.canonical, retirable: Math.max(0, f.count - 1) }));
  const totalRetirable = towers.reduce((s, t) => s + t.retirable, 0);
  let plan = null;
  try { if (_Lineage463 && _Lineage463.planConsolidation334) plan = _Lineage463.planConsolidation334(registry.graph) || null; } catch (_) {}
  return {
    version: REGISTRY_VERSION_463,
    towerCount: towers.length,
    towers: towers.slice(0, 25),
    totalRetirableModules: totalRetirable,
    consolidationPlanAvailable: !!plan,
    recommendation: towers.length
      ? `consolidate the largest towers first (e.g. ${towers[0].base} ×${towers[0].versions}); ~${totalRetirable} modules retirable as thin re-exports of canonical`
      : 'no significant duplication towers',
  };
}

/**
 * THE GATE the Diamond/Orchestrator call BEFORE proposing or building a capability.
 * @returns {{ recommend:'reuse'|'consolidate'|'build_new', existing, reason }}
 */
function shouldBuildNew463(registry, intendedCapability) {
  if (!registry) throw new RegistryError463('built registry required', 'NO_REGISTRY');
  if (!intendedCapability) throw new RegistryError463('intendedCapability required', 'BAD_ARGS');
  const resolved = resolveCapability463(registry, intendedCapability);
  if (resolved.exists && resolved.family && resolved.family.versions >= 3) {
    return { recommend: 'consolidate', existing: resolved.canonical, family: resolved.family,
      reason: `a ${resolved.family.versions}-version tower already exists for this role — consolidate to the canonical (${resolved.family.canonical}) instead of adding another version` };
  }
  if (resolved.exists) {
    return { recommend: 'reuse', existing: resolved.canonical,
      reason: `a capability already exists (${resolved.canonical}) — route to it instead of building a parallel one` };
  }
  return { recommend: 'build_new', existing: null, reason: 'no existing capability matches — building new is justified' };
}

module.exports = {
  REGISTRY_VERSION_463, RegistryError463,
  buildRegistry463, resolveCapability463, duplicationReport463, shouldBuildNew463, _baseName463,
};
