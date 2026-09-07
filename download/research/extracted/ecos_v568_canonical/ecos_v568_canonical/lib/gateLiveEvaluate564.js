'use strict';
/**
 * lib/gateLiveEvaluate564.js — ECOS V564
 *
 * Live Gate Evaluation — שדרוג של gateEvaluateBridge554:
 * משתמש ב-getCompositeScore563() (V563, enhanced) במקום getCompositeScore543() (V543, baseline=0.8).
 *
 * השיפור:
 *   V543 baseline: compositeScore = 0.8 תמיד → decision MANUAL (trend=unknown, fail-closed).
 *   V563 enhanced: compositeScore = 0.8..1.0 (לפי autocorr seed) → score גבוה יותר → AUTO/SUPERVISED.
 *   V564 live-gate: מריץ אותה לוגיקת _decide546, אבל עם ניקוד V563.
 *
 * Chain:
 *   POST /autocorr/seed/v562 → tokenSnapshotBuffer562 →
 *   getCompositeScore563() → gateLiveEvaluate564() → APPROVED/AUTO/SUPERVISED/MANUAL
 *
 * Endpoints:
 *   GET  /api/v1/gate/evaluate/live/v564  — live evaluation with V563 score
 *   GET  /api/v1/gate/evaluate/diff/v564  — diff בין V554 (baseline) ל-V564 (live)
 *   GET  /api/v1/admin/summary/v564
 *
 * All identifiers end in 564. Zero npm deps. SACRED untouched.
 * @module gateLiveEvaluate564
 * @version 564.0.0
 */

var GATE_LIVE_VERSION_564 = '564.0.0';

// ── load deps (fail-soft) ─────────────────────────────────────────────────

var _score563_564  = null;   // marketMakerCompositeEnhanced563
var _hist542_564   = null;   // deepHealthAlertHistory542 (trend)
var _policy546_564 = null;   // deepHealthPolicy546 (_decide546)
var _gate554_564   = null;   // gateEvaluateBridge554 (for diff comparison)

function _load564() {
  if (!_score563_564)  { try { _score563_564  = require('./marketMakerCompositeEnhanced563.js'); } catch (_) {} }
  if (!_hist542_564)   { try { _hist542_564   = require('./deepHealthAlertHistory542.js');        } catch (_) {} }
  if (!_policy546_564) { try { _policy546_564 = require('./deepHealthPolicy546.js');              } catch (_) {} }
  if (!_gate554_564)   { try { _gate554_564   = require('./gateEvaluateBridge554.js');            } catch (_) {} }
}

// ── decision logic (mirrors _decide546, used as fallback) ─────────────────

/**
 * _inlineDecide564(score, trend)
 * Inline fallback — mirrors _decide546 logic exactly.
 */
