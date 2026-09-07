'use strict';
/**
 * src/lib/providerAdapters274.js — Provider Adapter Scaffolds & Validators (V274)
 *
 * Extends providerAdapters273 with:
 *   1. 1 new contract: eventFeedBridge — total 24 contracts
 *   2. createEventFeedBridgeStub274() factory
 *   3. createAllStubs274()
 *   4. validateProvider274() / validateAllProviders274()
 *
 * Zero new npm deps. Identifiers end with 274.
 */

const { PROVIDER_CONTRACTS_273, validateProvider273, createAllStubs273 } = require('./providerAdapters273');

// ── New V274 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_274 = Object.freeze({
  ...PROVIDER_CONTRACTS_273,

  eventFeedBridge: {
    required: ['wireHooks274', 'unwireHooks274', 'addSseClient274',
               'removeSseClient274', 'getStatus274'],
    optional: ['startHeartbeat274', 'startSnapshotPersistence274', 'shutdown274',
               'getPerf274', 'checkEventFeedBridgeHealth274'],
    description: 'Live event feed bridge: auto-wires sybil/tip hooks and broadcasts SSE counter updates',
  },
});

// ── Validation ───────────────────────────────────────────────────────────────

function validateProvider274(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_274[contractKey];
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

function validateAllProviders274(providersObject) {
  const allErrors = {};
  let ok = true;
  for (const [key, impl] of Object.entries(providersObject || {})) {
    if (PROVIDER_CONTRACTS_274[key]) {
      const result = validateProvider274(key, impl);
      if (!result.ok) { allErrors[key] = result.errors; ok = false; }
    }
  }
  return { ok, allErrors };
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function createEventFeedBridgeStub274(opts = {}) {
  const { EventFeedBridge274 } = require('./eventFeedBridge274');
  return new EventFeedBridge274(opts);
}

function createAllStubs274(opts = {}) {
  const base = createAllStubs273(opts);
  return {
    ...base,
    eventFeedBridge: createEventFeedBridgeStub274(opts),
  };
}

// ── Scaffold helper ───────────────────────────────────────────────────────────

function createAdapterScaffold274(contractKey, opts = {}) {
  if (contractKey === 'eventFeedBridge') return createEventFeedBridgeStub274(opts);
  // Delegate to 273 for everything else
  const { createAdapterScaffold273 } = require('./providerAdapters273');
  if (typeof createAdapterScaffold273 === 'function')
    return createAdapterScaffold273(contractKey, opts);
  return null;
}

module.exports = {
  PROVIDER_CONTRACTS_274,
  validateProvider274,
  validateAllProviders274,
  createEventFeedBridgeStub274,
  createAllStubs274,
  createAdapterScaffold274,
};
