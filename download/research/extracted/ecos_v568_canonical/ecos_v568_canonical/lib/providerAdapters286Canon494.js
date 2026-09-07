'use strict';
/**
 * lib/providerAdapters286Canon494.js — ECOS V494
 *
 * Canonical shim for providerAdapters286 — the TIP of the providerAdapters tower.
 * Exports the identical surface as providerAdapters286.js, adding only
 * getCanonInfo494() metadata.
 *
 * KEY: providerAdaptersCanon476 (the main facade) previously imported
 * providerAdapters286.js directly. V494 updates it to import THIS shim,
 * completing the full mediated chain from 275Canon483 to 286Canon494.
 *
 * Chain (complete):
 *   275Canon483 → 276Canon484 → 277Canon485 → 278Canon486 → 279Canon487
 *     → 280Canon488 → 281Canon489 → 282Canon490 → 283Canon491 → 284Canon492
 *     → 285Canon493 → 286Canon494 → providerAdaptersCanon476 (facade)
 *
 * Zero new npm deps. Follows the providerAdapters285Canon493 pattern exactly.
 * @version 494.0.0
 */

const _base286_494 = require('./providerAdapters286.js');

const {
  PROVIDER_CONTRACTS_286,
  validateProvider286,
  validateAllProviders286,
  createPresetGroupsStub286,
  createAllStubs286,
} = _base286_494;

function getCanonInfo494() {
  return {
    version:       '494.0.0',
    file:          'providerAdapters286Canon494.js',
    role:          'canonical shim — TIP of tower; Canon476 facade imports here',
    delegatesTo:   'providerAdapters286.js (original chain preserved)',
    prevShim:      'providerAdapters285Canon493.js',
    chainComplete: true,
    contractCount: PROVIDER_CONTRACTS_286 ? Object.keys(PROVIDER_CONTRACTS_286).length : 0,
    contracts:     PROVIDER_CONTRACTS_286 ? Object.keys(PROVIDER_CONTRACTS_286) : [],
  };
}

module.exports = {
  PROVIDER_CONTRACTS_286,
  validateProvider286,
  validateAllProviders286,
  createPresetGroupsStub286,
  createAllStubs286,
  getCanonInfo494,
};
