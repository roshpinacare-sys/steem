'use strict';
/**
 * src/lib/providerAdapters280.js — Provider Adapter Scaffolds & Validators (V280)
 *
 * Extends providerAdapters279 with:
 *   1. 1 new contract: notificationChannel — total 30 contracts
 *   2. createNotificationChannelStub280() factory
 *   3. createAllStubs280()
 *   4. validateProvider280() / validateAllProviders280()
 *
 * Zero new npm deps. Identifiers end with 280.
 */

const { PROVIDER_CONTRACTS_279, validateProvider279, createAllStubs279 } = require('./providerAdapters279Canon487.js'); // V487: mediated via canonical shim

// ── New V280 contract ─────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_280 = Object.freeze({
  ...PROVIDER_CONTRACTS_279,

  notificationChannel: {
    required: [
      'registerNotificationChannel280',
      'deregisterNotificationChannel280',
      'notifyDigest280',
      'getChannels280',
      'getNotificationHistory280',
      'getStatus280',
      'addNotificationSseClient280',
      'removeNotificationSseClient280',
    ],
    optional: [
      'checkNotificationChannelHealth280',
      'getPerf280',
      'shutdown280',
    ],
    description: 'Alert notification delivery: registerNotificationChannel280, notifyDigest280, channel registry, SSE stream',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider280(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_280[contractKey];
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

function validateAllProviders280(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };

  const results = {};
  let allOk = true;

  for (const key of Object.keys(PROVIDER_CONTRACTS_280)) {
    if (key in providersObject) {
      results[key] = validateProvider280(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }

  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createNotificationChannelStub280() {
  return {
    registerNotificationChannel280:   (name, opts = {}) => ({ ok: true, name, url: opts.url || null, alertTypes: [], minSeverity: 'INFO', onlyBreached: false, maxRetries: 3, registeredAt: new Date().toISOString(), version: '280' }),
    deregisterNotificationChannel280: (name)            => ({ ok: true, name, version: '280' }),
    notifyDigest280:                  async (digest, opts = {}) => ({ ok: true, attempted: 0, delivered: 0, failed: 0, deliveries: [], version: '280', ts: new Date().toISOString() }),
    getChannels280:                   ()          => ({ ok: true, channels: [], total: 0, version: '280' }),
    getNotificationHistory280:        (opts = {}) => ({ ok: true, deliveries: [], total: 0, version: '280' }),
    getStatus280:                     ()          => ({ ok: true, version: '280', channelCount: 0, deliveryCount: 0, pendingRetries: 0, sseClients: 0 }),
    addNotificationSseClient280:      (res)       => 'stub-client-id',
    removeNotificationSseClient280:   (clientId)  => ({ ok: true, clientId, version: '280' }),
    checkNotificationChannelHealth280: ()         => ({ ok: true, version: '280', channelCount: 0, deliveryCount: 0, pendingRetries: 0, sseClients: 0 }),
    getPerf280:                       ()          => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
    shutdown280:                      ()          => ({ ok: true, shutdown: true, version: '280' }),
  };
}

function createAllStubs280() {
  return {
    ...createAllStubs279(),
    notificationChannel: createNotificationChannelStub280(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_280,
  validateProvider280,
  validateAllProviders280,
  createNotificationChannelStub280,
  createAllStubs280,
};
