'use strict';
/**
 * src/lib/providerAdapters285.js — Provider Adapter Scaffolds & Validators (V285)
 *
 * Extends providerAdapters284 with:
 *   1. 1 new contract: filterPresets — total 35 contracts
 *   2. createFilterPresetsStub285() factory
 *   3. createAllStubs285()
 *   4. validateProvider285() / validateAllProviders285()
 *
 * Zero new npm deps. Identifiers end with 285.
 */

const { PROVIDER_CONTRACTS_284, validateProvider284, createAllStubs284 } = require('./providerAdapters284');

// ── New V285 contract ─────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_285 = Object.freeze({
  ...PROVIDER_CONTRACTS_284,

  filterPresets: {
    required: [
      'registerFilterPreset285',
      'getFilterPreset285',
      'listFilterPresets285',
      'removeFilterPreset285',
      'applyFilterPreset285',
      'getStatus285',
    ],
    optional: [
      'checkFilterPresetHealth285',
      'getPerf285',
    ],
    description: 'Named filter presets: register/get/list/remove/apply presets to channels',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider285(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_285[contractKey];
  if (!contract) return { ok: false, errors: [`Unknown contract key: ${contractKey}`] };
  if (contractKey === 'toolExecutor') {
    if (typeof providerObject !== 'function')
      return { ok: false, errors: ['toolExecutor must be a function'] };
    return { ok: true, errors: [] };
  }
  const errors = [];
  for (const method of (contract.required || [])) {
    if (typeof providerObject[method] !== 'function')
      errors.push(`Missing required method: ${method}`);
  }
  return { ok: errors.length === 0, errors };
}

function validateAllProviders285(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };
  const results = {};
  let allOk = true;
  for (const key of Object.keys(PROVIDER_CONTRACTS_285)) {
    if (!(key in providersObject)) {
      results[key] = { ok: false, errors: [`Missing provider: ${key}`] };
      allOk = false;
    } else {
      results[key] = validateProvider285(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }
  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createFilterPresetsStub285() {
  return {
    registerFilterPreset285: () => ({ ok: true,  version: '285' }),
    getFilterPreset285:      () => ({ ok: false, error: 'stub', version: '285' }),
    listFilterPresets285:    () => ({ ok: true,  presets: [], count: 0, version: '285' }),
    removeFilterPreset285:   () => ({ ok: true,  version: '285' }),
    applyFilterPreset285:    () => ({ ok: true,  version: '285' }),
    getStatus285:            () => ({ ok: true,  version: '285', presetCount: 0 }),
    checkFilterPresetHealth285: () => ({ ok: true, version: '285', presetCount: 0 }),
    getPerf285:              () => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
  };
}

function createAllStubs285() {
  return {
    ...createAllStubs284(),
    filterPresets: createFilterPresetsStub285(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_285,
  validateProvider285,
  validateAllProviders285,
  createFilterPresetsStub285,
  createAllStubs285,
};
