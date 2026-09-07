'use strict';
/**
 * lib/hexaTowerCanon481.js — Hexa Tower Canon Facade V481
 *
 * Unifies the 6 major tower Canons under a single entry-point:
 *   1. agentDispatchBridgeCanon473  (8 modules → 1)
 *   2. marketMakerCanon475          (37 modules → 1)
 *   3. providerAdaptersCanon476     (17 modules → 1)
 *   4. economicIntegrityLoadBearingCanon477 (11 modules → 1)
 *   5. meshDispatcherCanon478       (10 modules → 1)
 *   6. pentaTowerCanon480           (5×6 modules → 1, V480)
 *
 * Total: ~88 modules → 1 facade.
 *
 * Usage (new code):
 *   const hexa481 = require('./lib/hexaTowerCanon481.js');
 *   hexa481.getHealthSummary481()   // unified health across all 6 canons
 *   hexa481.registerEndpoints481(app)
 *
 * All identifiers end in 481. Zero npm deps. SACRED untouched.
 * @module hexaTowerCanon481
 * @version 481.0.0
 */

const CANON_VERSION_481 = '481';
const CANON_TOWER_PREFIX_481 = 'hexaTowerCanon';
const CANON_TOTAL_MODULES_481 = 88; // approx: 8+37+17+11+10+5
const IMPORT_GUIDANCE_481 =
  'New code: require(./lib/hexaTowerCanon481.js). ' +
  'Do NOT require individual tower modules (473-480) — use this facade.';

// ── lazy-load sub-canons (fail-safe) ─────────────────────────────────────

function _tryRequire481(path) {
  try { return require(path); } catch (_) { return null; }
}

let _canon473_481 = null, _canon475_481 = null, _canon476_481 = null;
let _canon477_481 = null, _canon478_481 = null, _canon480_481 = null;

function _loadCanons481() {
  if (!_canon473_481) _canon473_481 = _tryRequire481('./agentDispatchBridgeCanon473.js');
  if (!_canon475_481) _canon475_481 = _tryRequire481('./marketMakerCanon475.js');
  if (!_canon476_481) _canon476_481 = _tryRequire481('./providerAdaptersCanon476.js');
  if (!_canon477_481) _canon477_481 = _tryRequire481('./economicIntegrityLoadBearingCanon477.js');
  if (!_canon478_481) _canon478_481 = _tryRequire481('./meshDispatcherCanon478.js');
  if (!_canon480_481) _canon480_481 = _tryRequire481('./pentaTowerCanon480.js');
}

// ── getCanonInfo481 ──────────────────────────────────────────────────────

function getCanonInfo481() {
  _loadCanons481();
  return {
    version: CANON_VERSION_481,
    towerPrefix: CANON_TOWER_PREFIX_481,
    totalModules: CANON_TOTAL_MODULES_481,
    importGuidance: IMPORT_GUIDANCE_481,
    subCanons: [
      { name: 'agentDispatchBridgeCanon473',          version: _canon473_481 ? _canon473_481.CANON_VERSION_473 : null, loaded: !!_canon473_481 },
      { name: 'marketMakerCanon475',                  version: _canon475_481 ? _canon475_481.CANON_VERSION_475 : null, loaded: !!_canon475_481 },
      { name: 'providerAdaptersCanon476',             version: _canon476_481 ? _canon476_481.CANON_VERSION_476 || '476' : null, loaded: !!_canon476_481 },
      { name: 'economicIntegrityLoadBearingCanon477', version: _canon477_481 ? _canon477_481.CANON_VERSION_477 : null, loaded: !!_canon477_481 },
      { name: 'meshDispatcherCanon478',               version: _canon478_481 ? _canon478_481.CANON_VERSION_478 : null, loaded: !!_canon478_481 },
      { name: 'pentaTowerCanon480',                   version: _canon480_481 ? _canon480_481.CANON_VERSION_480 : null, loaded: !!_canon480_481 },
    ],
  };
}

// ── getHealthSummary481 ──────────────────────────────────────────────────

