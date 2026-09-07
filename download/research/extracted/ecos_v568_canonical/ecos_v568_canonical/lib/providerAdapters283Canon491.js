'use strict';
/**
 * lib/providerAdapters283Canon491.js — ECOS V491
 *
 * Canonical shim for providerAdapters283.
 * Exports the identical surface as providerAdapters283.js, adding only
 * getCanonInfo491() metadata. V284+ imports THIS file instead of
 * providerAdapters283.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → ... → 280Canon488 → 281Canon489 → 282Canon490
 *     → 283Canon491 → (V284 imports here)
 *
 * All identifiers end in 283 (surface compat) except getCanonInfo491.
 * Zero new npm deps. Follows the providerAdapters282Canon490 pattern exactly.
 * @version 491.0.0
 */

const _base283_491 = require('./providerAdapters283.js');

const {
  PROVIDER_CONTRACTS_283,
  validateProvider283,
  validateAllProviders283,
  createTemplateBoundChannelStub283,
  createAllStubs283,
} = _base283_491;

function getCanonInfo491() {
  return {
    version:       '491.0.0',
    file:          'providerAdapters283Canon491.js',
    role:          'canonical shim — V284+ imports here, not providerAdapters283 directly',
    delegatesTo:   'providerAdapters283.js (original chain preserved)',
    prevShim:      'providerAdapters282Canon490.js',
    contractCount: PROVIDER_CONTRACTS_283 ? Object.keys(PROVIDER_CONTRACTS_283).length : 0,
    contracts:     PROVIDER_CONTRACTS_283 ? Object.keys(PROVIDER_CONTRACTS_283) : [],
  };
}

module.exports = {
  PROVIDER_CONTRACTS_283,
  validateProvider283,
  validateAllProviders283,
  createTemplateBoundChannelStub283,
  createAllStubs283,
  getCanonInfo491,
};
