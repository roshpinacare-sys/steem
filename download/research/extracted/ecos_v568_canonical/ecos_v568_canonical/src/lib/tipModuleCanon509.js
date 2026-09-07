'use strict';
/**
 * src/lib/tipModuleCanon509.js — ECOS V509
 *
 * Canonical facade for the tipModule tower (V263–V268).
 * tipModule268 is the authoritative tip; V263–V267 are thin re-exports to it.
 * This file is the single entry-point for all new imports.
 *
 * Registers itself with canonBridgePatch508 for cross-tower diffing.
 *
 * Usage:
 *   const tip = require('./tipModuleCanon509.js');
 *   tip.defaultTipModule268      // live singleton
 *   tip.getTowerDescriptor509()  // tower metadata
 *   tip.getCanonInfo509()        // human-readable summary
 *
 * Structure: V263→268, V264→268, V265→268, V266→268, V267→268, V268 (canonical tip)
 * All identifiers end in 509 except re-exported 268 surface.
 * Zero new npm deps. SACRED untouched.
 * @version 509.0.0
 */

// ── tower constants ───────────────────────────────────────────────────────────

const TOWER_NAME_509    = 'tipModule';
const TOWER_KIND_509    = 'parallel-duplicate';  // all aliases point directly to 268
const CHAIN_BASE_509    = 263;
const CANONICAL_TIP_509 = 268;
const TOWER_MEMBERS_509 = [263, 264, 265, 266, 267, 268];

// ── canonical tip ─────────────────────────────────────────────────────────────

const _tip268_509 = require('./tipModule268.js');

const {
  TipModule268,
  defaultTipModule268,
  EPOCH_ENERGY_PER_USER_268,
  TIP_MAX_MICRO_268,
  TIP_MIN_MICRO_268,
  COMMUNITY_MATCH_RATE_268,
} = _tip268_509;

// ── tower descriptor (canonBridgePatch508 format) ─────────────────────────────

function getTowerDescriptor509() {
  return {
    name:    TOWER_NAME_509,
    kind:    TOWER_KIND_509,
    base:    String(CHAIN_BASE_509),
    tip:     String(CANONICAL_TIP_509),
    members: TOWER_MEMBERS_509.map(String),
  };
}

// ── human-readable metadata ───────────────────────────────────────────────────

function getCanonInfo509() {
  return {
    version:       '509.0.0',
    file:          'tipModuleCanon509.js',
    tower:         TOWER_NAME_509,
    kind:          TOWER_KIND_509,
    base:          CHAIN_BASE_509,
    tip:           CANONICAL_TIP_509,
    memberCount:   TOWER_MEMBERS_509.length,
    members:       TOWER_MEMBERS_509,
    note:          'New code imports tipModuleCanon509 — never V263..V267 directly.',
    registeredWith: 'canonBridgePatch508',
  };
}

// ── self-register with canonBridgePatch508 ────────────────────────────────────

try {
  const patch508 = require('./canonBridgePatch508.js');
  if (typeof patch508.registerCanonFacade508 === 'function') {
    patch508.registerCanonFacade508(getTowerDescriptor509());
  }
} catch (_) { /* soft-fail — canon still fully usable without bridge */ }

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // tower metadata
  TOWER_NAME_509,
  TOWER_KIND_509,
  CHAIN_BASE_509,
  CANONICAL_TIP_509,
  TOWER_MEMBERS_509,
  getTowerDescriptor509,
  getCanonInfo509,

  // full V268 surface
  tip268:                    _tip268_509,
  TipModule268,
  defaultTipModule268,
  EPOCH_ENERGY_PER_USER_268,
  TIP_MAX_MICRO_268,
  TIP_MIN_MICRO_268,
  COMMUNITY_MATCH_RATE_268,
};
