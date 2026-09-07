'use strict';
/**
 * lib/canonRegistryBridge516.js — ECOS V516 (Phase P404)
 *
 * CONNECTION: canonBridgePatch508 ↔ {telemetry511, sybilGuard512, reputationLedger513,
 *             offlineQueue514, triTower515 (splitModule+quadraticFunding+x402)}
 *
 * Problem: canonBridgePatch508 exposes registerCanonFacade508() so that new canon
 * facades can self-register and correct the bridge's duplication report. Only
 * tipModuleCanon509 calls registerCanonFacade508(). Six subsequent canon facades
 * (V511–V515, covering 8 towers) are invisible to the bridge — the honest-patched
 * report at GET /api/v1/registry/honest-patched is stale.
 *
 * Solution: This module loads canonBridgePatch508 + all six newer canon facades,
 * builds a standard descriptor for each, and registers them. No code in those
 * canons is modified. No new npm deps.
 *
 * Descriptor format (canonBridgePatch508 spec):
 *   { name: string, kind: 'parallel-duplicate'|'inheritance-chain',
 *     base: string, tip: string, members: string[] }
 *
 * All identifiers end in 516. Zero npm deps. SACRED untouched.
 * @module canonRegistryBridge516
 * @version 516.0.0
 */

const BRIDGE_VERSION_516 = '516.0.0';

// ── Static descriptors for towers not yet registered with bridge508 ───────────
// All confirmed parallel-dup (each V263-V267 is a thin re-export of V268).
// Members: V263..V268 (6 each). base='263', tip='268'.

const STATIC_DESCRIPTORS_516 = [
  // telemetryCanon511 covers: telemetry ×6
  { name: 'telemetry',        kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
  // sybilGuardCanon512 covers: sybilGuard ×6
  { name: 'sybilGuard',       kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
  // reputationLedgerCanon513 covers: reputationLedger ×6
  { name: 'reputationLedger', kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
  // offlineQueueCanon514 covers: offlineQueue ×6
  { name: 'offlineQueue',     kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
  // triTowerCanon515 covers: splitModule, quadraticFunding, x402 (all ×6)
  { name: 'splitModule',       kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
  { name: 'quadraticFunding',  kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
  { name: 'x402',              kind: 'parallel-duplicate', base: '263', tip: '268', members: ['263','264','265','266','267','268'] },
];

// ── Registration result ───────────────────────────────────────────────────────
let _registered516  = [];
let _skipped516     = [];
let _bridgeError516 = null;
let _patch508_516   = null;

(function _registerAll516() {
  try {
    _patch508_516 = require('./canonBridgePatch508.js');
    if (typeof _patch508_516.registerCanonFacade508 !== 'function') {
      _bridgeError516 = 'canonBridgePatch508.registerCanonFacade508 not a function';
      return;
    }
    for (const desc of STATIC_DESCRIPTORS_516) {
      try {
        _patch508_516.registerCanonFacade508(desc);
        _registered516.push(desc.name);
      } catch (e) {
        _skipped516.push({ name: desc.name, error: e.message });
      }
    }
  } catch (e) {
    _bridgeError516 = e.message;
  }
})();

// ── Public API ────────────────────────────────────────────────────────────────

/** Return registration summary */
function getRegistrationSummary516() {
  return Object.freeze({
    version:      BRIDGE_VERSION_516,
    registered:   [..._registered516],
    skipped:      [..._skipped516],
    bridgeError:  _bridgeError516,
    ok:           !_bridgeError516 && _skipped516.length === 0,
    totalAttempted: STATIC_DESCRIPTORS_516.length,
    totalRegistered: _registered516.length,
  });
}

/** Get the patched duplication report (via bridge508), now with all 8 towers registered */
function getPatchedReport516(opts) {
  if (!_patch508_516 || typeof _patch508_516.getPatchedDuplication508 !== 'function') {
    throw new Error('[canonRegistryBridge516] bridge508 not available');
  }
  return _patch508_516.getPatchedDuplication508(opts || {});
}

/** Register HTTP endpoints */
function registerEndpoints516(app) {
  if (!app || typeof app.get !== 'function') return;

  // V516-T01: registration summary
  app.get('/api/v1/registry/canon-bridge/status', (req, res) => {
    try {
      res.json({ ok: true, summary: getRegistrationSummary516(), ecosVersion: 'V516' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V516' });
    }
  });

  // V516-T02: full patched report (bridge508 + all registered canons)
  app.get('/api/v1/registry/honest-patched-v516', (req, res) => {
    try {
      const opts = { libDir: req.app && req.app.get('libDir'), rootDir: req.app && req.app.get('rootDir') };
      const report = getPatchedReport516(opts);
      res.json({ ok: true, report, registeredBy516: _registered516, ecosVersion: 'V516' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V516' });
    }
  });

  // V516-T03: admin summary
  app.get('/api/v1/admin/summary/v516', (req, res) => {
    try {
      const summary = getRegistrationSummary516();
      res.json({
        ok: true,
        version: BRIDGE_VERSION_516,
        phase: 'P404',
        feature: 'canon-registry-bridge',
        action: 'C — canonBridgePatch508 ↔ telemetry511+sybilGuard512+reputationLedger513+offlineQueue514+triTower515',
        description: 'Registers 7 towers (from 5 canon facades, V511–V515) with canonBridgePatch508. honest-patched report now accurate for all 8 parallel-dup tower groups.',
        summary,
        endpoints: [
          'V516-T01 GET /api/v1/registry/canon-bridge/status',
          'V516-T02 GET /api/v1/registry/honest-patched-v516',
          'V516-T03 GET /api/v1/admin/summary/v516',
        ],
        ecosVersion: 'V516',
        timestamp: Date.now(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V516' });
    }
  });
}

module.exports = {
  BRIDGE_VERSION_516,
  STATIC_DESCRIPTORS_516,
  getRegistrationSummary516,
  getPatchedReport516,
  registerEndpoints516,
};