function _inlineDecide564(score, trend) {
  if (trend === 'rising' || trend === 'unknown') return 'MANUAL';
  if (score >= 0.70) return 'AUTO';
  if (score >= 0.40) return 'SUPERVISED';
  return 'MANUAL';
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * evaluateLiveGate564()
 * Gate evaluation using getCompositeScore563() (V563-enhanced score).
 *
 * @returns {{
 *   ok: boolean, decision: string, score: number, grade: string,
 *   trend: string, reasoning: string, version: string,
 *   scoreSource: string, scoreDetails: object|null
 * }}
 */
function evaluateLiveGate564() {
  _load564();

  // ── score from V563 ───────────────────────────────────────────────────────
  var score564     = 0;
  var grade564     = 'F';
  var scoreOk564   = false;
  var scoreDetails564 = null;
  var scoreSource564  = 'unavailable';

  try {
    if (_score563_564 && typeof _score563_564.getCompositeScore563 === 'function') {
      var sr564 = _score563_564.getCompositeScore563();
      score564  = typeof sr564.compositeScore === 'number' ? sr564.compositeScore : 0;
      grade564  = sr564.grade || '?';
      scoreDetails564 = {
        compositeScore:  sr564.compositeScore,
        grade:           sr564.grade,
        componentScores: sr564.componentScores || null,
        autocorrSource:  sr564.autocorrSource  || null,
        v543baseline:    sr564.v543baseline    || null,
        improvement:     sr564.improvement     || null,
      };
      scoreOk564   = true;
      scoreSource564 = 'getCompositeScore563 (V563-enhanced)';
    }
  } catch (_) {}

  // ── trend from V542 (same source as V554) ────────────────────────────────
  var trend564   = 'unknown';
  var trendOk564 = false;
  try {
    if (_hist542_564 && typeof _hist542_564.getTrend542 === 'function') {
      var tr564 = _hist542_564.getTrend542();
      trend564  = (typeof tr564.direction === 'string') ? tr564.direction
                : (typeof tr564.trend    === 'string') ? tr564.trend
                : 'unknown';
      trendOk564 = trend564 !== 'unknown';
    }
  } catch (_) {}

  // ── decision — prefer _decide546, fallback inline ─────────────────────────
  var decision564  = 'MANUAL';
  var decideOk564  = false;
  var decideSource564 = 'inline-fallback';
  try {
    if (_policy546_564 && typeof _policy546_564._decide546 === 'function') {
      decision564    = _policy546_564._decide546(score564, trend564, { ok: false, bucketCount: 0 });
      decideOk564    = true;
      decideSource564 = '_decide546 (V546)';
    } else {
      decision564  = _inlineDecide564(score564, trend564);
      decideOk564  = true;
    }
  } catch (_) {
    decision564 = _inlineDecide564(score564, trend564);
    decideOk564 = true;
  }

  // ── reasoning ─────────────────────────────────────────────────────────────
  var reasons564 = [];
  if (!scoreOk564) reasons564.push('V563 score unavailable (using 0)');
  if (!trendOk564) reasons564.push('trend=unknown → fail-closed to MANUAL');
  var reasoning564 = reasons564.length > 0
    ? reasons564.join('; ')
    : 'score=' + score564.toFixed(3) + ' grade=' + grade564 + ', trend=' + trend564 + ' → ' + decision564;

  return {
    ok:           decideOk564 && scoreOk564,
    decision:     decision564,
    score:        score564,
    grade:        grade564,
    trend:        trend564,
    reasoning:    reasoning564,
    scoreSource:  scoreSource564,
    decideSource: decideSource564,
    scoreDetails: scoreDetails564,
    version:      GATE_LIVE_VERSION_564,
  };
}

/**
 * evaluateGateDiff564()
 * Returns diff: V554 (baseline V543 score) vs V564 (V563 enhanced score).
 * Useful for observability: "did the live score change the decision?"
 *
 * @returns {{ baseline: object, live: object, scoreDelta: number, decisionChanged: boolean, version: string }}
 */
function evaluateGateDiff564() {
  _load564();

  var baseline564 = null;
  try {
    if (_gate554_564 && typeof _gate554_564.evaluateGate554 === 'function') {
      baseline564 = _gate554_564.evaluateGate554();
    }
  } catch (_) {}

  var live564 = evaluateLiveGate564();

  var scoreDelta564       = baseline564 ? (live564.score - baseline564.score) : null;
  var decisionChanged564  = baseline564 ? (live564.decision !== baseline564.decision) : null;

  return {
    baseline:        baseline564,
    live:            live564,
    scoreDelta:      scoreDelta564,
    decisionChanged: decisionChanged564,
    version:         GATE_LIVE_VERSION_564,
    summary: decisionChanged564
      ? 'Decision changed: ' + (baseline564 && baseline564.decision) + ' → ' + live564.decision
      : decisionChanged564 === false
        ? 'Decision unchanged: ' + live564.decision
        : 'Baseline unavailable',
  };
}

/**
 * registerEndpoints564(app) — wire HTTP endpoints
 */
function registerEndpoints564(app) {
  if (!app || typeof app.get !== 'function') return false;

  // [V564-T01] GET /api/v1/gate/evaluate/live/v564
  app.get('/api/v1/gate/evaluate/live/v564', function (_req, res) {
    try {
      res.json(evaluateLiveGate564());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, version: GATE_LIVE_VERSION_564 });
    }
  });

  // [V564-T02] GET /api/v1/gate/evaluate/diff/v564
  app.get('/api/v1/gate/evaluate/diff/v564', function (_req, res) {
    try {
      res.json(evaluateGateDiff564());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, version: GATE_LIVE_VERSION_564 });
    }
  });

  return true;
}

module.exports = {
  GATE_LIVE_VERSION_564,
  evaluateLiveGate564,
  evaluateGateDiff564,
  registerEndpoints564,
};