function getHealthSummary481() {
  _loadCanons481();
  const subHealth481 = [];
  let allLoaded481 = true;

  function _safeHealth481(canon, name) {
    if (!canon) { allLoaded481 = false; return { name, loaded: false, health: null }; }
    try {
      // try getHealthSummary if available
      if (typeof canon.getHealthSummary477 === 'function') {
        return { name, loaded: true, health: canon.getHealthSummary477() };
      }
      if (typeof canon.getHealthSummary480 === 'function') {
        return { name, loaded: true, health: canon.getHealthSummary480() };
      }
      if (typeof canon.getCanonInfo473 === 'function') {
        return { name, loaded: true, health: canon.getCanonInfo473() };
      }
      if (typeof canon.getCanonInfo476 === 'function') {
        return { name, loaded: true, health: canon.getCanonInfo476() };
      }
      if (typeof canon.getCanonInfo478 === 'function') {
        return { name, loaded: true, health: canon.getCanonInfo478() };
      }
      if (typeof canon.getCanonInfo475 === 'function') {
        return { name, loaded: true, health: canon.getCanonInfo475() };
      }
      return { name, loaded: true, health: { info: 'ok' } };
    } catch (e) {
      return { name, loaded: true, health: null, error: e.message };
    }
  }

  subHealth481.push(_safeHealth481(_canon473_481, 'agentDispatchBridgeCanon473'));
  subHealth481.push(_safeHealth481(_canon475_481, 'marketMakerCanon475'));
  subHealth481.push(_safeHealth481(_canon476_481, 'providerAdaptersCanon476'));
  subHealth481.push(_safeHealth481(_canon477_481, 'economicIntegrityLoadBearingCanon477'));
  subHealth481.push(_safeHealth481(_canon478_481, 'meshDispatcherCanon478'));
  subHealth481.push(_safeHealth481(_canon480_481, 'pentaTowerCanon480'));

  return {
    version: CANON_VERSION_481,
    allLoaded: allLoaded481,
    totalSubCanons: 6,
    loadedCount: subHealth481.filter(s => s.loaded).length,
    subCanons: subHealth481,
  };
}

// ── registerEndpoints481 ─────────────────────────────────────────────────

function registerEndpoints481(app) {
  if (!app || typeof app.get !== 'function') return false;

  // Unified health
  app.get('/api/v1/towers/hexa/health', (_req, res) => {
    try {
      res.json({ ok: true, ...getHealthSummary481(), ecosVersion: 'V481' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V481' });
    }
  });

  // Canon info
  app.get('/api/v1/towers/hexa/info', (_req, res) => {
    try {
      res.json({ ok: true, ...getCanonInfo481(), ecosVersion: 'V481' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V481' });
    }
  });

  return true;
}

// ── Re-export key interfaces from sub-canons ──────────────────────────────
// Allows callers to use hexa481 as single import for common operations

function requireIntegrityVerified481(ctx, opts) {
  _loadCanons481();
  if (_canon477_481 && typeof _canon477_481.requireIntegrityVerified477 === 'function') {
    return _canon477_481.requireIntegrityVerified477(ctx, opts);
  }
  throw new Error('[hexaTowerCanon481] economicIntegrityLoadBearingCanon477 not available');
}

function validateProvider481(providerName, contract) {
  _loadCanons481();
  if (_canon476_481 && typeof _canon476_481.validateProvider476 === 'function') {
    return _canon476_481.validateProvider476(providerName, contract);
  }
  throw new Error('[hexaTowerCanon481] providerAdaptersCanon476 not available');
}

// ── module.exports ────────────────────────────────────────────────────────

module.exports = {
  // metadata
  CANON_VERSION_481,
  CANON_TOWER_PREFIX_481,
  CANON_TOTAL_MODULES_481,
  IMPORT_GUIDANCE_481,

  // facade API
  getCanonInfo481,
  getHealthSummary481,
  registerEndpoints481,

  // forwarded operations
  requireIntegrityVerified481,
  validateProvider481,
};
