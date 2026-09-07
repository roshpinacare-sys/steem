'use strict';
/**
 * lib/providerAdaptersCanon476.js — ECOS V476
 *
 * Canonical facade for the providerAdapters tower (V267–V286, 17 modules).
 *
 * המגדל: 17 גרסאות של providerAdapters שנצברו ללא facade מאחד.
 * הפתרון: facade אחד שחושף את הגרסה הטיפ (V286) כנקודת כניסה יחידה
 * לכל קוד חדש — 36 contracts, validation, ו-stub factories.
 *
 * Chain: V267 → V268 → ... → V285 → V286 (כל גרסה מרחיבה את הקודמת)
 * New code imports THIS file — never V267..V285 directly.
 *
 * Usage:
 *   const canon476 = require('./lib/providerAdaptersCanon476.js');
 *   canon476.getCanonInfo476()          // tower metadata
 *   canon476.getHealthSummary476()      // live snapshot of contracts + validation
 *   canon476.validateProvider476(...)   // canonical validation entrypoint
 *   canon476.createAllStubs476()        // full stub set (36 contracts)
 *   canon476.registerEndpoints476(app)  // wire status endpoint
 *
 * All identifiers end in 476. Sacred files untouched. Zero npm deps.
 * @module providerAdaptersCanon476
 * @version 476.0.0
 */

const CANON_VERSION_476      = '476.0.0';
const CANON_TOWER_PREFIX_476 = 'providerAdapters';
const CANON_TIP_VERSION_476  = 286;
const CANON_BASE_VERSION_476 = 267;
const CANON_COUNT_476        = 17; // actual files (V267,268,269,273-286 — gaps at 270-272)
const CANON_CONTRACT_COUNT_476 = 36; // contracts as of V286
const IMPORT_GUIDANCE_476    =
  'New code: require(./lib/providerAdaptersCanon476.js). Never import V267..V285 directly.';

// ── canonical tip ──────────────────────────────────────────────────────────
const TIP476 = require('./providerAdapters286Canon494.js'); // V494: mediated via canonical shim — completes full chain

const {
  PROVIDER_CONTRACTS_286,
  validateProvider286,
  validateAllProviders286,
  createPresetGroupsStub286,
  createAllStubs286,
} = TIP476;

// ── public API — facade wrappers ───────────────────────────────────────────

/**
 * getCanonInfo476() — metadata על המגדל
 */
function getCanonInfo476() {
  return {
    tower:           CANON_TOWER_PREFIX_476,
    canonModule:     'providerAdaptersCanon476',
    canonVersion:    CANON_VERSION_476,
    tipVersion:      CANON_TIP_VERSION_476,
    baseVersion:     CANON_BASE_VERSION_476,
    moduleCount:     CANON_COUNT_476,
    contractCount:   CANON_CONTRACT_COUNT_476,
    importGuidance:  IMPORT_GUIDANCE_476,
    description:     'Canonical facade: 17 providerAdapters modules unified. ' +
                     '36 contracts. Import this, never V267..V285.',
  };
}

/**
 * getHealthSummary476() — snapshot חי של מצב ה-canon
 */
function getHealthSummary476() {
  let contractCount = 0;
  let contractKeys = [];
  let stubsOk = false;
  let validationOk = false;
  let errors = [];

  try {
    contractKeys = Object.keys(PROVIDER_CONTRACTS_286);
    contractCount = contractKeys.length;
  } catch (e) {
    errors.push('contracts_load_failed: ' + e.message);
  }

  try {
    const stubs = createAllStubs286();
    const stubKeys = Object.keys(stubs);
    stubsOk = stubKeys.length === contractCount;
    if (!stubsOk) {
      errors.push('stub_count_mismatch: got ' + stubKeys.length + ' expected ' + contractCount);
    }
  } catch (e) {
    errors.push('stubs_failed: ' + e.message);
  }

  try {
    // Validate a known stub against its contract to confirm the chain works
    const stubs = createAllStubs286();
    const result = validateProvider286('presetGroups', stubs.presetGroups);
    validationOk = result.ok;
    if (!validationOk) {
      errors.push('validation_self_check_failed: ' + (result.errors || []).join('; '));
    }
  } catch (e) {
    errors.push('validation_check_failed: ' + e.message);
  }

  return {
    tower:         CANON_TOWER_PREFIX_476,
    canonVersion:  CANON_VERSION_476,
    tipVersion:    CANON_TIP_VERSION_476,
    moduleCount:   CANON_COUNT_476,
    contractCount,
    contractKeys,
    stubsOk,
    validationOk,
    healthy:       errors.length === 0,
    errors,
    ts:            new Date().toISOString(),
  };
}

/**
 * validateProvider476(contractKey, providerObject) — canonical validation entrypoint
 */
function validateProvider476(contractKey, providerObject) {
  return validateProvider286(contractKey, providerObject);
}

/**
 * validateAllProviders476(providersObject) — validate all providers at once
 */
function validateAllProviders476(providersObject) {
  return validateAllProviders286(providersObject);
}

/**
 * createAllStubs476() — full stub set for all 36 contracts
 */
function createAllStubs476() {
  return createAllStubs286();
}

/**
 * registerEndpoints476(app) — wire express endpoints
 * @param {object} app — express app
 */
function registerEndpoints476(app) {
  // [V476-T01] GET /api/v1/provider-adapters/canon/status
  app.get('/api/v1/provider-adapters/canon/status', (_req, res) => {
    try {
      const health = getHealthSummary476();
      res.json(Object.assign({ ok: true, ecosVersion: 'V476' }, health));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V476' });
    }
  });

  // [V476-T02] GET /api/v1/admin/summary/v476
  app.get('/api/v1/admin/summary/v476', (_req, res) => {
    res.json({
      ok:          true,
      version:     'V476',
      feature:     'providerAdapters-canon-facade',
      description: 'Canonical facade for providerAdapters tower (V267–V286, 17 modules, 36 contracts). ' +
                   'New code imports providerAdaptersCanon476.js — never V267..V285 directly.',
      endpoints: [
        'V476-T01 GET /api/v1/provider-adapters/canon/status',
        'V476-T02 GET /api/v1/admin/summary/v476',
      ],
      module:        'providerAdaptersCanon476',
      contractCount: CANON_CONTRACT_COUNT_476,
      moduleCount:   CANON_COUNT_476,
      ecosVersion:   'V476',
    });
  });
}

// ── re-export full tip API ─────────────────────────────────────────────────
module.exports = {
  // Canon API
  getCanonInfo476,
  getHealthSummary476,
  validateProvider476,
  validateAllProviders476,
  createAllStubs476,
  registerEndpoints476,
  CANON_VERSION_476,
  CANON_TOWER_PREFIX_476,
  CANON_TIP_VERSION_476,
  CANON_BASE_VERSION_476,
  CANON_COUNT_476,
  CANON_CONTRACT_COUNT_476,
  IMPORT_GUIDANCE_476,
  // Re-export tip (V286) — full backwards-compatible surface
  PROVIDER_CONTRACTS_286,
  validateProvider286,
  validateAllProviders286,
  createPresetGroupsStub286,
  createAllStubs286,
};
