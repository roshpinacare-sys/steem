'use strict';
/**
 * src/lib/quadTowerCanon479.js — ECOS V479 (Phase P367)
 *
 * Canonical facade for four parallel towers (each V263–V268, 6 versions each):
 *   • tipModule    — user tipping + epoch energy + community matching
 *   • telemetry    — system telemetry + event tracking
 *   • sybilGuard   — sybil detection + velocity + amnesty
 *   • splitModule  — revenue split + BPS + vesting
 *
 * V268 is the canonical tip for all four. New code imports THIS file only.
 * Chain for each: V263→V264→V265→V266→V267→V268
 *
 * Exports:
 *   tipModule268, telemetry268, sybilGuard268, splitModule268  — tip surfaces
 *   getQuadCanonInfo479()     — tower metadata
 *   QUAD_CANON_VERSION_479    — '479.0.0'
 *
 * All identifiers end in 479. Sacred files untouched. Zero npm deps.
 * @version 479.0.0
 */

const QUAD_CANON_VERSION_479   = '479.0.0';
const QUAD_CANON_TOWERS_479    = ['tipModule','telemetry','sybilGuard','splitModule'];
const QUAD_CANON_BASE_479      = 263;
const QUAD_CANON_TIP_479       = 268;

// ── Canonical tips ──────────────────────────────────────────────────────────
const tipModule268_479   = require('./tipModule268.js');
const telemetry268_479   = require('./telemetry268.js');
const sybilGuard268_479  = require('./sybilGuard268.js');
const splitModule268_479 = require('./splitModule268.js');

// ── Tower metadata ───────────────────────────────────────────────────────────
function getQuadCanonInfo479() {
  return {
    canonVersion:   QUAD_CANON_VERSION_479,
    towers:         QUAD_CANON_TOWERS_479,
    base:           QUAD_CANON_BASE_479,
    tip:            QUAD_CANON_TIP_479,
    chainLength:    QUAD_CANON_TIP_479 - QUAD_CANON_BASE_479 + 1,
    totalModules:   QUAD_CANON_TOWERS_479.length * (QUAD_CANON_TIP_479 - QUAD_CANON_BASE_479 + 1),
    importGuidance: 'Import quadTowerCanon479 — never import V263..V267 directly.',
  };
}

module.exports = {
  QUAD_CANON_VERSION_479,
  QUAD_CANON_TOWERS_479,
  QUAD_CANON_BASE_479,
  QUAD_CANON_TIP_479,
  getQuadCanonInfo479,

  // Tip surfaces (full API of each tower's V268)
  tipModule268:   tipModule268_479,
  telemetry268:   telemetry268_479,
  sybilGuard268:  sybilGuard268_479,
  splitModule268: splitModule268_479,

  // Frequently-used exports surfaced for convenience
  TipModule268:         tipModule268_479.TipModule268,
  defaultTipModule268:  tipModule268_479.defaultTipModule268,
  Telemetry268:         telemetry268_479.Telemetry268,
  defaultTelemetry268:  telemetry268_479.defaultTelemetry268,
  SybilGuard268:        sybilGuard268_479.SybilGuard268,
  defaultSybilGuard268: sybilGuard268_479.defaultSybilGuard268,
  SplitModule268:       splitModule268_479.SplitModule268,
  defaultSplitModule268:splitModule268_479.defaultSplitModule268,
};
