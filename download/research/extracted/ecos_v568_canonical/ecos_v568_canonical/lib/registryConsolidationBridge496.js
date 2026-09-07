'use strict';
/**
 * src/lib/registryConsolidationBridge496.js — ECOS V496 (Phase P375) — Registry↔Analyzer Bridge
 *
 * CONNECTION > ADDITION. Two of our own modules were disconnected and contradicting:
 *   • V463 canonicalCapabilityRegistry — the GATE every agent is told to consult — still
 *     reports the NAIVE retirable count (~188), counting inheritance chains as collapsible.
 *   • V495 consolidationAnalyzer — knows the TRUTH (chains can't be naively re-exported;
 *     only parallel duplicates can) but isn't wired into the GATE agents actually call.
 * Result: agents follow the GATE, attempt to collapse a chain, and BREAK THE BUILD.
 *
 * This bridge fuses them so the GATE finally tells the truth:
 *   honestDuplication496  — every tower tagged inheritance-chain | parallel-duplicate, with
 *                           the HONEST retirable count (chains → 0 until manually flattened).
 *   honestShouldBuild496  — the V463 verdict PLUS a safety classification: for a 'consolidate'
 *                           recommendation, says whether it's collapse-safe (parallel) or
 *                           needs-manual-flatten (chain) — so no agent breaks the build again.
 *
 * Reuses registry463 + analyzer495 (no reinvention). Pure JS, no new deps (R3/R6).
 * Read-only over sacred. Version-suffixed (…496).
 *
 * @version 496.0.0
 */

const fs = require('fs');
const path = require('path');

const BRIDGE_VERSION_496 = '496.0.0';
let _Reg496 = null, _An496 = null;
try { _Reg496 = require('./canonicalCapabilityRegistry463.js'); } catch (_) {}
try { _An496 = require('./consolidationAnalyzer495.js'); } catch (_) {}

class BridgeError496 extends Error {
  constructor(msg, code) { super(msg); this.name = 'BridgeError496'; this.code = code || 'BRIDGE_ERROR'; this.statusCode = 400; }
}

function _towerFiles496(libDir, base) {
  try {
    return fs.readdirSync(libDir).filter(f => new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d+\\.js$').test(f)).map(f => path.join(libDir, f));
  } catch (_) { return []; }
}
// is a module name pinned by tests or required by code (excluding its own file)?
function _isReferenced496(rootDir, name) {
  try {
    const out = require('child_process').execSync(
      `grep -rlE "require\\(['\\"]\\./(lib/)?${name}['\\"]" --include=*.js "${rootDir}" 2>/dev/null | grep -v node_modules | grep -v "/${name}.js" | head -1`,
      { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (_) { return false; }
}

/**
 * Honest duplication report: V463 towers, each classified by V495, with the TRUE retirable count.
 * @param {{ libDir?:string, rootDir?:string }} opts
 */
function honestDuplication496(opts = {}) {
  if (!_Reg496 || !_An496) throw new BridgeError496('registry463 + analyzer495 required', 'NO_DEPS');
  const libDir = opts.libDir || (process.cwd() + '/lib');
  const rootDir = opts.rootDir || process.cwd();
  const reg = _Reg496.buildRegistry463({ libDirs: [libDir] });
  const dup = _Reg496.duplicationReport463(reg);

  let chains = 0, parallels = 0, trueRetirable = 0;
  const towers = (dup.towers || []).map(t => {
    const files = _towerFiles496(libDir, t.base);
    const cls = _An496.classifyTower495(t.base, files);
    const r = _An496.trueRetirable495(cls, (n) => _isReferenced496(rootDir, n));
    if (cls.kind === 'inheritance-chain') chains++; else parallels++;
    trueRetirable += r.retirable;
    return { base: t.base, versions: t.versions, kind: cls.kind, canonical: cls.head,
      naiveRetirable: t.retirable, trueRetirable: r.retirable, safeToCollapse: cls.kind === 'parallel-duplicate' && r.retirable > 0 };
  });

  return {
    version: BRIDGE_VERSION_496,
    naiveRetirable_V463: dup.totalRetirableModules,        // the misleading number
    honestRetirable: trueRetirable,                         // the safe number
    inheritanceChains: chains, parallelDuplicateTowers: parallels,
    towers,
    correction: `V463 reported ${dup.totalRetirableModules} retirable; only ${trueRetirable} are SAFE (rest are inheritance chains that break the build if naively re-exported).`,
  };
}

/**
 * Honest should-build: the V463 verdict + a safety classification so no agent breaks the build.
 * @param {string} capability  @param {{ libDir?:string, rootDir?:string }} opts
 */
function honestShouldBuild496(capability, opts = {}) {
  if (!_Reg496 || !_An496) throw new BridgeError496('registry463 + analyzer495 required', 'NO_DEPS');
  if (!capability) throw new BridgeError496('capability required', 'BAD_ARGS');
  const libDir = opts.libDir || (process.cwd() + '/lib');
  const rootDir = opts.rootDir || process.cwd();
  const reg = _Reg496.buildRegistry463({ libDirs: [libDir] });
  const gate = _Reg496.shouldBuildNew463(reg, capability);

  let safety = null;
  if (gate.recommend === 'consolidate' && gate.family && gate.family.base) {
    const cls = _An496.classifyTower495(gate.family.base, _towerFiles496(libDir, gate.family.base));
    const r = _An496.trueRetirable495(cls, (n) => _isReferenced496(rootDir, n));
    safety = {
      towerKind: cls.kind,
      method: cls.kind === 'inheritance-chain' ? 'manual-flatten' : 'thin-re-export',
      collapseSafeNow: cls.kind === 'parallel-duplicate' && r.retirable > 0,
      guidance: cls.kind === 'inheritance-chain'
        ? `${gate.family.base} is an INHERITANCE CHAIN (head requires lowers). Do NOT thin-re-export — that breaks the build. Flatten the chain into the head first, then retire the rest.`
        : `${gate.family.base} is parallel duplicates — safe to thin re-export of the canonical (${cls.head}).`,
    };
  }
  return { version: BRIDGE_VERSION_496, capability, recommend: gate.recommend, existing: gate.existing, reason: gate.reason, safety };
}

module.exports = {
  BRIDGE_VERSION_496, BridgeError496,
  honestDuplication496, honestShouldBuild496,
};
