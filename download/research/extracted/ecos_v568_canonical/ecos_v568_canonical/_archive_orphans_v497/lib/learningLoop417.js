'use strict';
/**
 * src/lib/learningLoop417.js — ECOS V417 (Phase P305) — Adaptive Learning Loop
 *
 * Closes the learning loop: reads SelfImprovementLoop414 recommendations and
 * hot-topic data, and produces per-topic threshold overrides that assessTurn414
 * consults before applying its standard heuristics.
 *
 * Architecture:
 *   SelfImprovementLoop414.report()    →  AdaptiveThresholdEngine417
 *        ↑ recordFeedback(...)                  ↓  getThresholds417(topic)
 *   runTurn415 / wire417 endpoints     →  assessTurn417 (with overrides injected)
 *
 * The engine maintains:
 *   - Per-topic dissatisfaction score derived from report().hotTopics
 *   - Global dissatisfaction baseline from report().dissatisfaction
 *   - A threshold table: { hedgeThreshold, sycophancyThreshold, trimThreshold, groundingBoost }
 *     — each raised when a topic or globally is problematic
 *
 * All identifiers end with 417 (R2). No new npm deps (R3/R6). Sacred untouched (R1).
 *
 * @version 417.0.0
 */

const LEARNING_VERSION_417 = '417.0.0';

// ── defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS_417 = {
  hedgeThreshold:       0.5,  // add hedge if grounding confidence below this
  sycophancyThreshold:  0.6,  // flag sycophancy if score >= this
  trimThreshold:        12,   // trim response if sentence count > this
  groundingBoost:       0,    // additional weight given to grounded answers (0–1)
};

// Caps to prevent runaway adaptation
const THRESHOLD_CAPS_417 = {
  hedgeThreshold:      { min: 0.2, max: 0.95 },
  sycophancyThreshold: { min: 0.3, max: 0.9  },
  trimThreshold:       { min: 4,   max: 20   },
  groundingBoost:      { min: 0,   max: 0.5  },
};

function _clamp417(value, key) {
  const cap = THRESHOLD_CAPS_417[key];
  if (!cap) return value;
  return Math.max(cap.min, Math.min(cap.max, value));
}

// ── AdaptiveThresholdEngine417 ───────────────────────────────────────────────

class AdaptiveThresholdEngine417 {
  /**
   * @param {object} opts
   * @param {object}   [opts.improvementLoop]      - SelfImprovementLoop414 instance
   * @param {number}   [opts.ttlMs]                - stale timeout before recalibration (ms, default 30000)
   * @param {number}   [opts.minSamplesForTopic]   - min signals before a topic gets overrides (default 3)
   * @param {function} [opts.audit]                - audit(type, data) hook
   */
  constructor(opts = {}) {
    this.loop       = opts.improvementLoop || null;
    this.ttlMs      = opts.ttlMs           || 30_000;
    this.minSamples = opts.minSamplesForTopic || 3;
    this.audit      = typeof opts.audit === 'function' ? opts.audit : null;

    this._lastCalibrated   = 0;
    this._globalThresholds = Object.assign({}, DEFAULT_THRESHOLDS_417);
    this._topicThresholds  = {};  // { [topic]: ThresholdSet }
    this._lastReport       = null;
  }

  /** Attach or swap the improvement loop at runtime */
  setLoop417(loop) {
    this.loop = loop;
    this._lastCalibrated = 0;
    return this;
  }

  /** Force a full recalibration pass */
  recalibrate417() {
    if (!this.loop) return this;

    let report;
    try { report = this.loop.report(); }
    catch (_) { return this; }

    this._lastReport     = report;
    this._lastCalibrated = Date.now();

    const globalDissatisfaction = report.dissatisfaction || 0;

    // ── global thresholds ────────────────────────────────────────────────
    const g = Object.assign({}, DEFAULT_THRESHOLDS_417);

    if (globalDissatisfaction > 0.5) {
      g.hedgeThreshold      = _clamp417(g.hedgeThreshold + 0.20,      'hedgeThreshold');
      g.sycophancyThreshold = _clamp417(g.sycophancyThreshold - 0.15, 'sycophancyThreshold');
      g.trimThreshold       = _clamp417(g.trimThreshold - 3,          'trimThreshold');
      g.groundingBoost      = _clamp417(g.groundingBoost + 0.30,      'groundingBoost');
    } else if (globalDissatisfaction > 0.3) {
      g.hedgeThreshold      = _clamp417(g.hedgeThreshold + 0.10,      'hedgeThreshold');
      g.sycophancyThreshold = _clamp417(g.sycophancyThreshold - 0.10, 'sycophancyThreshold');
      g.trimThreshold       = _clamp417(g.trimThreshold - 2,          'trimThreshold');
      g.groundingBoost      = _clamp417(g.groundingBoost + 0.15,      'groundingBoost');
    } else if (globalDissatisfaction < 0.1 && report.totalFeedback >= 10) {
      // Positive signal: relax slightly (avoid over-hedging satisfied users)
      g.hedgeThreshold = _clamp417(g.hedgeThreshold - 0.05,           'hedgeThreshold');
      g.trimThreshold  = _clamp417(g.trimThreshold + 1,               'trimThreshold');
    }
    this._globalThresholds = g;

    // ── per-topic thresholds ─────────────────────────────────────────────
    const topicMap = {};
    const hotTopics = Array.isArray(report.hotTopics) ? report.hotTopics : [];

    for (const ht of hotTopics) {
      const totalSignals = (ht.corrections || 0) + (ht.negatives || 0);
      if (totalSignals < this.minSamples) continue;

      const topicDissatisfaction = totalSignals / Math.max(totalSignals + 1, 1);
      const t = Object.assign({}, g); // inherit global adjustments first

      if (topicDissatisfaction > 0.7) {
        t.hedgeThreshold      = _clamp417(t.hedgeThreshold + 0.20,      'hedgeThreshold');
        t.sycophancyThreshold = _clamp417(t.sycophancyThreshold - 0.15, 'sycophancyThreshold');
        t.trimThreshold       = _clamp417(t.trimThreshold - 3,          'trimThreshold');
        t.groundingBoost      = _clamp417(t.groundingBoost + 0.25,      'groundingBoost');
      } else if (topicDissatisfaction > 0.4) {
        t.hedgeThreshold      = _clamp417(t.hedgeThreshold + 0.10,      'hedgeThreshold');
        t.sycophancyThreshold = _clamp417(t.sycophancyThreshold - 0.08, 'sycophancyThreshold');
        t.trimThreshold       = _clamp417(t.trimThreshold - 1,          'trimThreshold');
        t.groundingBoost      = _clamp417(t.groundingBoost + 0.12,      'groundingBoost');
      }

      topicMap[ht.topic] = t;
    }
    this._topicThresholds = topicMap;

    if (this.audit) {
      try {
        this.audit('learning.recalibrate417', {
          globalDissatisfaction,
          hotTopicCount: hotTopics.length,
          topicsCalibrated: Object.keys(topicMap).length,
          ts: Date.now(),
        });
      } catch (_) {}
    }

    return this;
  }

