'use strict';
/**
 * lib/providerAdapters280Canon488.js — ECOS V488
 *
 * Canonical shim for providerAdapters280.
 * Exports the identical surface as providerAdapters280.js, adding only
 * getCanonInfo488() metadata. V281+ imports THIS file instead of
 * providerAdapters280.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → 279Canon487 → 280Canon488 → (V281 imports here)
 *
 * All identifiers end in 280 (surface compat) except getCanonInfo488.
 * Zero new npm deps. Follows the providerAdapters279Canon487 pattern exactly.
 * @version 488.0.0
 */

// Delegate fully to the original 280 — shim layer only
const _base280_488 = require('./providerAdapters280.js');

const {
  PROVIDER_CONTRACTS_280,
  validateProvider280,
  validateAllProviders280,
  createNotificationChannelStub280,
  createAllStubs280,
} = _base280_488;

// ── V488 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo488() {
  return {
    version:       '488.0.0',
    file:          'providerAdapters280Canon488.js',
    role:          'canonical shim — V281+ imports here, not providerAdapters280 directly',
    delegatesTo:   'providerAdapters280.js (original chain preserved)',
    prevShim:      'providerAdapters279Canon487.js',
    contractCount: PROVIDER_CONTRACTS_280 ? Object.keys(PROVIDER_CONTRACTS_280).length : 0,
    contracts:     PROVIDER_CONTRACTS_280 ? Object.keys(PROVIDER_CONTRACTS_280) : [],
  };
}

// ── Exports (identical to 280 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_280,
  validateProvider280,
  validateAllProviders280,
  createNotificationChannelStub280,
  createAllStubs280,
  getCanonInfo488,
};
