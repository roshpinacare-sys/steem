'use strict';
/**
 * src/lib/gateEvaluateBridge554.js — ECOS V554 (Phase P322)
 *
 * CONNECTION: deepHealthAlertHistory542 → deepHealthPolicy546 → orchestratorPolicyGate549.
 *
 * BUG FOUND (V554):
 *   deepHealthPolicy546._readTrend546() reads r.trend but getTrend542() returns
 *   { direction: 'stable', ... } — field is 'direction', not 'trend'.
 *   Result: policy always sees trend='unknown' → decision stays MANUAL.
 *   (policy546 cannot be modified — it is shared infrastructure.)
 *
 * FIX:
 *   evaluateGate554() reads trend via getTrend542().direction (correct field),
 *   reads score via getCompositeScore543(), calls _decide546(score, trend, buckets)
 *   directly — bypassing the broken _readTrend546(). Returns a full policy object
 *   identical in shape to getPolicy546() for drop-in compatibility.
 *
 * SAFE: does not modify policy546 or gate547/549. Additive only.
 *
 * All identifiers end in 554. Zero new npm deps. SACRED untouched.
 * @version 554.0.0
 */

var EVAL_VERSION_554 = '554.0.0';

var _hist542_554   = null;
var _policy546_554 = null;
var _canon543_554  = null;
var _agg545_554    = null;

function _load554() {
  if (!_hist542_554)   { try { _hist542_554   = require('./deepHealthAlertHistory542.js'); } catch (_) {} }
  if (!_policy546_554) { try { _policy546_554  = require('./deepHealthPolicy546.js');       } catch (_) {} }
  if (!_canon543_554)  { try { _canon543_554   = require('./marketMakerCanon543.js');        } catch (_) {} }
  if (!_agg545_554)    { try { _agg545_554     = require('./deepHealthAlertAggregator545.js'); } catch (_) {} }
}

/**
 * evaluateGate554() — patched policy evaluation using the correct trend field.
 *
 * @returns {{
 *   ok: boolean, decision: string, score: number, trend: string,
 *   reasoning: string, version: string, patchNote: string
 * }}
 */
function evaluateGate554() {
  _load554();

  // ── score ─────────────────────────────────────────────────────────────────
  var score554 = 0;
  var scoreOk554 = false;
  try {
    if (_canon543_554 && typeof _canon543_554.getCompositeScore543 === 'function') {
      var sr = _canon543_554.getCompositeScore543();
      score554 = typeof sr.compositeScore === 'number' ? sr.compositeScore  // V560: primary (getCompositeScore543 returns compositeScore)
               : typeof sr.composite     === 'number' ? sr.composite
               : typeof sr.score        === 'number' ? sr.score
               : 0;
      scoreOk554 = true;
    }
  } catch (_) {}

  // ── trend — read .direction (correct field) ───────────────────────────────
  var trend554 = 'unknown';
  var trendOk554 = false;
  try {
    if (_hist542_554 && typeof _hist542_554.getTrend542 === 'function') {
      var tr = _hist542_554.getTrend542();
      // getTrend542 returns { direction, delta, ... } — field is 'direction', NOT 'trend'
      trend554 = (typeof tr.direction === 'string') ? tr.direction
               : (typeof tr.trend    === 'string') ? tr.trend  // fallback if API changes
               : 'unknown';
      trendOk554 = trend554 !== 'unknown';
    }
  } catch (_) {}

  // ── buckets (optional — _decide546 accepts null) ───────────────────────────
  var buckets554 = { ok: false, bucketCount: 0, snapshotCount: 0 };
  try {
    if (_agg545_554 && typeof _agg545_554.aggregate545 === 'function') {
      buckets554 = _agg545_554.aggregate545({});
    }
  } catch (_) {}

  // ── decision — call _decide546 directly with correct inputs ───────────────
  var decision554 = 'MANUAL';
  var decideOk554 = false;
  if (_policy546_554 && typeof _policy546_554._decide546 === 'function') {
    try {
      decision554 = _policy546_554._decide546(score554, trend554, buckets554);
      decideOk554 = true;
    } catch (_) {}
  } else {
    // Fallback: inline logic mirroring _decide546
    if (trend554 === 'rising' || trend554 === 'unknown') {
      decision554 = 'MANUAL';
    } else if (score554 >= 0.70) {
      decision554 = 'AUTO';
    } else if (score554 >= 0.40) {
      decision554 = 'SUPERVISED';
    } else {
      decision554 = 'MANUAL';
    }
    decideOk554 = true;
  }

  var reasons554 = [];
  if (!scoreOk554)  reasons554.push('score source degraded (using 0)');
  if (!trendOk554)  reasons554.push('trend=unknown → fail-closed to MANUAL');
  if (!decideOk554) reasons554.push('_decide546 unavailable — inline fallback used');

  var reasoning554 = reasons554.length > 0
    ? reasons554.join('; ')
    : ('score=' + score554.toFixed(3) + ', trend=' + trend554 + ' → ' + decision554);

  return {
    ok:         decideOk554,
    decision:   decision554,
    score:      score554,
    trend:      trend554,
    reasoning:  reasoning554,
    version:    EVAL_VERSION_554,
    patchNote:  'Uses getTrend542().direction (correct field). policy546 reads .trend (wrong) — this bridge fixes the mismatch.',
  };
}

module.exports = {
  EVAL_VERSION_554:  EVAL_VERSION_554,
  evaluateGate554:   evaluateGate554,
};
