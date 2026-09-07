'use strict';
/**
 * src/lib/economicIntegrityCanon472.js — ECOS V472
 *
 * Canonical facade for the economicIntegrityLoadBearing tower (V361–V371).
 * V371 is the authoritative tip; this file declares it as the single
 * canonical entry-point so new code never requires intermediate versions
 * directly.
 *
 * Usage:
 *   const canon472 = require('./economicIntegrityCanon472.js');
 *   // canon472.LB371       — full V371 surface
 *   // canon472.getCanonInfo472()  — tower metadata
 *   // canon472.requireIntegrityVerified361(ctx, opts) — main gate (from LB361)
 *
 * Chain: LB361→LB362→LB363→LB364→LB365→LB366→LB367→LB368→LB369→LB370→LB371
 * Proof base: economicIntegrityProof360 (LB361 → Proof360)
 * New code should import THIS file only — never import LB361..LB370 directly.
 *
 * All identifiers end in 472. Sacred files untouched.
 * @version 472.0.0
 */

const CANON_VERSION_472      = '472.0.0';
const CANON_TOWER_PREFIX_472 = 'economicIntegrityLoadBearing';
const CANON_TIP_472          = 371;
const CANON_BASE_472         = 361;

// The canonical tip — all LB361..LB370 features accessible via chained require()s
const LB371_472 = require('./economicIntegrityLoadBearing371.js');

// Re-export full LB371 surface as canonical surface
const {
  LOAD_BEARING_VERSION_371,
  buildSignedPrewarmAttestationFeedPage371,
  verifyRepoIntegrityRotationTranscript371,
  simulateBreakGlassClear371,
  enforceDeliveryReplayCompactionPolicyAdaptive371,
  _stableStringify371,
  _hmacSha256Hex371,
} = LB371_472;

/**
 * getCanonInfo472() → metadata object describing the tower state.
 */
function getCanonInfo472() {
  return {
    version:          CANON_VERSION_472,
    tower:            CANON_TOWER_PREFIX_472,
    canonicalTip:     CANON_TIP_472,
    chainBase:        CANON_BASE_472,
    chainLength:      CANON_TIP_472 - CANON_BASE_472 + 1,
    tipVersion:       LOAD_BEARING_VERSION_371,
    proofBase:        'economicIntegrityProof360',
    note:             'New code imports economicIntegrityCanon472.js — never LB361..LB370 directly.',
  };
}

module.exports = {
  CANON_VERSION_472,
  CANON_TOWER_PREFIX_472,
  CANON_TIP_472,
  CANON_BASE_472,

  // Full LB371 surface
  LB371: LB371_472,
  LOAD_BEARING_VERSION_371,
  buildSignedPrewarmAttestationFeedPage371,
  verifyRepoIntegrityRotationTranscript371,
  simulateBreakGlassClear371,
  enforceDeliveryReplayCompactionPolicyAdaptive371,
  _stableStringify371,
  _hmacSha256Hex371,

  // Canon API
  getCanonInfo472,
};