  /** Returns threshold set for a given topic (global fallback if topic unknown) */
  getThresholds417(topic) {
    if (this.loop && (Date.now() - this._lastCalibrated) > this.ttlMs) {
      this.recalibrate417();
    }
    const key = topic || null;
    if (key && this._topicThresholds[key]) {
      return Object.assign({}, this._topicThresholds[key]);
    }
    return Object.assign({}, this._globalThresholds);
  }

  /** Admin summary */
  summary417() {
    return {
      version: LEARNING_VERSION_417,
      lastCalibrated: this._lastCalibrated,
      staleSinceMs: this._lastCalibrated ? Date.now() - this._lastCalibrated : null,
      globalThresholds: Object.assign({}, this._globalThresholds),
      topicOverrides: Object.assign({}, this._topicThresholds),
      topicCount: Object.keys(this._topicThresholds).length,
      lastReport: this._lastReport ? {
        totalFeedback:    this._lastReport.totalFeedback,
        dissatisfaction:  this._lastReport.dissatisfaction,
        hotTopicCount:    (this._lastReport.hotTopics || []).length,
        recommendations:  this._lastReport.recommendations || [],
      } : null,
    };
  }
}

// ── assessTurn417 — assessTurn414 with learning-loop threshold injection ──────

/**
 * assessTurn417 — drop-in enhanced version of assessTurn414.
 * Applies adaptive threshold overrides from AdaptiveThresholdEngine417 before
 * running the base assessment, then enriches the result with learning metadata.
 *
 * Extra params (beyond assessTurn414 signature):
 *   p.topic   {string}                      — topic tag for per-topic lookup
 *   p.engine  {AdaptiveThresholdEngine417}  — optional; uses defaultEngine417() if omitted
 */
function assessTurn417(p = {}) {
  const { assessTurn414 } = require('./conversationIntelligence414.js');

  const engine = p.engine || defaultEngine417();
  const topic  = p.topic  || null;
  const thresh = engine.getThresholds417(topic);

  // Override maxSentences with adaptive trimThreshold
  const enrichedP = Object.assign({}, p, {
    maxSentences: p.maxSentences || thresh.trimThreshold,
  });

  const result = assessTurn414(enrichedP);

  // Augment with topic-aware hedge if engine says topic is in a high-hedge regime
  if (!result.adjustments.includes('hedge_or_cite') && thresh.hedgeThreshold > 0.65) {
    result.adjustments.push('soft_hedge');
    result.reasons.push(
      `topic '${topic || 'general'}' is in high-hedge regime (threshold=${thresh.hedgeThreshold.toFixed(2)})`
    );
  }

  // Re-evaluate sycophancy at tighter topic threshold
  const sycScore = typeof result.sycophancyScore === 'number' ? result.sycophancyScore : 0;
  if (!result.adjustments.includes('remove_flattery') &&
      thresh.sycophancyThreshold < DEFAULT_THRESHOLDS_417.sycophancyThreshold &&
      sycScore >= thresh.sycophancyThreshold) {
    result.adjustments.push('remove_flattery');
    result.reasons.push(
      `sycophancy re-flagged at tighter topic threshold (score=${sycScore.toFixed(2)}, thresh=${thresh.sycophancyThreshold.toFixed(2)})`
    );
  }

  // Attach learning metadata to result
  result.thresholds417 = {
    topic,
    hedgeThreshold:      thresh.hedgeThreshold,
    sycophancyThreshold: thresh.sycophancyThreshold,
    trimThreshold:       thresh.trimThreshold,
    groundingBoost:      thresh.groundingBoost,
    source: (topic && engine._topicThresholds[topic]) ? 'topic-override' : 'global',
  };

  return result;
}

// ── singleton ─────────────────────────────────────────────────────────────────
let _defaultEngine417 = null;
function defaultEngine417(opts) {
  if (!_defaultEngine417) _defaultEngine417 = new AdaptiveThresholdEngine417(opts);
  return _defaultEngine417;
}

// ── exports ───────────────────────────────────────────────────────────────────
module.exports = {
  LEARNING_VERSION_417,
  DEFAULT_THRESHOLDS_417,
  THRESHOLD_CAPS_417,
  AdaptiveThresholdEngine417,
  assessTurn417,
  defaultEngine417,
};
