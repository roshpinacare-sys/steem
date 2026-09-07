'use strict';
/**
 * src/lib/providerAdapters283.js — Provider Adapter Scaffolds & Validators (V283)
 *
 * Extends providerAdapters282 with:
 *   1. 1 new contract: notificationChannel — total 33 contracts
 *   2. createTemplateBoundChannelStub283() factory
 *   3. createAllStubs283()
 *   4. validateProvider283() / validateAllProviders283()
 *
 * Zero new npm deps. Identifiers end with 283.
 */

const { PROVIDER_CONTRACTS_282, validateProvider282, createAllStubs282 } = require('./providerAdapters282');

// ── New V283 contract ─────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS_283 = Object.freeze({
  ...PROVIDER_CONTRACTS_282,

  templateBoundChannel: {
    required: [
      'registerNotificationChannel283',
      'deregisterNotificationChannel283',
      'setChannelTemplate283',
      'unsetChannelTemplate283',
      'getChannel283',
      'getChannels283',
      'notifyDigest283',
      'getStatus283',
    ],
    optional: [
      'testChannel283',
      'checkNotificationChannelHealth283',
      'getPerf283',
    ],
    description: 'Notification channels with template binding: register/remove channels, bind templates, deliver digests with per-channel rendering',
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

function validateProvider283(contractKey, providerObject) {
  const contract = PROVIDER_CONTRACTS_283[contractKey];
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

function validateAllProviders283(providersObject) {
  if (!providersObject || typeof providersObject !== 'object')
    return { ok: false, errors: ['providersObject must be an object'] };
  const results = {};
  let allOk = true;
  for (const key of Object.keys(PROVIDER_CONTRACTS_283)) {
    if (!(key in providersObject)) {
      results[key] = { ok: false, errors: [`Missing provider: ${key}`] };
      allOk = false;
    } else {
      results[key] = validateProvider283(key, providersObject[key]);
      if (!results[key].ok) allOk = false;
    }
  }
  return { ok: allOk, results };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

function createTemplateBoundChannelStub283() {
  return {
    registerNotificationChannel283:   () => ({ ok: true,  version: '283' }),
    deregisterNotificationChannel283:  () => ({ ok: true,  version: '283' }),
    setChannelTemplate283:             () => ({ ok: true,  version: '283' }),
    unsetChannelTemplate283:           () => ({ ok: true,  version: '283' }),
    getChannel283:                     () => ({ ok: false, error: 'stub', version: '283' }),
    getChannels283:                    () => ({ ok: true, channels: [], total: 0, version: '283' }),
    notifyDigest283:                   () => ({ ok: true, delivered: [], skipped: [], errors: [], version: '283' }),
    getStatus283:                      () => ({ ok: true, version: '283', channelCount: 0, deliveryLogSize: 0 }),
    testChannel283:                    () => ({ ok: false, error: 'stub', version: '283' }),
    checkNotificationChannelHealth283: () => ({ ok: true, version: '283', channelCount: 0 }),
    getPerf283:                        () => ({ p50: 0, p95: 0, p99: 0, count: 0 }),
  };
}

function createAllStubs283() {
  return {
    ...createAllStubs282(),
    templateBoundChannel: createTemplateBoundChannelStub283(),
  };
}

module.exports = {
  PROVIDER_CONTRACTS_283,
  validateProvider283,
  validateAllProviders283,
  createTemplateBoundChannelStub283,
  createAllStubs283,
};
