'use strict';
/**
 * lib/sybilGuardCanon512.js — ECOS V512
 *
 * Canonical facade for the sybilGuard tower (V263–V268, 6 modules).
 *
 * המגדל: V263–V267 הן כבר thin re-exports ל-V268 (parallel-dup).
 * V268 הוא הטיפ הקנוני עם: composite humanity score, velocity detection,
 * device fingerprint clustering, graduated responses (ALLOW/WARN/THROTTLE/BLOCK).
 *
 * פתרון: facade אחד שחושף את V268 כנקודת כניסה יחידה לכל קוד חדש.
 *
 * Usage:
 *   const canon512 = require('./lib/sybilGuardCanon512.js');
 *   canon512.getCanonInfo512()          // tower metadata
 *   canon512.getHealthSummary512()      // live snapshot
 *   canon512.createInstance512(opts)    // canonical SybilGuard instance
 *   canon512.registerEndpoints512(app)  // wire status endpoint
 *
 * All identifiers end in 512. Zero npm deps. Sacred files untouched.
 * @module sybilGuardCanon512
 * @version 512.0.0
 */

const CANON_VERSION_512   = '512.0.0';
const CANON_TOWER_512     = 'sybilGuard';
const CANON_TIP_512       = 268;
const CANON_BASE_512      = 263;
const CANON_COUNT_512     = CANON_TIP_512 - CANON_BASE_512 + 1; // 6
const IMPORT_GUIDANCE_512 =
  'New code: require(./lib/sybilGuardCanon512.js). Never import sybilGuard263..268 directly.';

// ── canonical tip ──────────────────────────────────────────────────────────
const {
  SybilGuard268,
  defaultSybilGuard268,
  AMNESTY_RETENTION_268,
  SIGNAL_WEIGHTS_268,
  VELOCITY_MAX_268,
} = require('./sybilGuard268.js');

// ── singleton ──────────────────────────────────────────────────────────────
let _instance512 = null;
function _getInstance512(opts) {
  if (!_instance512) {
    _instance512 = (typeof defaultSybilGuard268 === 'function')
      ? defaultSybilGuard268(opts || {})
      : new SybilGuard268(opts || {});
  }
  return _instance512;
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * getCanonInfo512() — metadata על המגדל
 */
function getCanonInfo512() {
  return {
    tower:          CANON_TOWER_512,
    canonModule:    'sybilGuardCanon512',
    canonVersion:   CANON_VERSION_512,
    tipVersion:     CANON_TIP_512,
    baseVersion:    CANON_BASE_512,
    moduleCount:    CANON_COUNT_512,
    importGuidance: IMPORT_GUIDANCE_512,
    description:    'Canonical facade: 6 sybilGuard modules (V263–V268) unified. ' +
                    'V263–V267 were already thin re-exports of V268. ' +
                    'Features: composite humanity score, velocity detection, ' +
                    'device fingerprint clustering, graduated responses.',
  };
}

/**
 * getHealthSummary512() — snapshot חי של מצב המגדל
 */
function getHealthSummary512() {
  const errors512 = [];
  let instanceOk512 = false;
  let signalCount512 = 0;

  try {
    const sg = _getInstance512();
    instanceOk512 = sg instanceof SybilGuard268;
    signalCount512 = Object.keys(SIGNAL_WEIGHTS_268 || {}).length;
  } catch (e) {
    errors512.push('instance_failed: ' + e.message);
  }

  return {
    tower:          CANON_TOWER_512,
    canonVersion:   CANON_VERSION_512,
    tipVersion:     CANON_TIP_512,
    moduleCount:    CANON_COUNT_512,
    instanceOk:     instanceOk512,
    signalCount:    signalCount512,
    amnestyRate:    AMNESTY_RETENTION_268,
    velocityMax:    VELOCITY_MAX_268,
    healthy:        errors512.length === 0 && instanceOk512,
    errors:         errors512,
    ts:             new Date().toISOString(),
  };
}

/**
 * createInstance512(opts) — new SybilGuard instance (canonical)
 * @param {object} opts — { logger, auditLog, sybilResistance }
 */
function createInstance512(opts) {
  return new SybilGuard268(opts || {});
}

/**
 * registerEndpoints512(app) — wire express endpoints
 * @param {object} app — express app
 */
function registerEndpoints512(app) {
  // [V512-T01] GET /api/v1/sybil-guard/canon/status
  app.get('/api/v1/sybil-guard/canon/status', (_req, res) => {
    try {
      const health = getHealthSummary512();
      res.json(Object.assign({ ok: true, ecosVersion: 'V512' }, health));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V512' });
    }
  });

  // [V512-T02] GET /api/v1/admin/summary/v512
  app.get('/api/v1/admin/summary/v512', (_req, res) => {
    res.json({
      ok:          true,
      version:     'V512',
      feature:     'sybilGuard-canon-facade',
      description: 'Canonical facade for sybilGuard tower (V263–V268, 6 modules). ' +
                   'V263–V267 were thin re-exports of V268. ' +
                   'Composite humanity score, velocity detection, device clustering.',
      endpoints: [
        'V512-T01 GET /api/v1/sybil-guard/canon/status',
        'V512-T02 GET /api/v1/admin/summary/v512',
      ],
      module:      'sybilGuardCanon512',
      moduleCount: CANON_COUNT_512,
      ecosVersion: 'V512',
    });
  });
}

// ── re-export tip surface (backwards-compatible) ───────────────────────────
module.exports = {
  // Canon API
  getCanonInfo512,
  getHealthSummary512,
  createInstance512,
  registerEndpoints512,
  CANON_VERSION_512,
  CANON_TOWER_512,
  CANON_TIP_512,
  CANON_BASE_512,
  CANON_COUNT_512,
  IMPORT_GUIDANCE_512,
  // Re-export tip (V268) — full backwards-compatible surface
  SybilGuard268,
  defaultSybilGuard268,
  AMNESTY_RETENTION_268,
  SIGNAL_WEIGHTS_268,
  VELOCITY_MAX_268,
};
