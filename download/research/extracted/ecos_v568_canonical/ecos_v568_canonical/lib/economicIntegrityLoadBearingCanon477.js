'use strict';
/**
 * lib/economicIntegrityLoadBearingCanon477.js — ECOS V477
 *
 * Canonical facade for the economicIntegrityLoadBearing tower (V361–V371, 11 modules).
 *
 * המגדל: 11 גרסאות של economicIntegrityLoadBearing שנצברו ללא facade מאחד.
 * הפתרון: facade אחד שחושף:
 *   - גרסת ה-tip (V371) כנקודת כניסה ראשית
 *   - gate function קריטי requireIntegrityVerified361 (V361 — הליבה המקורית)
 *   - health summary חי על כל 11 המודולים
 *
 * Chain: V361 (gate) → V362 (middleware) → V363 (revocation) → V364 (feed)
 *        → V365 (ed25519) → V366 (key rotation) → V367 (replay guard)
 *        → V368 (persistent cache) → V369 (prewarm) → V370 (attestation)
 *        → V371 (feed page + compaction — TIP)
 *
 * New code imports THIS file — never V361..V370 directly.
 *
 * Usage:
 *   const canon477 = require('./lib/economicIntegrityLoadBearingCanon477.js');
 *   canon477.getCanonInfo477()            // tower metadata
 *   canon477.getHealthSummary477()        // live snapshot of all 11 modules
 *   canon477.requireIntegrityVerified477(ctx, opts)  // canonical gate
 *   canon477.buildSignedPrewarmAttestationFeedPage477(...)  // tip function
 *   canon477.registerEndpoints477(app)    // wire status endpoint
 *
 * All identifiers end in 477. Sacred files untouched. Zero npm deps.
 * @module economicIntegrityLoadBearingCanon477
 * @version 477.0.0
 */

const CANON_VERSION_477      = '477.0.0';
const CANON_TOWER_PREFIX_477 = 'economicIntegrityLoadBearing';
const CANON_TIP_VERSION_477  = 371;
const CANON_BASE_VERSION_477 = 361;
const CANON_COUNT_477        = 11; // V361–V371 inclusive
const IMPORT_GUIDANCE_477    =
  'New code: require(./lib/economicIntegrityLoadBearingCanon477.js). ' +
  'Never import V361..V370 directly.';

// ── load modules (fail-soft per module, not per tower) ────────────────────

let _v361477 = null, _v371477 = null;
const _loadErrors477 = {};

(function _loadAll477() {
  const pairs = [
    [361, './economicIntegrityLoadBearing361.js'],
    [362, './economicIntegrityLoadBearing362.js'],
    [363, './economicIntegrityLoadBearing363.js'],
    [364, './economicIntegrityLoadBearing364.js'],
    [365, './economicIntegrityLoadBearing365.js'],
    [366, './economicIntegrityLoadBearing366.js'],
    [367, './economicIntegrityLoadBearing367.js'],
    [368, './economicIntegrityLoadBearing368.js'],
    [369, './economicIntegrityLoadBearing369.js'],
    [370, './economicIntegrityLoadBearing370.js'],
    [371, './economicIntegrityLoadBearing371.js'],
  ];
  for (const [ver, rel] of pairs) {
    try {
      const m = require(rel);
      if (ver === 361) _v361477 = m;
      if (ver === 371) _v371477 = m;
    } catch (e) {
      _loadErrors477[ver] = e.message;
    }
  }
}());

// ── public API — facade wrappers ──────────────────────────────────────────

/**
 * getCanonInfo477() — metadata על המגדל
 */
function getCanonInfo477() {
  return {
    tower:          CANON_TOWER_PREFIX_477,
    canonModule:    'economicIntegrityLoadBearingCanon477',
    canonVersion:   CANON_VERSION_477,
    tipVersion:     CANON_TIP_VERSION_477,
    baseVersion:    CANON_BASE_VERSION_477,
    moduleCount:    CANON_COUNT_477,
    importGuidance: IMPORT_GUIDANCE_477,
    description:
      'Canonical facade: 11 economicIntegrityLoadBearing modules unified. ' +
      'Gate (V361) + middleware + revocation + replay-guard + prewarm + compaction (V371-tip). ' +
      'Import this, never V361..V370.',
  };
}

