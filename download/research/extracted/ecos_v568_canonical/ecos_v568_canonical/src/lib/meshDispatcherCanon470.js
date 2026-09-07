'use strict';
/**
 * src/lib/meshDispatcherCanon470.js — ECOS V470
 *
 * Canonical facade for the meshDispatcher tower (V288-V297).
 * V297 is the authoritative tip of the chain; this file declares it as
 * the single canonical entry-point so new code never requires intermediate
 * versions directly.
 *
 * Usage:
 *   const canon470 = require('./meshDispatcherCanon470.js');
 *   // canon470.D297 — full V297 surface
 *   // canon470.dispatch470(capId, args) — safe dispatch via V297 root (D288)
 *   // canon470.getCanonInfo470() — tower metadata
 *
 * Chain: D288→D289→D290→D291→D292→D293→D294→D295→D296→D297
 * New code should import THIS file only — never import D288..D296 directly.
 *
 * All identifiers end in 470. Sacred files untouched.
 * @version 470.0.0
 */

const CANON_VERSION_470     = '470.0.0';
const CANON_TOWER_PREFIX_470 = 'meshDispatcher';
const CANON_TIP_470          = 297;
const CANON_BASE_470         = 288;

// The canonical tip — all V288..V296 features are accessible via chained require()s
const D297_470 = require('./meshDispatcher297.js');

// Re-export the full D297 surface as the canonical surface
const {
  BRIDGE_VERSION_297,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
} = D297_470;

/**
 * getCanonInfo470() → metadata object describing the tower state.
 */
function getCanonInfo470() {
  return {
    version:       CANON_VERSION_470,
    tower:         CANON_TOWER_PREFIX_470,
    canonicalTip:  CANON_TIP_470,
    chainBase:     CANON_BASE_470,
    chainLength:   CANON_TIP_470 - CANON_BASE_470 + 1,
    bridgeVersion: BRIDGE_VERSION_297,
    note:          'New code imports meshDispatcherCanon470.js — never intermediate versions.',
  };
}

module.exports = {
  CANON_VERSION_470,
  CANON_TOWER_PREFIX_470,
  CANON_TIP_470,
  CANON_BASE_470,
  // Full D297 surface
  D297: D297_470,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
  // Canon utility
  getCanonInfo470,
};
