'use strict';
/**
 * lib/reputationLedgerCanon513.js — ECOS V513
 *
 * Canonical facade for the reputationLedger tower (V263–V268, 6 modules).
 *
 * המגדל: 6 גרסאות של reputationLedger שנצברו. V263–V267 הם thin re-exports ל-V268.
 * הפתרון: facade אחד — נקודת כניסה יחידה לכל קוד חדש.
 *
 * V268 יכולות: Multi-dimensional reputation tracks, temporal decay (Ebbinghaus),
 * selective disclosure, program-level reputation, anti-collusion graph analysis.
 *
 * Usage:
 *   const canon513 = require('./lib/reputationLedgerCanon513.js');
 *   canon513.getCanonInfo513()            // tower metadata
 *   canon513.getHealthSummary513()        // live health check
 *   canon513.createInstance513(opts)      // new ReputationLedger268 instance
 *   canon513.getDefaultInstance513()      // shared defaultReputationLedger268
 *   canon513.registerEndpoints513(app)    // wire status endpoint
 *
 * All identifiers end in 513. Sacred files untouched. Zero npm deps.
 * @module reputationLedgerCanon513
 * @version 513.0.0
 */

const CANON_VERSION_513      = '513.0.0';
const CANON_TOWER_PREFIX_513 = 'reputationLedger';
const CANON_TIP_VERSION_513  = 268;
const CANON_BASE_VERSION_513 = 263;
const CANON_COUNT_513        = 6; // V263–V268 inclusive
const IMPORT_GUIDANCE_513    =
  'New code: require(./lib/reputationLedgerCanon513.js). Never import V263..V267 directly.';

// ── load tip (fail-soft) ───────────────────────────────────────────────────

let _tip513        = null;
let _loadError513  = null;

try {
  _tip513 = require('./reputationLedger268.js');
} catch (e) {
  _loadError513 = e.message;
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * getCanonInfo513() — metadata על המגדל
 */
function getCanonInfo513() {
  return {
    tower:          CANON_TOWER_PREFIX_513,
    canonModule:    'reputationLedgerCanon513',
    canonVersion:   CANON_VERSION_513,
    tipVersion:     CANON_TIP_VERSION_513,
    baseVersion:    CANON_BASE_VERSION_513,
    moduleCount:    CANON_COUNT_513,
    importGuidance: IMPORT_GUIDANCE_513,
    description:
      'Canonical facade: 6 reputationLedger modules (V263–V268). ' +
      'Features: multi-dimensional tracks, temporal decay (Ebbinghaus 90d), ' +
      'selective disclosure, program reputation, anti-collusion graph analysis. ' +
      'Import this, never V263..V267.',
  };
}

/**
 * getHealthSummary513() — snapshot חי
 */
function getHealthSummary513() {
  const tipOk = _tip513 !== null &&
    typeof _tip513.ReputationLedger268 === 'function' &&
    typeof _tip513.defaultReputationLedger268 !== 'undefined';

  let instanceOk = false;
  let healthDetail = null;
  if (tipOk) {
    try {
      healthDetail = _tip513.defaultReputationLedger268.checkReputationHealth268();
      instanceOk = true;
    } catch (_) {}
  }

  return {
    ok:            !_loadError513 && tipOk,
    canonVersion:  CANON_VERSION_513,
    tower:         CANON_TOWER_PREFIX_513,
    tipOk,
    instanceOk,
    loadError:     _loadError513 || null,
    moduleCount:   CANON_COUNT_513,
    health:        healthDetail,
  };
}

/**
 * createInstance513(opts) — new ReputationLedger268 instance
 * @param {object} [opts] — passed to ReputationLedger268 constructor
 * @returns {ReputationLedger268}
 */
function createInstance513(opts) {
  if (!_tip513 || typeof _tip513.ReputationLedger268 !== 'function') {
    throw new Error('canon513: tip module V268 not loaded — cannot create instance');
  }
  return new _tip513.ReputationLedger268(opts || {});
}

/**
 * getDefaultInstance513() — shared singleton (defaultReputationLedger268)
 */
function getDefaultInstance513() {
  if (!_tip513 || !_tip513.defaultReputationLedger268) {
    throw new Error('canon513: tip module V268 not loaded — cannot get default instance');
  }
  return _tip513.defaultReputationLedger268;
}

/**
 * registerEndpoints513(app) — wire GET /api/v1/reputation/canon/status
 */
function registerEndpoints513(app) {
  if (!app || typeof app.get !== 'function') return false;
  app.get('/api/v1/reputation/canon/status', (_req, res) => {
    res.json(getHealthSummary513());
  });
  return true;
}

// ── re-export key constants from tip (for convenience) ─────────────────────

const ATTESTATION_TYPES_513  = _tip513 ? _tip513.ATTESTATION_TYPES_268  : null;
const DECAY_HALF_LIFE_MS_513 = _tip513 ? _tip513.DECAY_HALF_LIFE_MS_268 : null;

// ── module.exports ────────────────────────────────────────────────────────

module.exports = {
  // constants
  CANON_VERSION_513,
  CANON_TOWER_PREFIX_513,
  CANON_TIP_VERSION_513,
  CANON_BASE_VERSION_513,
  CANON_COUNT_513,
  IMPORT_GUIDANCE_513,
  ATTESTATION_TYPES_513,
  DECAY_HALF_LIFE_MS_513,

  // facade API
  getCanonInfo513,
  getHealthSummary513,
  createInstance513,
  getDefaultInstance513,
  registerEndpoints513,
};
