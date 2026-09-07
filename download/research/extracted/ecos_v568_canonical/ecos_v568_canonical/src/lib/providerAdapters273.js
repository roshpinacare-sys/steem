'use strict';
/**
 * src/lib/providerAdapters273.js — Provider Adapter Scaffolds & Validators (V273)
 *
 * Extends providerAdapters269 with:
 *   1. 1 new contract: creditHealthMonitor — total 23 contracts
 *   2. createCreditHealthMonitorStub273() factory
 *   3. createAllStubs273()
 *   4. validateProvider273() / validateAllProviders273()
 *
 * Zero new npm deps. Identifiers end with 273.
 */

const { PROVIDER_CONTRACTS_269, validateProvider269, createAllStubs269 } = require('./providerAdapters269');

// ── New V273 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_273 = Object.freeze({
  ...PROVIDER_CONTRACTS_269,

  creditHealthMonitor: {
    required: ['checkHealth273', 'issuanceAllowed273', 'rewardsAllowed273',
               'recordSybilEval273', 'recordTip273'],
    optional: ['getMetrics273', 'manualOverride273', 'getPerf273',
               'checkCreditHealthMonitorHealth273'],
    description: 'Live credit health counters + fail-closed issuance/reward directives',
  },
});

// ── Validation ───────────────────────────────────────────────────────────────

function validateProvider273(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_273[contractKey];
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

function validateAllProviders273(providersObject) {
  const allErrors = {};
  let ok = true;
  for (const [key, impl] of Object.entries(providersObject || {})) {
    if (PROVIDER_CONTRACTS_273[key]) {
      const result = validateProvider273(key, impl);
      if (!result.ok) { allErrors[key] = result.errors; ok = false; }
    }
  }
  return { ok, allErrors };
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function createCreditHealthMonitorStub273(opts = {}) {
  const { CreditHealthMonitor273 } = require('./creditHealthMonitor273');
  return new CreditHealthMonitor273(opts);
}

function createAllStubs273(opts = {}) {
  const base = createAllStubs269(opts);
  return {
    ...base,
    creditHealthMonitor: createCreditHealthMonitorStub273(opts),
  };
}

// ── Scaffold helper ───────────────────────────────────────────────────────────

function createAdapterScaffold273(contractKey, opts = {}) {
  if (contractKey === 'creditHealthMonitor') return createCreditHealthMonitorStub273(opts);
  // Delegate to 269 for everything else
  const { createAdapterScaffold269 } = require('./providerAdapters269');
  if (typeof createAdapterScaffold269 === 'function')
    return createAdapterScaffold269(contractKey, opts);
  return null;
}

module.exports = {
  PROVIDER_CONTRACTS_273,
  validateProvider273,
  validateAllProviders273,
  createCreditHealthMonitorStub273,
  createAllStubs273,
  createAdapterScaffold273,
  // Re-export 269 for convenience
  PROVIDER_CONTRACTS_269,
  validateProvider269,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._PROVIDER_CONTRACTS_273 = PROVIDER_CONTRACTS_273;
}
