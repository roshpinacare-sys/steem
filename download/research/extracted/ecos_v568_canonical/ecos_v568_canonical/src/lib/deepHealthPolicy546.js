'use strict';
/**
 * src/lib/deepHealthPolicy546.js — ECOS V546
 *
 * Deep Health Policy Engine: מחבר 3 מקורות קיימים → החלטת auto/supervised/manual אחת.
 *
 *   מקורות:
 *     1. marketMakerCanon543  → compositeScore [0..1] (kurtosis+outlierZ+autocorr+entropy)
 *     2. deepHealthAlertHistory542 → getTrend542() (rising/falling/stable/unknown)
 *     3. deepHealthAlertAggregator545 → aggregate545() (bucket stats, topN alerts)
 *
 *   לוגיקת החלטה (fail-closed: ספק = MANUAL):
 *     AUTO       — score ≥ 0.70 AND trend ≠ 'rising' AND buckets ok
 *     SUPERVISED — score ≥ 0.40 AND trend ≠ 'rising' AND NOT AUTO conditions
 *     MANUAL     — otherwise (degraded, rising, unknown, load error)
 *
 *   API:
 *     getPolicy546()       → { decision, score, trend, bucketStats, reasoning, ok }
 *     explainPolicy546()   → human-readable reasoning string
 *
 * All identifiers end in 546. Zero npm deps. No state mutation (pure reads).
 * @version 546.0.0
 */

const path = require('path');

const POLICY_VERSION_546      = '546.0.0';
const SCORE_AUTO_THRESHOLD_546       = 0.70;
const SCORE_SUPERVISED_THRESHOLD_546 = 0.40;

// ── safe module loaders (fail-closed per source) ───────────────────────────

function _libDir546() {
  const d = __dirname;
  if (d.includes('/src/lib') || d.includes('src' + path.sep + 'lib')) {
    return path.resolve(d, '..', '..', 'lib');
  }
  return d;
}

let _canon543_546  = null;
let _hist542_546   = null;
let _agg545_546    = null;
let _loadErrors546 = {};

function _loadDeps546() {
  const dir = _libDir546();
  if (!_canon543_546) {
    try { _canon543_546  = require(path.join(dir, 'marketMakerCanon543.js')); }
    catch (e) { _loadErrors546.canon543 = e.message; }
  }
  if (!_hist542_546) {
    try { _hist542_546   = require(path.join(dir, 'deepHealthAlertHistory542.js')); }
    catch (e) { _loadErrors546.hist542 = e.message; }
  }
  if (!_agg545_546) {
    try { _agg545_546    = require(path.join(dir, 'deepHealthAlertAggregator545.js')); }
    catch (e) { _loadErrors546.agg545 = e.message; }
  }
}

// ── data gathering (each source wrapped in try/catch) ─────────────────────

function _readScore546() {
  _loadDeps546();
  if (!_canon543_546 || typeof _canon543_546.getCompositeScore543 !== 'function') {
    return { ok: false, score: 0, error: _loadErrors546.canon543 || 'getCompositeScore543 unavailable' };
  }
  try {
    const r = _canon543_546.getCompositeScore543();
    const score = typeof r.composite === 'number' ? r.composite
                : typeof r.score    === 'number' ? r.score
                : 0;
    return { ok: true, score, raw: r };
  } catch (e) {
    return { ok: false, score: 0, error: e.message };
  }
}

function _readTrend546() {
  _loadDeps546();
  if (!_hist542_546 || typeof _hist542_546.getTrend542 !== 'function') {
    return { ok: false, trend: 'unknown', error: _loadErrors546.hist542 || 'getTrend542 unavailable' };
  }
  try {
    const r = _hist542_546.getTrend542();
    const trend = (typeof r === 'string') ? r
                : (r && typeof r.direction === 'string') ? r.direction
                : 'unknown';
    return { ok: true, trend };
  } catch (e) {
    return { ok: false, trend: 'unknown', error: e.message };
  }
}

