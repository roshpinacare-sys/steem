'use strict';
/**
 * src/lib/providerAdapters282.js — Provider Adapter Scaffolds & Validators (V282)
 *
 * Extends providerAdapters281 with:
 *   1. 1 new contract: notificationTemplate — total 32 contracts
 *   2. createNotificationTemplateStub282() factory
 *   3. createAllStubs282()
 *   4. validateProvider282() / validateAllProviders282()
 *
 * Zero new npm deps. Identifiers end with 282.
 */

const { PROVIDER_CONTRACTS_281, validateProvider281, createAllStubs281 } = require('./providerAdapters281');

// ── New V282 contract ─────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_282 = Object.freeze({
  ...PROVIDER_CONTRACTS_281,

  notificationTemplate: {
    required: [
      'registerNotificationTemplate282',
      'deregisterNotificationTemplate282',
      'getTemplates282',
      'getTemplate282',
      'renderTemplate282',
      'getStatus282',
    ],
    optional: [
      'previewTemplate282',
      'checkNotificationTemplateHealth282',
      'getPerf282',
    ],
    description: 'Notification templates: Mustache-style rendering, register/remove templates, preview with sample digest',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider282(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_282[contractKey];
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

function validateAllProviders282(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };

  const results = {};
  let allOk = true;

  for (const key of Object.keys(PROVIDER_CONTRACTS_282)) {
    if (key in providersObject) {
      results[key] = validateProvider282(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }

  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createNotificationTemplateStub282() {
  return {
    registerNotificationTemplate282:   (name, opts = {}) => ({ ok: true, name, contentType: opts.contentType || 'text', registeredAt: new Date().toISOString(), version: '282' }),
    deregisterNotificationTemplate282: (name)            => ({ ok: true, name, version: '282' }),
    getTemplates282:                   ()                => ({ ok: true, templates: [], total: 0, version: '282' }),
    getTemplate282:                    (name)            => ({ ok: false, error: `template '${name}' not found`, version: '282' }),
    renderTemplate282:                 (name, ctx = {})  => ({ ok: true, name, subject: '', body: '', contentType: 'text', version: '282' }),
    getStatus282:                      ()                => ({ ok: true, version: '282', templateCount: 0 }),
    previewTemplate282:                (name, sample = {}) => ({ ok: true, name, subject: '', body: '', contentType: 'text', sampleContext: {}, version: '282' }),
    checkNotificationTemplateHealth282: ()               => ({ ok: true, version: '282', templateCount: 0 }),
    getPerf282:                        ()                => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
  };
}

function createAllStubs282() {
  return {
    ...createAllStubs281(),
    notificationTemplate: createNotificationTemplateStub282(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_282,
  PROVIDER_CONTRACTS_281,
  validateProvider282,
  validateAllProviders282,
  createNotificationTemplateStub282,
  createAllStubs282,
};
