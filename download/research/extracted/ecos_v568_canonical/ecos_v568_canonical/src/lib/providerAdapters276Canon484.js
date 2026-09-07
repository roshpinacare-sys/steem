'use strict';
/**
 * src/lib/providerAdapters276Canon484.js — ECOS V484
 *
 * Canonical shim for providerAdapters276.
 * Exports the identical surface as providerAdapters276.js, adding only
 * getCanonInfo484() metadata. V277+ imports THIS file instead of
 * providerAdapters276.js directly, so the link is mediated and traceable.
 *
 * Chain so far:
 *   275Canon483 → 276Canon484 → (V277 imports here)
 *
 * All identifiers end in 276 (surface compat) except getCanonInfo484.
 * Zero new npm deps. Follows the providerAdapters275Canon483 pattern exactly.
 * @version 484.0.0
 */

// Delegate fully to the original 276 — shim layer only
const _base276_484 = require('./providerAdapters276.js');

const {
  PROVIDER_CONTRACTS_276,
  validateProvider276,
  validateAllProviders276,
  createAlertResolutionStub276,
  createAllStubs276,
  createAdapterScaffold276,
} = _base276_484;

// ── V484 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo484() {
  return {
    version:       '484.0.0',
    file:          'providerAdapters276Canon484.js',
    role:          'canonical shim — V277+ imports here, not providerAdapters276 directly',
    delegatesTo:   'providerAdapters276.js (original chain preserved)',
    prevShim:      'providerAdapters275Canon483.js',
    contractCount: Object.keys(PROVIDER_CONTRACTS_276).length,
    contracts:     Object.keys(PROVIDER_CONTRACTS_276),
  };
}

// ── Exports (identical to 276 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_276,
  validateProvider276,
  validateAllProviders276,
  createAlertResolutionStub276,
  createAllStubs276,
  createAdapterScaffold276,
  getCanonInfo484,
};
