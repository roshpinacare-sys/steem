'use strict';
/**
 * src/lib/providerAdapters278Canon486.js — ECOS V486
 *
 * Canonical shim for providerAdapters278.
 * Exports the identical surface as providerAdapters278.js, adding only
 * getCanonInfo486() metadata. V279+ imports THIS file instead of
 * providerAdapters278.js directly, so the link is mediated and traceable.
 *
 * Chain so far:
 *   275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → (V279 imports here)
 *
 * All identifiers end in 278 (surface compat) except getCanonInfo486.
 * Zero new npm deps. Follows the providerAdapters277Canon485 pattern exactly.
 * @version 486.0.0
 */

// Delegate fully to the original 278 — shim layer only
const _base278_486 = require('./providerAdapters278.js');

const {
  PROVIDER_CONTRACTS_278,
  validateProvider278,
  validateAllProviders278,
  createAlertSlaStub278,
  createAllStubs278,
} = _base278_486;

// ── V486 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo486() {
  return {
    version:       '486.0.0',
    file:          'providerAdapters278Canon486.js',
    role:          'canonical shim — V279+ imports here, not providerAdapters278 directly',
    delegatesTo:   'providerAdapters278.js (original chain preserved)',
    prevShim:      'providerAdapters277Canon485.js',
    contractCount: Object.keys(PROVIDER_CONTRACTS_278).length,
    contracts:     Object.keys(PROVIDER_CONTRACTS_278),
  };
}

// ── Exports (identical to 278 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_278,
  validateProvider278,
  validateAllProviders278,
  createAlertSlaStub278,
  createAllStubs278,
  getCanonInfo486,
};
