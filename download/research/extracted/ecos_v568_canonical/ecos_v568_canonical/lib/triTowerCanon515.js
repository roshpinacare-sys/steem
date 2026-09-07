'use strict';
/**
 * src/lib/triTowerCanon515.js — ECOS V515 (Phase P403)
 *
 * Canonical facade for three parallel towers (each V263–V268, 6 modules each):
 *   • splitModule       — revenue split, BPS, vesting schedules
 *   • quadraticFunding  — QF rounds, contribution matching
 *   • x402              — X402 payment middleware, nonce registry, headers
 *
 * All three are parallel-dup (each version is self-contained, no inheritance chain).
 * V268 is the canonical tip for all three.
 * New code imports THIS file only — never V263..V267 directly.
 *
 * Usage:
 *   const tri = require('./triTowerCanon515.js');
 *   tri.splitModule268.SplitModule268
 *   tri.quadraticFunding268.QuadraticFunding268
 *   tri.x402268.X402Processor268
 *   tri.getTriCanonInfo515()
 *
 * All identifiers end in 515. Zero npm deps. SACRED untouched.
 * @version 515.0.0
 */

const TRI_CANON_VERSION_515  = '515.0.0';
const TRI_CANON_TOWERS_515   = ['splitModule', 'quadraticFunding', 'x402'];
const TRI_CANON_BASE_515     = 263;
const TRI_CANON_TIP_515      = 268;

// ── Canonical tips ────────────────────────────────────────────────────────────
const splitModule268_515      = require('./splitModule268.js');
const quadraticFunding268_515 = require('./quadraticFunding268.js');
const x402268_515             = require('./x402268.js');

// ── Metadata ──────────────────────────────────────────────────────────────────
function getTriCanonInfo515() {
  return {
    canonVersion:   TRI_CANON_VERSION_515,
    towers:         TRI_CANON_TOWERS_515,
    base:           TRI_CANON_BASE_515,
    tip:            TRI_CANON_TIP_515,
    chainLength:    TRI_CANON_TIP_515 - TRI_CANON_BASE_515 + 1,
    totalModules:   TRI_CANON_TOWERS_515.length * (TRI_CANON_TIP_515 - TRI_CANON_BASE_515 + 1),
    towersType:     'parallel-dup (not inheritance-chain)',
    importGuidance: 'Import triTowerCanon515 — never V263..V267 directly.',
  };
}

module.exports = {
  TRI_CANON_VERSION_515,
  TRI_CANON_TOWERS_515,
  TRI_CANON_BASE_515,
  TRI_CANON_TIP_515,
  getTriCanonInfo515,

  // Full tip surfaces
  splitModule268:      splitModule268_515,
  quadraticFunding268: quadraticFunding268_515,
  x402268:             x402268_515,

  // Convenience: splitModule268 top exports
  SplitModule268:          splitModule268_515.SplitModule268,
  defaultSplitModule268:   splitModule268_515.defaultSplitModule268,
  BPS_TOTAL_268:           splitModule268_515.BPS_TOTAL_268,
  VESTING_MIN_DAYS_268:    splitModule268_515.VESTING_MIN_DAYS_268,

  // Convenience: quadraticFunding268 top exports
  QuadraticFunding268:         quadraticFunding268_515.QuadraticFunding268,
  defaultQuadraticFunding268:  quadraticFunding268_515.defaultQuadraticFunding268,
  QF_MIN_CONTRIBUTION_268:     quadraticFunding268_515.QF_MIN_CONTRIBUTION_268,

  // Convenience: x402268 top exports
  X402Processor268:     x402268_515.X402Processor268,
  NonceRegistry268:     x402268_515.NonceRegistry268,
  x402Middleware268:    x402268_515.x402Middleware268,
  parseX402Header268:   x402268_515.parseX402Header268,
  buildPaymentRequired268: x402268_515.buildPaymentRequired268,
  buildX402Response268: x402268_515.buildX402Response268,
};
