'use strict';
/**
 * src/lib/providerAdapters279Canon487.js — ECOS V487
 *
 * Canonical shim for providerAdapters279.
 * Exports the identical surface as providerAdapters279.js, adding only
 * getCanonInfo487() metadata. V280+ imports THIS file instead of
 * providerAdapters279.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → 279Canon487 → (V280 imports here)
 *
 * All identifiers end in 279 (surface compat) except getCanonInfo487.
 * Zero new npm deps. Follows the providerAdapters278Canon486 pattern exactly.
 * @version 487.0.0
 */

// Delegate fully to the original 279 — shim layer only
const _base279_487 = require('./providerAdapters279.js');

const {
  PROVIDER_CONTRACTS_279,
  validateProvider279,
  validateAllProviders279,
  createAlertDigestStub279,
  createAllStubs279,
} = _base279_487;

// ── V487 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo487() {
  return {
    version:       '487.0.0',
    file:          'providerAdapters279Canon487.js',
    role:          'canonical shim — V280+ imports here, not providerAdapters279 directly',
    delegatesTo:   'providerAdapters279.js (original chain preserved)',
    prevShim:      'providerAdapters278Canon486.js',
    contractCount: PROVIDER_CONTRACTS_279 ? Object.keys(PROVIDER_CONTRACTS_279).length : 0,
    contracts:     PROVIDER_CONTRACTS_279 ? Object.keys(PROVIDER_CONTRACTS_279) : [],
  };
}

// ── Exports (identical to 279 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_279,
  validateProvider279,
  validateAllProviders279,
  createAlertDigestStub279,
  createAllStubs279,
  getCanonInfo487,
};
