'use strict';
/**
 * lib/providerAdapters285Canon493.js — ECOS V493
 *
 * Canonical shim for providerAdapters285.
 * Exports the identical surface as providerAdapters285.js, adding only
 * getCanonInfo493() metadata. V286+ imports THIS file instead of
 * providerAdapters285.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → ... → 282Canon490 → 283Canon491 → 284Canon492
 *     → 285Canon493 → (V286 imports here)
 *
 * All identifiers end in 285 (surface compat) except getCanonInfo493.
 * Zero new npm deps. Follows the providerAdapters284Canon492 pattern exactly.
 * @version 493.0.0
 */

const _base285_493 = require('./providerAdapters285.js');

const {
  PROVIDER_CONTRACTS_285,
  validateProvider285,
  validateAllProviders285,
  createFilterPresetsStub285,
  createAllStubs285,
} = _base285_493;

function getCanonInfo493() {
  return {
    version:       '493.0.0',
    file:          'providerAdapters285Canon493.js',
    role:          'canonical shim — V286+ imports here, not providerAdapters285 directly',
    delegatesTo:   'providerAdapters285.js (original chain preserved)',
    prevShim:      'providerAdapters284Canon492.js',
    contractCount: PROVIDER_CONTRACTS_285 ? Object.keys(PROVIDER_CONTRACTS_285).length : 0,
    contracts:     PROVIDER_CONTRACTS_285 ? Object.keys(PROVIDER_CONTRACTS_285) : [],
  };
}

module.exports = {
  PROVIDER_CONTRACTS_285,
  validateProvider285,
  validateAllProviders285,
  createFilterPresetsStub285,
  createAllStubs285,
  getCanonInfo493,
};
