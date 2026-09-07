'use strict';
/**
 * src/lib/providerAdapters275Canon483.js — ECOS V483
 *
 * Canonical shim for providerAdapters275.
 * Exports the identical surface as providerAdapters275.js, adding only
 * getCanonInfo483() metadata. V276+ imports THIS file instead of the
 * original providerAdapters275.js to register that the chain link is
 * mediated by V483.
 *
 * Why not re-write from scratch: the 274→273→...→269 chain does not run
 * through Canon476 (which would create a circular dependency). Instead,
 * we keep the existing chain intact and add a shim layer so that any
 * module importing '275Canon483' gets the same contracts + metadata.
 *
 * All identifiers end in 275 (surface compat) except getCanonInfo483.
 * Zero new npm deps.
 * @version 483.0.0
 */

// Delegate fully to the original 275 — shim layer only
const _base275_483 = require('./providerAdapters275.js');

const {
  PROVIDER_CONTRACTS_275,
  validateProvider275,
  validateAllProviders275,
  createCounterAlertBusStub275,
  createAllStubs275,
  createAdapterScaffold275,
} = _base275_483;

// ── V483 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo483() {
  return {
    version:       '483.0.0',
    file:          'providerAdapters275Canon483.js',
    role:          'canonical shim — V276+ imports here, not providerAdapters275 directly',
    delegatesTo:   'providerAdapters275.js (original chain preserved)',
    contractCount: Object.keys(PROVIDER_CONTRACTS_275).length,
    contracts:     Object.keys(PROVIDER_CONTRACTS_275),
  };
}

// ── Exports (identical to 275 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_275,
  validateProvider275,
  validateAllProviders275,
  createCounterAlertBusStub275,
  createAllStubs275,
  createAdapterScaffold275,
  getCanonInfo483,
};
