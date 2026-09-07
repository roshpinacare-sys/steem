'use strict';
/**
 * src/lib/canonBridgePatch508.js — ECOS V508 (Phase P376)
 *
 * CONNECTION: reflectionLoopCanon507 ↔ registryConsolidationBridge496
 *
 * PROBLEM (inherited from V507 NEXT_SESSION):
 *   registryConsolidationBridge496 auto-classifies reflectionLoop as
 *   'inheritance-chain' (trueRetirable: 0, safeToCollapse: false) by
 *   inspecting the raw require() graph.
 *   BUT reflectionLoopCanon507 carries authoritative ground-truth:
 *   kind='parallel-duplicate', 5 thin re-exports are genuinely retirable.
 *
 * SOLUTION:
 *   This module collects Tower Descriptor objects from all registered
 *   Canon facades, then produces a PATCHED honest-duplication report where
 *   each tower's kind/retirable is overridden by its Canon facade if one
 *   exists.  No bridge or canon code is modified.
 *
 * USAGE:
 *   const p = require('./canonBridgePatch508');
 *   const report = p.getPatchedDuplication508(opts);   // merged report
 *   const diff   = p.getKindDiff508();                 // what changed vs bridge
 *
 * CANON REGISTRY (V508):
 *   Only reflectionLoopCanon507 is wired here. Future canon facades should
 *   call registerCanonFacade508(descriptor) in their own init, or be added
 *   to CANON_FACADES_508 below.
 *
 * All identifiers end in 508. Zero new npm deps. @version 508.0.0
 */

const PATCH_VERSION_508 = '508.0.0';

// ── Built-in registry of known Canon facades ─────────────────────────────────
// Each entry is a getTowerDescriptor() result: { name, kind, base, tip, members }
// Add future facades here (or call registerCanonFacade508 at runtime).

const _canonRegistry508 = new Map();

let _reflCanon508 = null;
try {
  _reflCanon508 = require('./reflectionLoopCanon507.js');
  _canonRegistry508.set('reflectionLoop', _reflCanon508.getTowerDescriptor507());
} catch (_) {}

/**
 * Register an external canon facade descriptor at runtime.
 * @param {{ name:string, kind:string, base:string, tip:string, members:string[] }} descriptor
 */
function registerCanonFacade508(descriptor) {
  if (!descriptor || !descriptor.name) throw new Error('[canonBridgePatch508] descriptor.name required');
  if (!['parallel-duplicate','inheritance-chain'].includes(descriptor.kind))
    throw new Error('[canonBridgePatch508] descriptor.kind must be parallel-duplicate | inheritance-chain');
  _canonRegistry508.set(descriptor.name, descriptor);
}

/**
 * Return all registered canon facade descriptors.
 */
function listRegisteredFacades508() {
  return Array.from(_canonRegistry508.values());
}

// ── Bridge loader (lazy) ──────────────────────────────────────────────────────
let _bridge508 = null;
function _getBridge508() {
  if (!_bridge508) {
    _bridge508 = require('./registryConsolidationBridge496.js');
  }
  return _bridge508;
}

/**
 * getPatchedDuplication508(opts) → bridge report with Canon-overridden kinds.
 *
 * For every tower in the bridge report that has a registered Canon facade,
 * override { kind, trueRetirable, safeToCollapse } with the authoritative
 * values from the facade descriptor.  All other towers are unchanged.
 *
 * @param {{ libDir?:string, rootDir?:string }} opts
 * @returns {{
 *   version: string,
 *   patchedTowers: number,
 *   towers: Array,
 *   bridgeVersion: string,
 *   canonFacades: number,
 *   honestRetirable: number,
 * }}
 */
function getPatchedDuplication508(opts = {}) {
  const bridge = _getBridge508();
  const raw = bridge.honestDuplication496(opts);

  let patched = 0;
  const towers = raw.towers.map(t => {
    const facade = _canonRegistry508.get(t.base);
    if (!facade) return { ...t, _patchedBy508: null };

    // Canon says how many are TRULY retirable
    const canonRetirable = facade.members.length - 1; // tip stays, rest retirable
    const isParallel = facade.kind === 'parallel-duplicate';

    patched++;
    return {
      ...t,
      kind:           facade.kind,
      trueRetirable:  isParallel ? canonRetirable : 0,
      safeToCollapse: isParallel && canonRetirable > 0,
      _patchedBy508:  `canonFacade:${facade.name}@V${facade.tip}`,
      _bridgeOriginal: { kind: t.kind, trueRetirable: t.trueRetirable, safeToCollapse: t.safeToCollapse },
    };
  });

  const honestRetirable = towers.reduce((s, t) => s + (t.trueRetirable || 0), 0);

  return {
    version:          PATCH_VERSION_508,
    bridgeVersion:    raw.version || bridge.BRIDGE_VERSION_496,
    canonFacades:     _canonRegistry508.size,
    patchedTowers:    patched,
    naiveRetirable:   raw.naiveRetirable_V463,
    honestRetirable,
    inheritanceChains: towers.filter(t => t.kind === 'inheritance-chain').length,
    parallelDuplicates: towers.filter(t => t.kind === 'parallel-duplicate').length,
    towers,
    correction: `V496 reported ${raw.naiveRetirable_V463} naive retirable; after Canon patch: ${honestRetirable} are SAFE.`,
  };
}

/**
 * getKindDiff508(opts) → towers where Canon disagrees with Bridge.
 * Useful for validating that canon facades are not misconfigured.
 */
function getKindDiff508(opts = {}) {
  const bridge = _getBridge508();
  const raw = bridge.honestDuplication496(opts);
  const diffs = [];
  for (const t of raw.towers) {
    const facade = _canonRegistry508.get(t.base);
    if (!facade) continue;
    if (facade.kind !== t.kind) {
      diffs.push({
        tower:        t.base,
        bridgeKind:   t.kind,
        canonKind:    facade.kind,
        bridgeRetirable: t.trueRetirable,
        canonRetirable:  facade.kind === 'parallel-duplicate' ? facade.members.length - 1 : 0,
      });
    }
  }
  return { version: PATCH_VERSION_508, corrections: diffs.length, diffs };
}

module.exports = {
  PATCH_VERSION_508,
  registerCanonFacade508,
  listRegisteredFacades508,
  getPatchedDuplication508,
  getKindDiff508,
};