function _readBuckets546() {
  _loadDeps546();
  if (!_agg545_546 || typeof _agg545_546.aggregate545 !== 'function') {
    return { ok: false, bucketCount: 0, snapshotCount: 0, error: _loadErrors546.agg545 || 'aggregate545 unavailable' };
  }
  try {
    const r = _agg545_546.aggregate545();
    return {
      ok:            r.ok !== false,
      bucketCount:   r.bucketCount   || 0,
      snapshotCount: r.snapshotCount || 0,
      error:         r.error || null,
    };
  } catch (e) {
    return { ok: false, bucketCount: 0, snapshotCount: 0, error: e.message };
  }
}

// ── decision engine (fail-closed) ─────────────────────────────────────────

/**
 * Core decision logic — deterministic given the same inputs.
 * @param {number} score      composite in [0,1]
 * @param {string} trend      'rising'|'falling'|'stable'|'unknown'
 * @param {object} buckets    { ok, bucketCount, snapshotCount }
 * @returns {'AUTO'|'SUPERVISED'|'MANUAL'}
 */
function _decide546(score, trend, buckets) {
  // Fail-closed: any load failure or unknown → MANUAL
  if (trend === 'rising')  return 'MANUAL';
  if (trend === 'unknown') return 'MANUAL';

  if (score >= SCORE_AUTO_THRESHOLD_546 && buckets.ok) {
    return 'AUTO';
  }
  if (score >= SCORE_SUPERVISED_THRESHOLD_546) {
    return 'SUPERVISED';
  }
  return 'MANUAL';
}

/**
 * Returns the current deep-health policy decision with full reasoning.
 * @returns {{ ok:boolean, decision:string, score:number, trend:string, bucketStats:object, reasoning:string, version:string }}
 */
function getPolicy546() {
  const scoreResult  = _readScore546();
  const trendResult  = _readTrend546();
  const bucketResult = _readBuckets546();

  const score  = scoreResult.score;
  const trend  = trendResult.trend;
  const decision546 = _decide546(score, trend, bucketResult);

  const reasons = [];
  if (!scoreResult.ok)  reasons.push(`score source degraded: ${scoreResult.error}`);
  if (!trendResult.ok)  reasons.push(`trend source degraded: ${trendResult.error}`);
  if (!bucketResult.ok) reasons.push(`bucket source degraded: ${bucketResult.error}`);
  if (score  < SCORE_AUTO_THRESHOLD_546) reasons.push(`score ${score.toFixed(3)} < AUTO threshold ${SCORE_AUTO_THRESHOLD_546}`);
  if (score  < SCORE_SUPERVISED_THRESHOLD_546) reasons.push(`score ${score.toFixed(3)} < SUPERVISED threshold ${SCORE_SUPERVISED_THRESHOLD_546}`);
  if (trend === 'rising')  reasons.push('trend=rising → fail-closed to MANUAL');
  if (trend === 'unknown') reasons.push('trend=unknown → fail-closed to MANUAL');

  return {
    ok:         true,
    version:    POLICY_VERSION_546,
    decision:   decision546,
    score,
    trend,
    bucketStats: bucketResult,
    thresholds: {
      auto:       SCORE_AUTO_THRESHOLD_546,
      supervised: SCORE_SUPERVISED_THRESHOLD_546,
    },
    sources: {
      scoreOk:  scoreResult.ok,
      trendOk:  trendResult.ok,
      bucketsOk: bucketResult.ok,
    },
    reasoning: reasons.length
      ? reasons.join('; ')
      : `decision=${decision546}: score=${score.toFixed(3)}, trend=${trend}, buckets=${bucketResult.bucketCount}`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Human-readable single line explaining the current decision.
 */
function explainPolicy546() {
  try {
    const p = getPolicy546();
    return `[V546] ${p.decision} — ${p.reasoning}`;
  } catch (e) {
    return `[V546] MANUAL (policy engine error: ${e.message})`;
  }
}

module.exports = {
  POLICY_VERSION_546,
  SCORE_AUTO_THRESHOLD_546,
  SCORE_SUPERVISED_THRESHOLD_546,
  getPolicy546,
  explainPolicy546,
  _decide546,   // exported for testing
};
