'use strict';
/**
 * lib/meshDispatcherCanon478.js — ECOS V478
 *
 * Canonical facade for the meshDispatcher tower (V288–V297).
 * Supersedes meshDispatcherCanon474.js with:
 *   1. dispatchCapability478(capId, args) — extended dispatch (adds 'stats', 'search-by-decision')
 *   2. getHealthSummary478()              — richer health snapshot with ingestion metrics
 *   3. getCanonInfo478()                  — updated tower metadata pointing to this canon
 *
 * Chain: D288→D289→D290→D291→D292→D293→D294→D295→D296→D297
 * New code imports THIS file — never D288..D296 directly, never canon470/474 directly.
 *
 * Usage:
 *   const canon478 = require('./lib/meshDispatcherCanon478.js');
 *   canon478.getCanonInfo478()                       // tower metadata
 *   canon478.getHealthSummary478()                   // live health snapshot
 *   canon478.dispatchCapability478(capId, args)      // safe dispatch
 *   canon478.registerEndpoints478(app)               // wire endpoints
 *
 * All identifiers end in 478. Sacred files untouched. Zero npm deps.
 * @version 478.0.0
 */

const CANON_VERSION_478      = '478.0.0';
const CANON_TOWER_PREFIX_478 = 'meshDispatcher';
const CANON_TIP_478          = 297;
const CANON_BASE_478         = 288;
const CANON_COUNT_478        = CANON_TIP_478 - CANON_BASE_478 + 1; // 10
const IMPORT_GUIDANCE_478    =
  'New code: require(./lib/meshDispatcherCanon478.js). ' +
  'Never import D288..D296, canon470, or canon474 directly.';

// ── load tip (fail-soft) ─────────────────────────────────────────────────────
let _D297_478 = null;
let _loadError478 = null;

try {
  _D297_478 = require('./meshDispatcher297.js');
} catch (e) {
  _loadError478 = e.message;
}

const {
  BRIDGE_VERSION_297,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
  DEFAULT_REASON_FEED_MAX_297,
  DEFAULT_VALIDATOR_STATS_MAX_297,
} = _D297_478 || {};

// ── lazy singletons ──────────────────────────────────────────────────────────
let _feed478  = null;
let _bvs478   = null;
let _gate478  = null;
let _initDone478 = false;

