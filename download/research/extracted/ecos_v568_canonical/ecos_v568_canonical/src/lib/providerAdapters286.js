'use strict';
/**
 * src/lib/providerAdapters286.js — Provider Adapter Scaffolds & Validators (V286)
 *
 * Extends providerAdapters285 with:
 *   1. 1 new contract: presetGroups — total 36 contracts
 *   2. createPresetGroupsStub286() factory
 *   3. createAllStubs286()
 *   4. validateProvider286() / validateAllProviders286()
 *
 * Zero new npm deps. Identifiers end with 286.
 */

const { PROVIDER_CONTRACTS_285, validateProvider285, createAllStubs285 } = require('./providerAdapters285');

// ── New V286 contract ──────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_286 = Object.freeze({
  ...PROVIDER_CONTRACTS_285,

  presetGroups: {
    required: [
      'createPresetGroup286',
      'getPresetGroup286',
      'listPresetGroups286',
      'removePresetGroup286',
      'applyPresetGroup286',
      'getStatus286',
    ],
    optional: [
      'checkPresetGroupHealth286',
      'getPerf286',
    ],
    description: 'Preset groups: bundle multiple presets and apply them to multiple channels at once',
  },
});

// ── Validation ─────────────────────────────────────────────────────────────────

function validateProvider286(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_286[contractKey];
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

function validateAllProviders286(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };
  const results = {};
  let allOk = true;
  for (const key of Object.keys(PROVIDER_CONTRACTS_286)) {
    if (!(key in providersObject)) {
      results[key] = { ok: false, errors: [`Missing provider: ${key}`] };
      allOk = false;
    } else {
      results[key] = validateProvider286(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }
  return { ok: allOk, results };
}

// ── Stubs ──────────────────────────────────────────────────────────────────────

function createPresetGroupsStub286() {
  return {
    createPresetGroup286:      () => ({ ok: true,  version: '286' }),
    getPresetGroup286:         () => ({ ok: false, error: 'stub', version: '286' }),
    listPresetGroups286:       () => ({ ok: true,  groups: [], count: 0, version: '286' }),
    removePresetGroup286:      () => ({ ok: true,  version: '286' }),
    applyPresetGroup286:       () => ({ ok: true,  results: [], applied: 0, failed: 0, version: '286' }),
    getStatus286:              () => ({ ok: true,  version: '286', groupCount: 0 }),
    checkPresetGroupHealth286: () => ({ ok: true,  version: '286', groupCount: 0 }),
    getPerf286:                () => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
  };
}

function createAllStubs286() {
  return {
    ...createAllStubs285(),
    presetGroups: createPresetGroupsStub286(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_286,
  validateProvider286,
  validateAllProviders286,
  createPresetGroupsStub286,
  createAllStubs286,
};
