'use strict';
/**
 * src/lib/deepHealthScoreBridge552.js — ECOS V552
 *
 * Deep Health Score Bridge
 * ════════════════════════
 * Closes the scoring loop between marketMakerCanon543 and deepHealthPolicy546.
 *
 * Root cause (discovered V552):
 *   getCompositeScore543() returns { compositeScore: 0.5, ... }
 *   _readScore546() looks for   { composite: ..., score: ... }
 *   → field name mismatch → score always = 0 → gate always = MANUAL
 *
 * Fix: require-cache patch on marketMakerCanon543.getCompositeScore543.
 *   Wrap returns the original result PLUS adds:
 *     composite = compositeScore  (field deepHealthPolicy546 expects)
 *     score     = compositeScore  (fallback field deepHealthPolicy546 also checks)
 *   Zero semantic change — purely adds alias fields.
 *
 * This patch makes deepHealthPolicy546 → gate547 → gate549 → dispatchBridge550
 * → guard467/bridge466 work correctly with a real health score.
 *
 * Public API:
 *   applyScoreBridge552()   — idempotent patch, returns { patched, alreadyDone }
 *   getScoreBridgeStats552() — { patched, calls, lastScore, lastDecision }
 *
 * All identifiers end in 552. Zero new npm deps.
 * @version 552.0.0
 */

const BRIDGE_VERSION_552 = '552.0.0';

let _patched552  = false;
let _calls552    = 0;
let _lastScore552 = null;

/**
 * Apply the alias patch to marketMakerCanon543.getCompositeScore543.
 * Idempotent — safe to call multiple times.
 */
function applyScoreBridge552() {
  if (_patched552) return { patched: true, alreadyDone: true, version: BRIDGE_VERSION_552 };

  let canon543;
  try { canon543 = require('./marketMakerCanon543.js'); } catch (e) {
    return { patched: false, error: 'marketMakerCanon543 unavailable: ' + e.message, version: BRIDGE_VERSION_552 };
  }

  if (typeof canon543.getCompositeScore543 !== 'function') {
    return { patched: false, error: 'getCompositeScore543 not a function', version: BRIDGE_VERSION_552 };
  }

  const _orig552 = canon543.getCompositeScore543;

  canon543.getCompositeScore543 = function getCompositeScore543_bridged552() {
    _calls552++;
    const r = _orig552.apply(this, arguments);
    // Add alias fields that deepHealthPolicy546._readScore546 expects:
    //   r.composite (primary check) and r.score (fallback check)
    const numericScore =
      typeof r.compositeScore === 'number' ? r.compositeScore :
      typeof r.composite      === 'number' ? r.composite :
      typeof r.score          === 'number' ? r.score : 0;
    _lastScore552 = numericScore;
    return {
      ...r,
      composite: numericScore,   // field deepHealthPolicy546 checks first
      score:     numericScore,   // field deepHealthPolicy546 checks second
      _bridged552: true,
    };
  };

  // Preserve original and mark patched
  canon543.getCompositeScore543._orig552 = _orig552;
  canon543._scoreBridgePatched552 = true;
  _patched552 = true;

  return { patched: true, alreadyDone: false, version: BRIDGE_VERSION_552 };
}

function getScoreBridgeStats552() {
  return {
    version:      BRIDGE_VERSION_552,
    patched:      _patched552,
    calls:        _calls552,
    lastScore:    _lastScore552,
  };
}

module.exports = { applyScoreBridge552, getScoreBridgeStats552, BRIDGE_VERSION_552 };
