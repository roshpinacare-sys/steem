'use strict';
/**
 * src/lib/providerAdapters278.js — Provider Adapter Scaffolds & Validators (V278)
 *
 * Extends providerAdapters277 with:
 *   1. 1 new contract: alertSla — total 28 contracts
 *   2. createAlertSlaStub278() factory
 *   3. createAllStubs278()
 *   4. validateProvider278() / validateAllProviders278()
 *
 * Zero new npm deps. Identifiers end with 278.
 */

const { PROVIDER_CONTRACTS_277, validateProvider277, createAllStubs277 } = require('./providerAdapters277Canon485'); // V485: mediated via canon shim

// ── New V278 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_278 = Object.freeze({
  ...PROVIDER_CONTRACTS_277,

  alertSla: {
    required: [
      'registerAlertSla278',
      'checkSlaBreach278',
      'getBreachedAlerts278',
      'getSlaStatus278',
      'addSlaSseClient278',
      'removeSlaSseClient278',
      'getStatus278',
    ],
    optional: [
      'getSlaConfig278',
      'deregisterAlertSla278',
      'getWarningAlerts278',
      'runSlaCheck278',
      'startSlaWatchdog278',
      'stopSlaWatchdog278',
      'startSlaHeartbeat278',
      'checkAlertSlaHealth278',
      'getEventHistory278',
      'shutdown278',
    ],
    description: 'Alert SLA timers & breach detection: registerAlertSla278, checkSlaBreach278, getBreachedAlerts278, getSlaStatus278, SSE stream',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider278(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_278[contractKey];
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

function validateAllProviders278(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };

  const results = {};
  let allOk = true;

  for (const key of Object.keys(PROVIDER_CONTRACTS_278)) {
    if (key in providersObject) {
      results[key] = validateProvider278(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }

  return { ok: allOk, results };
}

// ── Stub factories ────────────────────────────────────────────────────────────

function createAlertSlaStub278() {
  return {
    registerAlertSla278:    (alertType, opts = {}) => ({ ok: true, alertType, warningMs: opts.warningMs || 300000, breachMs: opts.breachMs || 900000, autoEscalate: false }),
    checkSlaBreach278:      (alertId) => ({ ok: true, alertId, status: 'OK', ageMs: 0, noSlaConfig: true }),
    getBreachedAlerts278:   (opts = {}) => ({ ok: true, alerts: [], total: 0 }),
    getSlaStatus278:        () => ({ ok: true, version: '278', configs: [], breachCounts: {}, warnCounts: {}, totalAlerts: 0, configCount: 0, slaRecords: 0 }),
    getSlaConfig278:        (alertType) => ({ ok: false, error: 'no SLA config', alertType }),
    deregisterAlertSla278:  (alertType) => ({ ok: true, alertType, deregisteredAt: new Date().toISOString() }),
    getWarningAlerts278:    () => ({ ok: true, alerts: [], total: 0 }),
    runSlaCheck278:         () => ({ ok: true, checked: 0, warnings: 0, breaches: 0 }),
    startSlaWatchdog278:    (intervalMs) => ({ ok: true, intervalMs: intervalMs || 5000 }),
    stopSlaWatchdog278:     () => ({ ok: true, stopped: true }),
    addSlaSseClient278:     () => null,
    removeSlaSseClient278:  (clientId) => ({ ok: true, clientId }),
    startSlaHeartbeat278:   () => undefined,
    checkAlertSlaHealth278: () => ({ ok: true, version: '278', configCount: 0, slaRecords: 0, sseClients: 0, eventHistory: 0, watchdogActive: false }),
    getEventHistory278:     (opts = {}) => ({ ok: true, events: [], total: 0 }),
    getStatus278:           () => ({ ok: true, version: '278', configCount: 0, slaRecords: 0, sseClients: 0, eventHistory: 0, watchdogActive: false }),
    shutdown278:            () => ({ ok: true, shutdown: true }),
  };
}

function createAllStubs278() {
  return {
    ...createAllStubs277(),
    alertSla: createAlertSlaStub278(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_278,
  validateProvider278,
  validateAllProviders278,
  createAlertSlaStub278,
  createAllStubs278,
};
