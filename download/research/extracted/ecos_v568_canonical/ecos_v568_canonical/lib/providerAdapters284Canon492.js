'use strict';
/**
 * lib/providerAdapters284Canon492.js — ECOS V492
 *
 * Canonical shim for providerAdapters284.
 * Exports the identical surface as providerAdapters284.js, adding only
 * getCanonInfo492() metadata. V285+ imports THIS file instead of
 * providerAdapters284.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → ... → 281Canon489 → 282Canon490 → 283Canon491
 *     → 284Canon492 → (V285 imports here)
 *
 * All identifiers end in 284 (surface compat) except getCanonInfo492.
 * Zero new npm deps. Follows the providerAdapters283Canon491 pattern exactly.
 * @version 492.0.0
 */

const _base284_492 = require('./providerAdapters284.js');

const {
  PROVIDER_CONTRACTS_284,
  validateProvider284,
  validateAllProviders284,
  createChannelFilterStub284,
  createAllStubs284,
} = _base284_492;

function getCanonInfo492() {
  return {
    version:       '492.0.0',
    file:          'providerAdapters284Canon492.js',
    role:          'canonical shim — V285+ imports here, not providerAdapters284 directly',
    delegatesTo:   'providerAdapters284.js (original chain preserved)',
    prevShim:      'providerAdapters283Canon491.js',
    contractCount: PROVIDER_CONTRACTS_284 ? Object.keys(PROVIDER_CONTRACTS_284).length : 0,
    contracts:     PROVIDER_CONTRACTS_284 ? Object.keys(PROVIDER_CONTRACTS_284) : [],
  };
}

module.exports = {
  PROVIDER_CONTRACTS_284,
  validateProvider284,
  validateAllProviders284,
  createChannelFilterStub284,
  createAllStubs284,
  getCanonInfo492,
};
