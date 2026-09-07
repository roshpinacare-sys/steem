'use strict';
/**
 * src/lib/providerAdapters279.js — Provider Adapter Scaffolds & Validators (V279)
 *
 * Extends providerAdapters278 with:
 *   1. 1 new contract: alertDigest — total 29 contracts
 *   2. createAlertDigestStub279() factory
 *   3. createAllStubs279()
 *   4. validateProvider279() / validateAllProviders279()
 *
 * Zero new npm deps. Identifiers end with 279.
 */

const { PROVIDER_CONTRACTS_278, validateProvider278, createAllStubs278 } = require('./providerAdapters278Canon486');

// ── New V279 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_279 = Object.freeze({
  ...PROVIDER_CONTRACTS_278,

  alertDigest: {
    required: [
      'aggregateAlerts279',
      'generateAlertDigest279',
      'getDigestHistory279',
      'addDigestSseClient279',
      'removeDigestSseClient279',
      'getStatus279',
    ],
    optional: [
      'startDigestScheduler279',
      'stopDigestScheduler279',
      'startDigestHeartbeat279',
      'checkAlertDigestHealth279',
      'shutdown279',
    ],
    description: 'Alert aggregation & digest reporting: aggregateAlerts279, generateAlertDigest279, digest history, SSE stream',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider279(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_279[contractKey];
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

function validateAllProviders279(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };

  const results = {};
  let allOk = true;

  for (const key of Object.keys(PROVIDER_CONTRACTS_279)) {
    if (key in providersObject) {
      results[key] = validateProvider279(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }

  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createAlertDigestStub279() {
  return {
    aggregateAlerts279:       (opts = {}) => ({ ok: true, byType: {}, bySeverity: {}, byAssignee: {}, topBreachedTypes: [], escalationSummary: { totalEscalated: 0, byType: [] }, totalAlerts: 0, unresolvedCount: 0, escalatedCount: 0, ts: new Date().toISOString() }),
    generateAlertDigest279:   (opts = {}) => ({ ok: true, digestId: 'stub', version: '279', period: 'stub', totalAlerts: 0, unresolved: 0, breached: null, warned: null, escalated: 0, topTypes: [], escalationSummary: { totalEscalated: 0, byType: [] }, slaSnapshot: null, ts: new Date().toISOString() }),
    getDigestHistory279:      (opts = {}) => ({ ok: true, digests: [], total: 0 }),
    addDigestSseClient279:    (res)       => 'stub-client-id',
    removeDigestSseClient279: (clientId)  => ({ ok: true, clientId }),
    getStatus279:             ()          => ({ ok: true, version: '279', digestCount: 0, schedulerActive: false, schedulerInterval: null, sseClients: 0 }),
    startDigestScheduler279:  (ms)        => ({ ok: true, intervalMs: ms || 60000 }),
    stopDigestScheduler279:   ()          => ({ ok: true, stopped: true }),
    startDigestHeartbeat279:  ()          => undefined,
    checkAlertDigestHealth279: ()         => ({ ok: true, version: '279', digestCount: 0, schedulerActive: false, schedulerInterval: null, sseClients: 0 }),
    shutdown279:              ()          => ({ ok: true, shutdown: true }),
  };
}

function createAllStubs279() {
  return {
    ...createAllStubs278(),
    alertDigest: createAlertDigestStub279(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_279,
  validateProvider279,
  validateAllProviders279,
  createAlertDigestStub279,
  createAllStubs279,
};
