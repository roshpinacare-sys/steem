'use strict';
/**
 * src/lib/providerAdapters281.js — Provider Adapter Scaffolds & Validators (V281)
 *
 * Extends providerAdapters280 with:
 *   1. 1 new contract: digestScheduler — total 31 contracts
 *   2. createDigestSchedulerStub281() factory
 *   3. createAllStubs281()
 *   4. validateProvider281() / validateAllProviders281()
 *
 * Zero new npm deps. Identifiers end with 281.
 */

const { PROVIDER_CONTRACTS_280, validateProvider280, createAllStubs280 } = require('./providerAdapters280Canon488.js'); // V488: mediated via canonical shim

// ── New V281 contract ─────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_281 = Object.freeze({
  ...PROVIDER_CONTRACTS_280,

  digestScheduler: {
    required: [
      'registerDigestSchedule281',
      'deregisterDigestSchedule281',
      'pauseSchedule281',
      'resumeSchedule281',
      'getSchedules281',
      'getScheduleHistory281',
      'getStatus281',
    ],
    optional: [
      'checkDigestSchedulerHealth281',
      'getPerf281',
      'addScheduleSseClient281',
      'removeScheduleSseClient281',
      'shutdown281',
    ],
    description: 'Scheduled digest+notification cycles: register/pause/resume/remove schedules, SSE stream',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider281(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_281[contractKey];
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

function validateAllProviders281(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };

  const results = {};
  let allOk = true;

  for (const key of Object.keys(PROVIDER_CONTRACTS_281)) {
    if (key in providersObject) {
      results[key] = validateProvider281(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }

  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createDigestSchedulerStub281() {
  return {
    registerDigestSchedule281:  (name, opts = {}) => ({ ok: true, name, intervalMs: opts.intervalMs || 60000, channels: [], period: 'scheduled', paused: false, registeredAt: new Date().toISOString(), version: '281' }),
    deregisterDigestSchedule281: (name) => ({ ok: true, name, version: '281' }),
    pauseSchedule281:           (name) => ({ ok: true, name, paused: true, version: '281' }),
    resumeSchedule281:          (name) => ({ ok: true, name, paused: false, version: '281' }),
    getSchedules281:            () => ({ ok: true, schedules: [], total: 0, version: '281' }),
    getScheduleHistory281:      (opts = {}) => ({ ok: true, runs: [], total: 0, version: '281' }),
    getStatus281:               () => ({ ok: true, version: '281', activeSchedules: 0, pausedSchedules: 0, totalRuns: 0, sseClients: 0 }),
    checkDigestSchedulerHealth281: () => ({ ok: true, version: '281', activeSchedules: 0, pausedSchedules: 0, totalRuns: 0, pendingTimers: 0, sseClients: 0 }),
    getPerf281:                 () => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
    addScheduleSseClient281:    (res) => 'stub-client-id',
    removeScheduleSseClient281: (clientId) => {},
    shutdown281:                () => {},
  };
}

function createAllStubs281() {
  return {
    ...createAllStubs280(),
    digestScheduler: createDigestSchedulerStub281(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_281,
  PROVIDER_CONTRACTS_280,
  validateProvider281,
  validateAllProviders281,
  createDigestSchedulerStub281,
  createAllStubs281,
};
