'use strict';
/**
 * lib/telemetryCanon511.js — ECOS V511
 *
 * Canonical facade for the telemetry tower (V263–V268, 6 modules).
 *
 * המגדל: V263–V267 הן כבר thin re-exports ל-V268 (parallel-dup).
 * V268 הוא הטיפ הקנוני.
 *
 * פתרון: facade אחד שחושף את V268 כנקודת כניסה יחידה לכל קוד חדש,
 * כולל getHealthSummary511, getCanonInfo511 ו-status endpoint.
 *
 * Usage:
 *   const canon511 = require('./lib/telemetryCanon511.js');
 *   canon511.getCanonInfo511()         // tower metadata
 *   canon511.getHealthSummary511()     // live snapshot
 *   canon511.defaultTelemetry511()     // canonical singleton
 *   canon511.registerEndpoints511(app) // wire status endpoint
 *
 * All identifiers end in 511. Zero npm deps. Sacred files untouched.
 * @module telemetryCanon511
 * @version 511.0.0
 */

const CANON_VERSION_511      = '511.0.0';
const CANON_TOWER_511        = 'telemetry';
const CANON_TIP_511          = 268;
const CANON_BASE_511         = 263;
const CANON_COUNT_511        = CANON_TIP_511 - CANON_BASE_511 + 1; // 6
const IMPORT_GUIDANCE_511    =
  'New code: require(./lib/telemetryCanon511.js). Never import telemetry263..268 directly.';

// ── canonical tip ──────────────────────────────────────────────────────────
const { Telemetry268, defaultTelemetry268 } = require('./telemetry268.js');

// ── singleton ──────────────────────────────────────────────────────────────
let _instance511 = null;
function _getInstance511() {
  if (!_instance511) {
    try { _instance511 = defaultTelemetry268(); } catch (_) {
      _instance511 = new Telemetry268();
    }
  }
  return _instance511;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * getCanonInfo511() — metadata על המגדל
 */
function getCanonInfo511() {
  return {
    tower:          CANON_TOWER_511,
    canonModule:    'telemetryCanon511',
    canonVersion:   CANON_VERSION_511,
    tipVersion:     CANON_TIP_511,
    baseVersion:    CANON_BASE_511,
    moduleCount:    CANON_COUNT_511,
    importGuidance: IMPORT_GUIDANCE_511,
    description:    'Canonical facade: 6 telemetry modules (V263–V268) unified. ' +
                    'V263–V267 were already thin re-exports of V268.',
  };
}

/**
 * getHealthSummary511() — snapshot חי של מצב המגדל
 */
function getHealthSummary511() {
  const summary511 = {
    canon:     getCanonInfo511(),
    telemetry: {},
    timestamp: Date.now(),
  };

  try {
    const t = _getInstance511();
    if (typeof t.checkTelemetryHealth268 === 'function') {
      summary511.telemetry = t.checkTelemetryHealth268();
    } else if (typeof t.getDashboard268 === 'function') {
      const db = t.getDashboard268();
      summary511.telemetry = { ok: true, dashboard: db };
    } else {
      summary511.telemetry = { ok: true, note: 'instance available' };
    }
  } catch (e) {
    summary511.telemetry = { ok: false, error: e.message };
  }

  return summary511;
}

/**
 * defaultTelemetry511() — canonical singleton Telemetry268
 */
function defaultTelemetry511() {
  return _getInstance511();
}

/**
 * registerEndpoints511(app) — wire status endpoint
 */
function registerEndpoints511(app) {
  if (!app || typeof app.get !== 'function') return;

  // [V511-T01] GET /api/v1/telemetry/canon/status
  app.get('/api/v1/telemetry/canon/status', (_req, res) => {
    try {
      res.json({ ok: true, ecosVersion: 'V511', health: getHealthSummary511() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V511' });
    }
  });

  // [V511-T02] GET /api/v1/admin/summary/v511
  app.get('/api/v1/admin/summary/v511', (_req, res) => {
    res.json({
      ok:             true,
      version:        'V511',
      feature:        'telemetry-canon-facade',
      description:    'Canonical facade for 6 telemetry modules (V263–V268). ' +
                      'V263–V267 were already thin re-exports of V268.',
      moduleCount:    CANON_COUNT_511,
      tipModule:      'telemetry268',
      endpoints: [
        'V511-T01 GET /api/v1/telemetry/canon/status',
        'V511-T02 GET /api/v1/admin/summary/v511',
      ],
      importGuidance: IMPORT_GUIDANCE_511,
      ecosVersion:    'V511',
    });
  });
}

module.exports = {
  // metadata
  CANON_VERSION_511,
  CANON_TOWER_511,
  CANON_TIP_511,
  CANON_BASE_511,
  CANON_COUNT_511,
  IMPORT_GUIDANCE_511,

  // public API
  getCanonInfo511,
  getHealthSummary511,
  defaultTelemetry511,
  registerEndpoints511,

  // re-export tip — callers need only this file
  Telemetry268,
  defaultTelemetry268,
};
