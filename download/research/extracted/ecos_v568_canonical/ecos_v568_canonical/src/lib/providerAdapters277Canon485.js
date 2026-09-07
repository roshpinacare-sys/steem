'use strict';
/**
 * src/lib/providerAdapters277Canon485.js — ECOS V485
 *
 * Canonical shim for providerAdapters277.
 * Exports the identical surface as providerAdapters277.js, adding only
 * getCanonInfo485() metadata. V278+ imports THIS file instead of
 * providerAdapters277.js directly, so the link is mediated and traceable.
 *
 * Chain so far:
 *   275Canon483 → 276Canon484 → 277Canon485 → (V278 imports here)
 *
 * All identifiers end in 277 (surface compat) except getCanonInfo485.
 * Zero new npm deps. Follows the providerAdapters276Canon484 pattern exactly.
 * @version 485.0.0
 */

// Delegate fully to the original 277 — shim layer only
const _base277_485 = require('./providerAdapters277.js');

const {
  PROVIDER_CONTRACTS_277,
  validateProvider277,
  validateAllProviders277,
  createAlertEscalationStub277,
  createAllStubs277,
} = _base277_485;

// ── V485 Canon metadata ───────────────────────────────────────────────────────

function getCanonInfo485() {
  return {
    version:       '485.0.0',
    file:          'providerAdapters277Canon485.js',
    role:          'canonical shim — V278+ imports here, not providerAdapters277 directly',
    delegatesTo:   'providerAdapters277.js (original chain preserved)',
    prevShim:      'providerAdapters276Canon484.js',
    contractCount: Object.keys(PROVIDER_CONTRACTS_277).length,
    contracts:     Object.keys(PROVIDER_CONTRACTS_277),
  };
}

// ── Exports (identical to 277 + canon metadata) ───────────────────────────────

module.exports = {
  PROVIDER_CONTRACTS_277,
  validateProvider277,
  validateAllProviders277,
  createAlertEscalationStub277,
  createAllStubs277,
  getCanonInfo485,
};