/**
 * getHealthSummary477() — snapshot חי של כל 11 המודולים
 */
function getHealthSummary477() {
  const moduleStatuses = {};
  let loadedCount = 0;
  let errorCount  = 0;

  for (let v = 361; v <= 371; v++) {
    const verKey = `V${v}`;
    if (_loadErrors477[v]) {
      moduleStatuses[verKey] = { loaded: false, error: _loadErrors477[v] };
      errorCount++;
    } else {
      moduleStatuses[verKey] = { loaded: true };
      loadedCount++;
    }
  }

  // probe tip capabilities
  let tipOk = false;
  let gateOk = false;
  try {
    if (_v371477 && typeof _v371477.buildSignedPrewarmAttestationFeedPage371 === 'function') tipOk = true;
    if (_v361477 && typeof _v361477.requireIntegrityVerified361 === 'function') gateOk = true;
  } catch (_) {}

  return {
    ok:            loadedCount === CANON_COUNT_477,
    canonVersion:  CANON_VERSION_477,
    tower:         CANON_TOWER_PREFIX_477,
    loadedCount,
    errorCount,
    tipOk,
    gateOk,
    moduleStatuses,
  };
}

/**
 * requireIntegrityVerified477(ctx, opts)
 * Canonical gate — delegates to requireIntegrityVerified361 (V361).
 * Returns { allowed, attestation, reason }. If allowed===false → halt caller.
 */
function requireIntegrityVerified477(ctx, opts) {
  if (!_v361477 || typeof _v361477.requireIntegrityVerified361 !== 'function') {
    return {
      allowed:     false,
      attestation: null,
      reason:      'canon477: gate module V361 not loaded — fail-closed',
    };
  }
  return _v361477.requireIntegrityVerified361(ctx, opts);
}

/**
 * buildSignedPrewarmAttestationFeedPage477(ctx, opts)
 * Tip function from V371 — paginated signed attestation feed.
 */
function buildSignedPrewarmAttestationFeedPage477(ctx, opts) {
  if (!_v371477 || typeof _v371477.buildSignedPrewarmAttestationFeedPage371 !== 'function') {
    return { ok: false, error: 'canon477: tip module V371 not loaded', version: CANON_VERSION_477 };
  }
  return _v371477.buildSignedPrewarmAttestationFeedPage371(ctx, opts);
}

/**
 * enforceDeliveryReplayCompactionPolicyAdaptive477(ctx, opts)
 * Tip compaction policy from V371.
 */
function enforceDeliveryReplayCompactionPolicyAdaptive477(ctx, opts) {
  if (!_v371477 || typeof _v371477.enforceDeliveryReplayCompactionPolicyAdaptive371 !== 'function') {
    return { ok: false, error: 'canon477: tip module V371 not loaded', version: CANON_VERSION_477 };
  }
  return _v371477.enforceDeliveryReplayCompactionPolicyAdaptive371(ctx, opts);
}

/**
 * registerEndpoints477(app) — wire HTTP status endpoint
 */
function registerEndpoints477(app) {
  if (!app || typeof app.get !== 'function') return false;
  app.get('/api/v1/economic-integrity/canon/status', (_req, res) => {
    res.json(getHealthSummary477());
  });
  return true;
}

// ── module.exports ────────────────────────────────────────────────────────

module.exports = {
  // metadata
  CANON_VERSION_477,
  CANON_TOWER_PREFIX_477,
  CANON_TIP_VERSION_477,
  CANON_BASE_VERSION_477,
  CANON_COUNT_477,
  IMPORT_GUIDANCE_477,

  // facade API
  getCanonInfo477,
  getHealthSummary477,
  requireIntegrityVerified477,
  buildSignedPrewarmAttestationFeedPage477,
  enforceDeliveryReplayCompactionPolicyAdaptive477,
  registerEndpoints477,
};
