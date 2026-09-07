'use strict';
/**
 * src/lib/meshDispatcherCanon474.js — ECOS V474
 *
 * Updated canonical facade for the meshDispatcher tower (V288–V297).
 * Extends meshDispatcherCanon470 with:
 *   1. dispatchCapability474(capId, args) — safe capability dispatch via D297
 *   2. getHealthSummary474()              — live health snapshot of tower instances
 *   3. Tower-level re-export for new canonical version number
 *
 * Chain: D288→D289→D290→D291→D292→D293→D294→D295→D296→D297
 * New code imports THIS file — never D288..D296 directly, never canon470 directly.
 *
 * Usage:
 *   const canon474 = require('./meshDispatcherCanon474.js');
 *   canon474.getCanonInfo474()          // tower metadata
 *   canon474.getHealthSummary474()      // live stats snapshot
 *   canon474.dispatchCapability474(id, args)  // safe dispatch
 *
 * All identifiers end in 474. Sacred files untouched. Zero npm deps.
 * @version 474.0.0
 */

const CANON_VERSION_474      = '474.0.0';
const CANON_TOWER_PREFIX_474 = 'meshDispatcher';
const CANON_TIP_474          = 297;
const CANON_BASE_474         = 288;
const IMPORT_GUIDANCE_474    = 'New code: require(./lib/meshDispatcherCanon474.js). Never import D288..D296 or canon470 directly.';

// Canonical tip
const D297_474 = require('./meshDispatcher297.js');

const {
  BRIDGE_VERSION_297,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
  DEFAULT_REASON_FEED_MAX_297,
  DEFAULT_VALIDATOR_STATS_MAX_297,
} = D297_474;

// Lazy singletons for health reporting
let _feed474   = null;
let _bvs474    = null;
let _gate474   = null;

function _ensureInstances474() {
  if (_feed474) return;
  _feed474 = new ReasonIndexedFeed297();
  _bvs474  = new PerValidatorQuorumStats297();
  _gate474 = new QuorumStreamAuthGate297();
  // Subscribe to global stream if present (non-fatal)
  const stream = (typeof global !== 'undefined' && global.__ECOS_V296_STREAM__) || null;
  if (stream && typeof stream.subscribe === 'function') {
    try { stream.subscribe((e) => { try { _feed474.ingest(e); } catch (_) {} }); } catch (_) {}
    try { stream.subscribe((e) => { try { _bvs474.ingest(e); } catch (_) {} }); } catch (_) {}
  }
}

/**
 * getCanonInfo474() — tower metadata.
 * @returns {object}
 */
function getCanonInfo474() {
  return {
    version:       CANON_VERSION_474,
    tower:         CANON_TOWER_PREFIX_474,
    canonicalTip:  CANON_TIP_474,
    chainBase:     CANON_BASE_474,
    chainLength:   CANON_TIP_474 - CANON_BASE_474 + 1,
    bridgeVersion: BRIDGE_VERSION_297,
    importGuidance: IMPORT_GUIDANCE_474,
    note:          'V474: updated facade with health summary + dispatchCapability474.',
  };
}

/**
 * getHealthSummary474() — live snapshot of tower's runtime instances.
 * Safe: always returns a valid object, never throws.
 * @returns {{ ok: boolean, version: string, reasonFeed: object, byValidator: object, authGate: object, streamPresent: boolean }}
 */
function getHealthSummary474() {
  try {
    _ensureInstances474();
    const streamPresent = !!(typeof global !== 'undefined' && global.__ECOS_V296_STREAM__);
    return {
      ok:           true,
      version:      CANON_VERSION_474,
      reasonFeed:   typeof _feed474.stats === 'function' ? _feed474.stats() : { note: 'no_stats_fn' },
      byValidator:  typeof _bvs474.stats === 'function'  ? _bvs474.stats()  : { note: 'no_stats_fn' },
      authGate:     typeof _gate474.stats === 'function' ? _gate474.stats()  : { note: 'no_stats_fn' },
      streamPresent: streamPresent,
    };
  } catch (e) {
    return { ok: false, error: e.message, version: CANON_VERSION_474 };
  }
}

/**
 * dispatchCapability474(capId, args) — safe capability dispatch via tower.
 * Currently routes to D297's ReasonIndexedFeed search when capId === 'search'.
 * Other capIds return a stub with intent logged for future extension.
 *
 * Fail-closed: invalid capId → { ok: false, error: ... }
 *
 * @param {string} capId
 * @param {object} [args]
 * @returns {{ ok: boolean, capId: string, result?: any, error?: string }}
 */
function dispatchCapability474(capId, args) {
  if (!capId || typeof capId !== 'string') {
    return { ok: false, capId: capId, error: 'capId must be a non-empty string' };
  }
  try {
    _ensureInstances474();
    if (capId === 'search') {
      const query = (args && args.query) || '';
      const limit = (args && args.limit) || 20;
      const results = typeof _feed474.search === 'function'
        ? _feed474.search(query, limit)
        : [];
      return { ok: true, capId, results };
    }
    if (capId === 'health') {
      return { ok: true, capId, result: getHealthSummary474() };
    }
    if (capId === 'info') {
      return { ok: true, capId, result: getCanonInfo474() };
    }
    // Unknown capability: fail-closed with clear message
    return {
      ok:     false,
      capId:  capId,
      error:  'unknown_capability',
      known:  ['search', 'health', 'info'],
    };
  } catch (e) {
    return { ok: false, capId, error: e.message };
  }
}

module.exports = {
  CANON_VERSION_474,
  CANON_TOWER_PREFIX_474,
  CANON_TIP_474,
  CANON_BASE_474,
  IMPORT_GUIDANCE_474,
  // Full D297 surface
  D297: D297_474,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
  // V474 additions
  getCanonInfo474,
  getHealthSummary474,
  dispatchCapability474,
};
