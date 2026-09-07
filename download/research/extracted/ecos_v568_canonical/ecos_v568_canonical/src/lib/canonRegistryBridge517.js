'use strict';
/**
 * lib/canonRegistryBridge517.js — ECOS V517 (Phase P405)
 *
 * CONNECTION (Action C): canonBridgePatch508 ↔ {onboardingFlow×6, agentDispatchBridge×8}
 *
 * Problem: After V516 registered 7 post-508 canon facades (telemetry/sybilGuard/
 * reputationLedger/offlineQueue/splitModule/quadraticFunding/x402), two parallel-
 * duplicate tower groups remain unregistered with canonBridgePatch508 and are
 * therefore mis-classified in the honest-patched duplication report:
 *
 *   1. onboardingFlow — 6 members (263..268). Verified parallel-dup:
 *      263..267 are thin re-exports of 268 (V495 consolidation header confirms).
 *   2. agentDispatchBridge — 8 members (246..253). Verified parallel-dup:
 *      246..252 are thin re-exports of 253 (V495 consolidation header confirms).
 *
 * Solution: Build descriptors for both towers, register them with bridge508 via
 * registerCanonFacade508(). No member files are modified. No new deps.
 *
 * Descriptor format (canonBridgePatch508 spec):
 *   { name, kind: 'parallel-duplicate', base, tip, members[] }
 *
 * All identifiers end in 517. Zero npm deps. SACRED untouched.
 * @module canonRegistryBridge517
 * @version 517.0.0
 */

const BRIDGE_VERSION_517 = '517.0.0';

const STATIC_DESCRIPTORS_517 = [
  {
    name: 'onboardingFlow',
    kind: 'parallel-duplicate',
    base: '263',
    tip:  '268',
    members: ['263', '264', '265', '266', '267', '268'],
  },
  {
    name: 'agentDispatchBridge',
    kind: 'parallel-duplicate',
    base: '246',
    tip:  '253',
    members: ['246', '247', '248', '249', '250', '251', '252', '253'],
  },
];

let _registered517  = [];
let _skipped517     = [];
let _bridgeError517 = null;
let _patch508_517   = null;

(function _registerAll517() {
  try {
    _patch508_517 = require('./canonBridgePatch508.js');
    if (typeof _patch508_517.registerCanonFacade508 !== 'function') {
      _bridgeError517 = 'canonBridgePatch508.registerCanonFacade508 not a function';
      return;
    }
    for (const desc of STATIC_DESCRIPTORS_517) {
      try {
        _patch508_517.registerCanonFacade508(desc);
        _registered517.push(desc.name);
      } catch (e) {
        _skipped517.push({ name: desc.name, error: e.message });
      }
    }
  } catch (e) {
    _bridgeError517 = e.message;
  }
})();

function getRegistrationSummary517() {
  return Object.freeze({
    version:         BRIDGE_VERSION_517,
    registered:      [..._registered517],
    skipped:         [..._skipped517],
    bridgeError:     _bridgeError517,
    ok:              !_bridgeError517 && _skipped517.length === 0,
    totalAttempted:  STATIC_DESCRIPTORS_517.length,
    totalRegistered: _registered517.length,
  });
}

function getPatchedReport517(opts) {
  if (!_patch508_517 || typeof _patch508_517.getPatchedDuplication508 !== 'function') {
    throw new Error('[canonRegistryBridge517] bridge508 not available');
  }
  return _patch508_517.getPatchedDuplication508(opts || {});
}

function registerEndpoints517(app) {
  if (!app || typeof app.get !== 'function') return;

  // V517-T01: registration summary
  app.get('/api/v1/registry/canon-bridge-v517/status', (req, res) => {
    try {
      res.json({ ok: true, summary: getRegistrationSummary517(), ecosVersion: 'V517' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V517' });
    }
  });

  // V517-T02: patched report through bridge508 (now with onboardingFlow + agentDispatchBridge)
  app.get('/api/v1/registry/honest-patched-v517', (req, res) => {
    try {
      const opts = {
        libDir:  req.app && req.app.get('libDir'),
        rootDir: req.app && req.app.get('rootDir'),
      };
      const report = getPatchedReport517(opts);
      res.json({ ok: true, report, registeredBy517: _registered517, ecosVersion: 'V517' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V517' });
    }
  });

  // V517-T03: admin summary
  app.get('/api/v1/admin/summary/v517', (req, res) => {
    try {
      const summary = getRegistrationSummary517();
      res.json({
        ok: true,
        version: BRIDGE_VERSION_517,
        phase:   'P405',
        feature: 'canon-registry-bridge-extension',
        action:  'C — canonBridgePatch508 ↔ onboardingFlow×6 + agentDispatchBridge×8',
        description: 'Registers the two remaining verified parallel-duplicate towers with canonBridgePatch508. Completes the post-508 canon registration: 7 (V516) + 2 (V517) = 9 facade descriptors.',
        summary,
        endpoints: [
          'V517-T01 GET /api/v1/registry/canon-bridge-v517/status',
          'V517-T02 GET /api/v1/registry/honest-patched-v517',
          'V517-T03 GET /api/v1/admin/summary/v517',
        ],
        ecosVersion: 'V517',
        timestamp:   Date.now(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V517' });
    }
  });
}

module.exports = {
  BRIDGE_VERSION_517,
  STATIC_DESCRIPTORS_517,
  getRegistrationSummary517,
  getPatchedReport517,
  registerEndpoints517,
};
