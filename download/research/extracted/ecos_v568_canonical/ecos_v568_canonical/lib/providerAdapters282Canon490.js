'use strict';
/**
 * lib/providerAdapters282Canon490.js — ECOS V490
 *
 * Canonical shim for providerAdapters282.
 * Exports the identical surface as providerAdapters282.js, adding only
 * getCanonInfo490() metadata. V283+ imports THIS file instead of
 * providerAdapters282.js directly, so the link is mediated and traceable.
 *
 * Chain:
 *   275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → 279Canon487
 *     → 280Canon488 → 281Canon489 → 282Canon490 → (V283 imports here)
 *
 * All identifiers end in 282 (surface compat) except getCanonInfo490.
 * Zero new npm deps. Follows the providerAdapters281Canon489 pattern exactly.
 * @version 490.0.0
 */

// Delegate fully to the original 282 — shim layer only
const _base282_490 = require('./providerAdapters282.js');

const {
  PROVIDER_CONTRACTS_282,
  PROVIDER_CONTRACTS_281,
  validateProvider282,
  validateAllProviders282,
  createNotificationTemplateStub282,
  createAllStubs282,
} = _base282_490;

// ── V490 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo490() {
  return {
    version:       '490.0.0',
    file:          'providerAdapters282Canon490.js',
    role:          'canonical shim — V283+ imports here, not providerAdapters282 directly',
    delegatesTo:   'providerAdapters282.js (original chain preserved)',
    prevShim:      'providerAdapters281Canon489.js',
    contractCount: PROVIDER_CONTRACTS_282 ? Object.keys(PROVIDER_CONTRACTS_282).length : 0,
    contracts:     PROVIDER_CONTRACTS_282 ? Object.keys(PROVIDER_CONTRACTS_282) : [],
  };
}

// ── Exports (identical to 282 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_282,
  PROVIDER_CONTRACTS_281,
  validateProvider282,
  validateAllProviders282,
  createNotificationTemplateStub282,
  createAllStubs282,
  getCanonInfo490,
};
