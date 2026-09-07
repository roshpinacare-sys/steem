'use strict';
/**
 * src/lib/providerAdapters277.js — Provider Adapter Scaffolds & Validators (V277)
 *
 * Extends providerAdapters276 with:
 *   1. 1 new contract: alertEscalation — total 27 contracts
 *   2. createAlertEscalationStub277() factory
 *   3. createAllStubs277()
 *   4. validateProvider277() / validateAllProviders277()
 *
 * Zero new npm deps. Identifiers end with 277.
 */

const { PROVIDER_CONTRACTS_276, validateProvider276, createAllStubs276 } = require('./providerAdapters276Canon484'); // V484: mediated via canon shim

// ── New V277 contract ────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_277 = Object.freeze({
  ...PROVIDER_CONTRACTS_276,

  alertEscalation: {
    required: [
      'escalateAlert277',
      'assignAlert277',
      'getAssignedAlerts277',
      'getEscalatedAlerts277',
      'addEscalationSseClient277',
      'removeEscalationSseClient277',
      'getStatus277',
    ],
    optional: [
      'deescalateAlert277',
      'unassignAlert277',
      'startEscalationHeartbeat277',
      'checkAlertEscalationHealth277',
      'getEventHistory277',
      'shutdown277',
    ],
    description: 'Alert escalation & assignment: escalateAlert277, assignAlert277, getAssignedAlerts277, getEscalatedAlerts277, SSE stream',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider277(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_277[contractKey];
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

function validateAllProviders277(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };

  const results = {};
  let allOk = true;

  for (const key of Object.keys(PROVIDER_CONTRACTS_277)) {
    if (key in providersObject) {
      results[key] = validateProvider277(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }

  return { ok: allOk, results };
}

// ── Stub factories ────────────────────────────────────────────────────────────

function createAlertEscalationStub277() {
  return {
    escalateAlert277:           (alertId, opts = {}) => ({ ok: true, alertId, escalatedAt: new Date().toISOString(), priority: 'HIGH', alertFound: false }),
    assignAlert277:             (alertId, assignee) => ({ ok: true, alertId, assignee, assignedAt: new Date().toISOString(), alertFound: false }),
    getAssignedAlerts277:       (assignee) => ({ ok: true, assignee, alerts: [], total: 0 }),
    getEscalatedAlerts277:      () => ({ ok: true, alerts: [], total: 0 }),
    deescalateAlert277:         (alertId) => ({ ok: true, alertId, deescalatedAt: new Date().toISOString() }),
    unassignAlert277:           (alertId) => ({ ok: true, alertId, unassignedAt: new Date().toISOString(), prevAssignee: null }),
    addEscalationSseClient277:  () => null,
    removeEscalationSseClient277: (clientId) => ({ ok: true, clientId }),
    startEscalationHeartbeat277: () => undefined,
    checkAlertEscalationHealth277: () => ({ ok: true, version: '277', escalations: 0, assignments: 0, assignees: 0, sseClients: 0, eventHistory: 0 }),
    getEventHistory277:         (opts = {}) => ({ ok: true, events: [], total: 0 }),
    getStatus277:               () => ({ ok: true, version: '277', escalations: 0, assignments: 0, assignees: 0, sseClients: 0, eventHistory: 0 }),
    shutdown277:                () => ({ ok: true, shutdown: true }),
  };
}

function createAllStubs277() {
  return {
    ...createAllStubs276(),
    alertEscalation: createAlertEscalationStub277(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_277,
  validateProvider277,
  validateAllProviders277,
  createAlertEscalationStub277,
  createAllStubs277,
};
