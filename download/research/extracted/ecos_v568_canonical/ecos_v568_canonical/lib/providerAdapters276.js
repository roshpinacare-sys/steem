'use strict';
/**
 * src/lib/providerAdapters276.js — Provider Adapter Scaffolds & Validators (V276)
 *
 * Extends providerAdapters275 with:
 *   1. 1 new contract: alertResolution — total 26 contracts
 *   2. createAlertResolutionStub276() factory
 *   3. createAllStubs276()
 *   4. validateProvider276() / validateAllProviders276()
 *
 * Zero new npm deps. Identifiers end with 276.
 */

// V483: import from Canon483 shim (chain link mediated by V483)
const { PROVIDER_CONTRACTS_275, validateProvider275, createAllStubs275 } = require('./providerAdapters275Canon483');

// ── New V276 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_276 = Object.freeze({
  ...PROVIDER_CONTRACTS_275,

  alertResolution: {
    required: [
      'resolveAlert276',
      'acknowledgeAlert276',
      'getUnresolved276',
      'wireManualOverride276',
      'unwireManualOverride276',
      'addResolutionSseClient276',
      'removeResolutionSseClient276',
      'getStatus276',
    ],
    optional: [
      'startResolutionHeartbeat276',
      'checkAlertResolutionHealth276',
      'getEventHistory276',
      'shutdown276',
    ],
    description: 'Alert resolution: resolveAlert276, acknowledgeAlert276, unresolved alerts, manual override wiring',
  },
});

// ── Validation ───────────────────────────────────────────────────────────────

function validateProvider276(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_276[contractKey];
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

function validateAllProviders276(providersObject) {
  const allErrors = {};
  let ok = true;
  for (const [key, impl] of Object.entries(providersObject || {})) {
    if (PROVIDER_CONTRACTS_276[key]) {
      const result = validateProvider276(key, impl);
      if (!result.ok) { allErrors[key] = result.errors; ok = false; }
    }
  }
  return { ok, allErrors };
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function createAlertResolutionStub276(opts = {}) {
  const { AlertResolution276 } = require('./alertResolution276');
  return new AlertResolution276(opts);
}

function createAllStubs276(opts = {}) {
  const base = createAllStubs275(opts);
  return {
    ...base,
    alertResolution: createAlertResolutionStub276(opts),
  };
}

// ── Scaffold helper ───────────────────────────────────────────────────────────

function createAdapterScaffold276(contractKey, opts = {}) {
  if (contractKey === 'alertResolution') return createAlertResolutionStub276(opts);
  const { createAdapterScaffold275 } = require('./providerAdapters275Canon483');
  return createAdapterScaffold275(contractKey, opts);
}

module.exports = {
  PROVIDER_CONTRACTS_276,
  validateProvider276,
  validateAllProviders276,
  createAlertResolutionStub276,
  createAllStubs276,
  createAdapterScaffold276,
};
