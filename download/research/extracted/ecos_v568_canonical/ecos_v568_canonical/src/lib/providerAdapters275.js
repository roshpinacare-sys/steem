'use strict';
/**
 * src/lib/providerAdapters275.js — Provider Adapter Scaffolds & Validators (V275)
 *
 * Extends providerAdapters274 with:
 *   1. 1 new contract: counterAlertBus — total 25 contracts
 *   2. createCounterAlertBusStub275() factory
 *   3. createAllStubs275()
 *   4. validateProvider275() / validateAllProviders275()
 *
 * Zero new npm deps. Identifiers end with 275.
 */

const { PROVIDER_CONTRACTS_274, validateProvider274, createAllStubs274 } = require('./providerAdapters274');

// ── New V275 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_275 = Object.freeze({
  ...PROVIDER_CONTRACTS_274,

  counterAlertBus: {
    required: ['subscribe275', 'unsubscribe275', 'onAlert275', 'offAlert275',
               'addAlertSseClient275', 'removeAlertSseClient275', 'getHistory275', 'getStatus275'],
    optional: ['startAlertHeartbeat275', 'getPerf275', 'checkCounterAlertBusHealth275', 'shutdown275'],
    description: 'Counter alert bus: subscribes to SSE counter stream and fires alerts when thresholds are crossed',
  },
});

// ── Validation ───────────────────────────────────────────────────────────────

function validateProvider275(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_275[contractKey];
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

function validateAllProviders275(providersObject) {
  const allErrors = {};
  let ok = true;
  for (const [key, impl] of Object.entries(providersObject || {})) {
    if (PROVIDER_CONTRACTS_275[key]) {
      const result = validateProvider275(key, impl);
      if (!result.ok) { allErrors[key] = result.errors; ok = false; }
    }
  }
  return { ok, allErrors };
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function createCounterAlertBusStub275(opts = {}) {
  const { CounterAlertBus275 } = require('./counterAlertBus275');
  return new CounterAlertBus275(opts);
}

function createAllStubs275(opts = {}) {
  const base = createAllStubs274(opts);
  return {
    ...base,
    counterAlertBus: createCounterAlertBusStub275(opts),
  };
}

// ── Scaffold helper ───────────────────────────────────────────────────────────

function createAdapterScaffold275(contractKey, opts = {}) {
  if (contractKey === 'counterAlertBus') return createCounterAlertBusStub275(opts);
  const { createAdapterScaffold274 } = require('./providerAdapters274');
  return createAdapterScaffold274(contractKey, opts);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_275,
  validateProvider275,
  validateAllProviders275,
  createCounterAlertBusStub275,
  createAllStubs275,
  createAdapterScaffold275,
};
