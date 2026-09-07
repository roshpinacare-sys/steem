'use strict';
/**
 * src/lib/agentDispatchBridgeCanon473.js — ECOS V473
 *
 * Canonical facade for the agentDispatchBridge tower (V246–V253).
 * V253 is the authoritative tip; this file declares it as the single
 * canonical entry-point so new code never requires intermediate versions
 * directly.
 *
 * Usage:
 *   const canon473 = require('./agentDispatchBridgeCanon473.js');
 *   // canon473.bridge253   — full V253 surface
 *   // canon473.getCanonInfo473()          — tower metadata
 *   // canon473.createDispatchBridge246    — primary factory (from V246)
 *   // canon473.getBridgeStats253          — live stats (from V253)
 *
 * Chain: V246→V247→V248→V249→V250→V251→V252→V253
 * New code should import THIS file only — never import V246..V252 directly.
 *
 * All identifiers end in 473. Sacred files untouched.
 * @version 473.0.0
 */

const CANON_VERSION_473      = '473.0.0';
const CANON_TOWER_PREFIX_473 = 'agentDispatchBridge';
const CANON_TIP_473          = 253;
const CANON_BASE_473         = 246;

// The canonical tip — all V246..V252 features accessible via chained require()s
const BRIDGE253_473 = require('./agentDispatchBridge253.js');

// Re-export full tip surface as canonical surface
const {
  disableQuotaAutoSave253,
  getAutoSaveStatus253,
  aggregateRetryResult253,
  retryFailedSubTasks253,
  snapshotQuotas253,
  resetEvictionStats253,
  getEvictionResetInfo253,
  applyQuotaDiff253,
  getBridgeStats253,
  _bridgeStats253,
  BRIDGE_VERSION_253,
  MAX_QUOTA_SNAPSHOTS_253,
} = BRIDGE253_473;

// Also surface the foundational factory from V246 (root of the chain)
let _createDispatchBridge246 = null;
let _defaultBridge246        = null;
let _setBridgeDispatcher246  = null;
try {
  const b246 = require('./agentDispatchBridge246.js');
  _createDispatchBridge246 = b246.createDispatchBridge246 || null;
  _defaultBridge246        = b246.defaultBridge246        || null;
  _setBridgeDispatcher246  = b246.setBridgeDispatcher246  || null;
} catch (_) { /* soft-fail — tip still fully usable */ }

/**
 * getCanonInfo473() → metadata object describing the tower state.
 */
function getCanonInfo473() {
  return {
    version:          CANON_VERSION_473,
    tower:            CANON_TOWER_PREFIX_473,
    canonicalTip:     CANON_TIP_473,
    chainBase:        CANON_BASE_473,
    chainLength:      CANON_TIP_473 - CANON_BASE_473 + 1,
    tipVersion:       BRIDGE_VERSION_253,
    bridgeStats:      getBridgeStats253(),
    note:             'New code imports agentDispatchBridgeCanon473.js — never V246..V252 directly.',
  };
}

module.exports = {
  // Facade metadata
  CANON_VERSION_473,
  CANON_TOWER_PREFIX_473,
  CANON_TIP_473,
  CANON_BASE_473,
  getCanonInfo473,

  // Full tip (V253) surface
  bridge253:               BRIDGE253_473,
  disableQuotaAutoSave253,
  getAutoSaveStatus253,
  aggregateRetryResult253,
  retryFailedSubTasks253,
  snapshotQuotas253,
  resetEvictionStats253,
  getEvictionResetInfo253,
  applyQuotaDiff253,
  getBridgeStats253,
  BRIDGE_VERSION_253,
  MAX_QUOTA_SNAPSHOTS_253,

  // V246 factory (root of chain)
  createDispatchBridge246: _createDispatchBridge246,
  defaultBridge246:        _defaultBridge246,
  setBridgeDispatcher246:  _setBridgeDispatcher246,
};
