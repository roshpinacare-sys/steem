'use strict';
/**
 * src/lib/providerAdapters269.js — Provider Adapter Scaffolds & Validators (V269)
 *
 * Extends providerAdapters268 with:
 *   1. 1 new provider contract: eventBus — total 22 contracts
 *   2. All 268 contracts preserved verbatim
 *   3. createEventBusStub269() factory
 *   4. createAllStubs269() returns all 22 stubs
 *   5. validateProvider269() / validateAllProviders269()
 *
 * Zero new npm deps. Identifiers end with 269.
 */

const { PROVIDER_CONTRACTS_268, validateProvider268, createAllStubs268 } = require('./providerAdapters268');

// ── New V269 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_269 = Object.freeze({
  ...PROVIDER_CONTRACTS_268,

  eventBus: {
    required: ['publish', 'subscribe', 'unsubscribe'],
    optional: ['getHistory', 'clearHistory', 'listTopics'],
    description: 'Cross-module async event routing (pub/sub bus)',
  },
});

// ── Validation ───────────────────────────────────────────────────────────────

function validateProvider269(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_269[contractKey];
  if (!contract) {
    return { ok: false, errors: [`Unknown contract key: ${contractKey}`] };
  }
  if (contractKey === 'toolExecutor') {
    if (typeof providerObject !== 'function') {
      return { ok: false, errors: ['toolExecutor must be a function'] };
    }
    return { ok: true, errors: [] };
  }
  const errors = [];
  for (const method of (contract.required || [])) {
    if (typeof providerObject[method] !== 'function') {
      errors.push(`Missing required method: ${method}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateAllProviders269(providersObject) {
  const allErrors = {};
  let ok = true;
  for (const [key, impl] of Object.entries(providersObject || {})) {
    if (PROVIDER_CONTRACTS_269[key]) {
      const result = validateProvider269(key, impl);
      if (!result.ok) {
        allErrors[key] = result.errors;
        ok = false;
      }
    }
  }
  return { ok, allErrors };
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function createEventBusStub269({ silent = false } = {}) {
  const _log = silent ? () => {} : (msg) => console.log('[eventBusStub269]', msg);
  const _history = [];
  const _subs = new Map(); // topic → [fn, ...]

  return {
    publish(topic, payload) {
      _log(`publish topic=${topic}`);
      const event = { topic, payload, ts: Date.now() };
      _history.push(event);
      const fns = _subs.get(topic) || [];
      for (const fn of fns) {
        try { fn(event); } catch (_) {}
      }
      return { ok: true, eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    },
    subscribe(topic, fn) {
      _log(`subscribe topic=${topic}`);
      if (!_subs.has(topic)) _subs.set(topic, []);
      _subs.get(topic).push(fn);
      return { ok: true };
    },
    unsubscribe(topic, fn) {
      _log(`unsubscribe topic=${topic}`);
      if (_subs.has(topic)) {
        const fns = _subs.get(topic).filter(f => f !== fn);
        _subs.set(topic, fns);
      }
      return { ok: true };
    },
    getHistory(topic) {
      return topic ? _history.filter(e => e.topic === topic) : [..._history];
    },
    clearHistory() {
      _history.length = 0;
      return { ok: true };
    },
    listTopics() {
      return [...new Set(_history.map(e => e.topic))];
    },
  };
}

function createAllStubs269(opts = {}) {
  const base = createAllStubs268(opts);
  return {
    ...base,
    eventBus: createEventBusStub269(opts),
  };
}

// ── Scaffold helper ───────────────────────────────────────────────────────────

function createAdapterScaffold269(contractKey) {
  const contract = PROVIDER_CONTRACTS_269[contractKey];
  if (!contract) throw new Error(`Unknown contract: ${contractKey}`);
  const methods = [
    ...(contract.required || []),
    ...(contract.optional || []),
  ];
  const scaffold = {};
  for (const m of methods) {
    scaffold[m] = function() {
      throw new Error(`${contractKey}.${m}: not implemented (scaffold)`);
    };
  }
  return scaffold;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_269,
  validateProvider269,
  validateAllProviders269,
  createEventBusStub269,
  createAllStubs269,
  createAdapterScaffold269,
  // Re-export V268 for convenience
  PROVIDER_CONTRACTS_268,
  validateProvider268,
};
