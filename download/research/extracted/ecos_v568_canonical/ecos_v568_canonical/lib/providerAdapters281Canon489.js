'use strict';
/**
 * lib/providerAdapters281Canon489.js — ECOS V489
 *
 * Canonical shim for providerAdapters281.
 * Exports the identical surface as providerAdapters281.js, adding only
 * getCanonInfo489() metadata. V282+ imports THIS file instead of
 * providerAdapters281.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → 279Canon487
 *     → 280Canon488 → 281Canon489 → (V282 imports here)
 *
 * All identifiers end in 281 (surface compat) except getCanonInfo489.
 * Zero new npm deps. Follows the providerAdapters280Canon488 pattern exactly.
 * @version 489.0.0
 */

// Delegate fully to the original 281 — shim layer only
const _base281_489 = require('./providerAdapters281.js');

const {
  PROVIDER_CONTRACTS_281,
  PROVIDER_CONTRACTS_280,
  validateProvider281,
  validateAllProviders281,
  createDigestSchedulerStub281,
  createAllStubs281,
} = _base281_489;

// ── V489 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo489() {
  return {
    version:       '489.0.0',
    file:          'providerAdapters281Canon489.js',
    role:          'canonical shim — V282+ imports here, not providerAdapters281 directly',
    delegatesTo:   'providerAdapters281.js (original chain preserved)',
    prevShim:      'providerAdapters280Canon488.js',
    contractCount: PROVIDER_CONTRACTS_281 ? Object.keys(PROVIDER_CONTRACTS_281).length : 0,
    contracts:     PROVIDER_CONTRACTS_281 ? Object.keys(PROVIDER_CONTRACTS_281) : [],
  };
}

// ── Exports (identical to 281 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_281,
  PROVIDER_CONTRACTS_280,
  validateProvider281,
  validateAllProviders281,
  createDigestSchedulerStub281,
  createAllStubs281,
  getCanonInfo489,
};
