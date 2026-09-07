'use strict';
/**
 * src/lib/providerAdapters284.js — Provider Adapter Scaffolds & Validators (V284)
 *
 * Extends providerAdapters283 with:
 *   1. 1 new contract: channelFilter — total 34 contracts
 *   2. createChannelFilterStub284() factory
 *   3. createAllStubs284()
 *   4. validateProvider284() / validateAllProviders284()
 *
 * Zero new npm deps. Identifiers end with 284.
 */

const { PROVIDER_CONTRACTS_283, validateProvider283, createAllStubs283 } = require('./providerAdapters283');

// ── New V284 contract ─────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_284 = Object.freeze({
  ...PROVIDER_CONTRACTS_283,

  channelFilter: {
    required: [
      'setChannelFilter284',
      'getChannelFilter284',
      'removeChannelFilter284',
      'applyChannelFilter284',
      'notifyDigest284',
      'getStatus284',
    ],
    optional: [
      'testChannelFilter284',
      'checkChannelFilterHealth284',
      'getPerf284',
    ],
    description: 'Per-channel alert filters: set/get/remove filters, apply before delivery, dry-run testing',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider284(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_284[contractKey];
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

function validateAllProviders284(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };
  const results = {};
  let allOk = true;
  for (const key of Object.keys(PROVIDER_CONTRACTS_284)) {
    if (!(key in providersObject)) {
      results[key] = { ok: false, errors: [`Missing provider: ${key}`] };
      allOk = false;
    } else {
      results[key] = validateProvider284(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }
  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createChannelFilterStub284() {
  return {
    setChannelFilter284:        () => ({ ok: true,  version: '284' }),
    getChannelFilter284:        () => ({ ok: false, error: 'stub', version: '284' }),
    removeChannelFilter284:     () => ({ ok: true,  version: '284' }),
    applyChannelFilter284:      () => ({ ok: true,  passes: true, reason: 'stub', version: '284' }),
    notifyDigest284:            () => ({ ok: true, delivered: [], filtered: [], skipped: [], errors: [], version: '284' }),
    getStatus284:               () => ({ ok: true, version: '284', filterCount: 0, deliveryLogSize: 0 }),
    testChannelFilter284:       () => ({ ok: false, error: 'stub', version: '284' }),
    checkChannelFilterHealth284:() => ({ ok: true, version: '284', filterCount: 0 }),
    getPerf284:                 () => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
  };
}

function createAllStubs284() {
  return {
    ...createAllStubs283(),
    channelFilter: createChannelFilterStub284(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_284,
  validateProvider284,
  validateAllProviders284,
  createChannelFilterStub284,
  createAllStubs284,
};