function _ensureInstances478() {
  if (_initDone478) return;
  _initDone478 = true;
  if (!ReasonIndexedFeed297) return;
  try {
    _feed478 = new ReasonIndexedFeed297();
    _bvs478  = new PerValidatorQuorumStats297();
    _gate478 = new QuorumStreamAuthGate297();
    // Subscribe to global stream if present (non-fatal)
    const stream = (typeof global !== 'undefined' && global.__ECOS_V296_STREAM__) || null;
    if (stream && typeof stream.subscribe === 'function') {
      try { stream.subscribe((e) => { try { _feed478.ingest(e); } catch (_) {} }); } catch (_) {}
      try { stream.subscribe((e) => { try { _bvs478.ingest(e); } catch (_) {} }); } catch (_) {}
    }
  } catch (_) {}
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * getCanonInfo478() — tower metadata.
 */
function getCanonInfo478() {
  return {
    version:         CANON_VERSION_478,
    tower:           CANON_TOWER_PREFIX_478,
    canonicalTip:    CANON_TIP_478,
    chainBase:       CANON_BASE_478,
    chainLength:     CANON_COUNT_478,
    bridgeVersion:   BRIDGE_VERSION_297 || 'unavailable',
    importGuidance:  IMPORT_GUIDANCE_478,
    supersedes:      ['meshDispatcherCanon470', 'meshDispatcherCanon474'],
    note:            'V478: richer health metrics, extended dispatch capabilities.',
    loadError:       _loadError478 || null,
  };
}

/**
 * getHealthSummary478() — live snapshot of tower's runtime instances.
 * Always returns a valid object, never throws.
 */
function getHealthSummary478() {
  try {
    _ensureInstances478();
    const streamPresent = !!(typeof global !== 'undefined' && global.__ECOS_V296_STREAM__);
    const safeStats = (obj, label) => {
      if (!obj) return { note: 'instance_unavailable', label };
      if (typeof obj.stats === 'function') {
        try { return obj.stats(); } catch (e) { return { note: 'stats_error', error: e.message }; }
      }
      return { note: 'no_stats_fn', label };
    };
    return {
      ok:            true,
      version:       CANON_VERSION_478,
      towerLoaded:   !_loadError478,
      loadError:     _loadError478 || null,
      reasonFeed:    safeStats(_feed478, 'ReasonIndexedFeed297'),
      byValidator:   safeStats(_bvs478, 'PerValidatorQuorumStats297'),
      authGate:      safeStats(_gate478, 'QuorumStreamAuthGate297'),
      streamPresent: streamPresent,
      defaults: {
        reasonFeedMax:     DEFAULT_REASON_FEED_MAX_297  || null,
        validatorStatsMax: DEFAULT_VALIDATOR_STATS_MAX_297 || null,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message, version: CANON_VERSION_478 };
  }
}

/**
 * dispatchCapability478(capId, args) — safe capability dispatch via tower.
 *
 * Supported capIds:
 *   'info'               → getCanonInfo478()
 *   'health'             → getHealthSummary478()
 *   'search'             → feed.search({ q, limit })
 *   'search-by-decision' → feed.search({ decision, limit }) — NEW in V478
 *   'stats'              → combined feed+validator+gate stats — NEW in V478
 *
 * Fail-closed: unknown/invalid capId → { ok: false, error: ... }
 *
 * @param {string} capId
 * @param {object} [args]
 * @returns {{ ok: boolean, capId: string, result?: any, error?: string }}
 */
function dispatchCapability478(capId, args) {
  if (!capId || typeof capId !== 'string') {
    return { ok: false, capId, error: 'capId must be a non-empty string' };
  }
  try {
    _ensureInstances478();
    const KNOWN_CAPS_478 = ['info', 'health', 'search', 'search-by-decision', 'stats'];

    if (capId === 'info') {
      return { ok: true, capId, result: getCanonInfo478() };
    }

    if (capId === 'health') {
      return { ok: true, capId, result: getHealthSummary478() };
    }

    if (capId === 'search') {
      if (!_feed478) return { ok: false, capId, error: 'feed_unavailable' };
      const q     = (args && typeof args.q === 'string') ? args.q : '';
      const limit = (args && Number.isFinite(args.limit)) ? args.limit : 20;
      const results = typeof _feed478.search === 'function'
        ? _feed478.search({ q, limit })
        : [];
      return { ok: true, capId, results };
    }

    if (capId === 'search-by-decision') {
      if (!_feed478) return { ok: false, capId, error: 'feed_unavailable' };
      const decision = (args && args.decision) || null;
      const limit    = (args && Number.isFinite(args.limit)) ? args.limit : 20;
      if (!decision) return { ok: false, capId, error: 'args.decision required (met|short|refused)' };
      const results = typeof _feed478.search === 'function'
        ? _feed478.search({ decision, limit })
        : [];
      return { ok: true, capId, results };
    }

    if (capId === 'stats') {
      const safeStats = (obj) => {
        if (!obj || typeof obj.stats !== 'function') return null;
        try { return obj.stats(); } catch (_) { return null; }
      };
      return {
        ok: true,
        capId,
        result: {
          reasonFeed:  safeStats(_feed478),
          byValidator: safeStats(_bvs478),
          authGate:    safeStats(_gate478),
          version:     CANON_VERSION_478,
        },
      };
    }

    // Unknown capability — fail-closed
    return {
      ok:    false,
      capId,
      error: 'unknown_capability',
      known: KNOWN_CAPS_478,
    };
  } catch (e) {
    return { ok: false, capId, error: e.message };
  }
}

/**
 * registerEndpoints478(app) — wires V478 endpoints onto the Express app.
 * Called from the IIFE in ecos-api-server.js.
 */
function registerEndpoints478(app) {
  // [V478-T01] GET /api/v1/mesh-dispatcher/canon/status
  app.get('/api/v1/mesh-dispatcher/canon/status', (_req, res) => {
    res.json({
      info:   getCanonInfo478(),
      health: getHealthSummary478(),
    });
  });

  // [V478-T02] POST /api/v1/mesh-dispatcher/canon/dispatch/v478
  app.post('/api/v1/mesh-dispatcher/canon/dispatch/v478', (req, res) => {
    const body   = req.body || {};
    const capId  = body.capId  || '';
    const args   = body.args   || {};
    res.json(dispatchCapability478(capId, args));
  });

  // [V478-T03] GET /api/v1/admin/summary/v478
  app.get('/api/v1/admin/summary/v478', (_req, res) => {
    res.json({
      version:   CANON_VERSION_478,
      status:    'ok',
      endpoints: [
        'V478-T01 GET  /api/v1/mesh-dispatcher/canon/status',
        'V478-T02 POST /api/v1/mesh-dispatcher/canon/dispatch/v478',
        'V478-T03 GET  /api/v1/admin/summary/v478',
      ],
      module:    'meshDispatcherCanon478',
      connects:  ['meshDispatcher288..297', 'meshDispatcherCanon470', 'meshDispatcherCanon474'],
      supersedes: ['meshDispatcherCanon470', 'meshDispatcherCanon474'],
    });
  });
}

module.exports = {
  CANON_VERSION_478,
  CANON_TOWER_PREFIX_478,
  CANON_TIP_478,
  CANON_BASE_478,
  IMPORT_GUIDANCE_478,
  // Full D297 surface pass-through
  D297: _D297_478,
  ReasonIndexedFeed297,
  PerValidatorQuorumStats297,
  QuorumStreamAuthGate297,
  OperatorPanel297,
  // V478 API
  getCanonInfo478,
  getHealthSummary478,
  dispatchCapability478,
  registerEndpoints478,
};
