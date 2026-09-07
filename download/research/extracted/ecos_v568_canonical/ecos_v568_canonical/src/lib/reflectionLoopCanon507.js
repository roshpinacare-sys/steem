'use strict';
/**
 * src/lib/reflectionLoopCanon507.js — ECOS V507
 *
 * Canonical facade for the reflectionLoop tower (V263–V268).
 *
 * Tower structure (6 modules):
 *   reflectionLoop263–267: thin re-exports of reflectionLoop268 (parallel-dup, safe)
 *   reflectionLoop268:     canonical tip — the only real implementation
 *
 * Purpose:
 *   • Single import point: `require('./reflectionLoopCanon507')` instead of
 *     any specific reflectionLoop<NNN>.js.
 *   • Exposes getCanonInfo507() metadata for the registry and debtScore pipeline.
 *   • Feeds registryConsolidationBridge496 with tower info so
 *     honestRetirable is accurately counted.
 *   • Zero new npm deps. All identifiers end in 507 (except re-exports which end in 268).
 *
 * @version 507.0.0
 */

// Delegate to canonical tip
const _base507 = require('./reflectionLoop268.js');

const {
  ReflectionLoop268,
  defaultReflectionLoop268,
  MAX_RETRIES_268,
  SELF_CORRECT_RATE_268,
} = _base507;

// ── Tower metadata ────────────────────────────────────────────────────────────

const TOWER_NAME_507      = 'reflectionLoop';
const CANONICAL_TIP_507   = 268;
const CHAIN_BASE_507      = 263;
const TOWER_MEMBERS_507   = [263, 264, 265, 266, 267, 268];
const TOWER_KIND_507      = 'parallel-duplicate'; // ALL 263-267 re-export 268 — safe to consolidate
const RETIRABLE_COUNT_507 = TOWER_MEMBERS_507.length - 1; // 5 thin re-exports are retirable

function getCanonInfo507() {
  return {
    version:        '507.0.0',
    file:           'reflectionLoopCanon507.js',
    tower:          TOWER_NAME_507,
    towerKind:      TOWER_KIND_507,
    canonicalTip:   CANONICAL_TIP_507,
    chainBase:      CHAIN_BASE_507,
    chainLength:    TOWER_MEMBERS_507.length,
    members:        TOWER_MEMBERS_507,
    retirableCount: RETIRABLE_COUNT_507,
    role:           'canonical facade — import this, not reflectionLoop268 directly',
    importGuidance: 'require(\'./reflectionLoopCanon507\') for all new code. reflectionLoop263-267 are parallel re-exports of 268 and may be safely retired.',
    delegatesTo:    'reflectionLoop268.js',
  };
}

/**
 * Convenience: return a tower descriptor compatible with consolidationAnalyzer495's
 * safeCollapsePlan495() input format.
 * @returns {object}
 */
function getTowerDescriptor507() {
  return {
    name:    TOWER_NAME_507,
    kind:    TOWER_KIND_507,
    base:    String(CHAIN_BASE_507),
    tip:     String(CANONICAL_TIP_507),
    members: TOWER_MEMBERS_507.map(String),
  };
}

// ── Exports (identical surface to reflectionLoop268 + canon metadata) ─────────

module.exports = {
  // Re-exports from canonical tip (268)
  ReflectionLoop268,
  defaultReflectionLoop268,
  MAX_RETRIES_268,
  SELF_CORRECT_RATE_268,
  // Canon metadata (507)
  getCanonInfo507,
  getTowerDescriptor507,
  TOWER_NAME_507,
  CANONICAL_TIP_507,
  TOWER_KIND_507,
  RETIRABLE_COUNT_507,
};
