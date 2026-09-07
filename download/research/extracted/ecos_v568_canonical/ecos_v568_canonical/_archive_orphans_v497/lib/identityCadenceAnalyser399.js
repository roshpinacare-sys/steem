'use strict';
/**
 * identityCadenceAnalyser399.js — ECOS V399 D3
 *
 * Enforcement cadence analyser: measures the inter-event gap distribution for
 * each actor (min, max, median, p95 gaps between consecutive enforcement events).
 * Flags actors whose cadence is suspiciously regular (potential automation) or
 * bursty.
 *
 * Function: createIdentityCadenceAnalyser399({ auditLog, audit, regularityThreshold, burstThreshold })
 * Methods:
 *   analyseActorCadence399(actorId, opts?)   — cadence stats for one actor
 *   analyseAllCadences399(opts?)             — cadence for all actors with ≥2 events
 *   flagSuspiciousActors399(opts?)           — actors flagged as regular or bursty
 */

const IDENTITY_CADENCE_ANALYSER_VERSION_399 = '399.0.0';

const EVT_CADENCE_399 = 'identity_cadence_event_type_399';

// Coefficient of variation below this → suspiciously regular
const DEFAULT_REGULARITY_THRESHOLD = 0.15;
// Ratio of p95 gap to median gap above this → bursty
const DEFAULT_BURST_THRESHOLD = 5.0;

function createIdentityCadenceAnalyser399(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  const regularityThreshold = typeof opts.regularityThreshold === 'number'
    ? opts.regularityThreshold : DEFAULT_REGULARITY_THRESHOLD;
  const burstThreshold = typeof opts.burstThreshold === 'number'
    ? opts.burstThreshold : DEFAULT_BURST_THRESHOLD;

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _getEvents() {
    if (auditLog && typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (auditLog && Array.isArray(auditLog._log)) return auditLog._log;
    return [];
  }

  function _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (upper - idx) + sorted[upper] * (idx - lower);
  }

  function _computeGapStats(timestamps) {
    if (timestamps.length < 2) return null;
    const sorted = [...timestamps].sort((a, b) => a - b);
    const gaps   = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i] - sorted[i - 1]);
    }
    gaps.sort((a, b) => a - b);

    const sum  = gaps.reduce((s, g) => s + g, 0);
    const mean = sum / gaps.length;
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
    const stddev = Math.sqrt(variance);
    const cv = mean > 0 ? stddev / mean : 0; // coefficient of variation

    const min    = gaps[0];
    const max    = gaps[gaps.length - 1];
    const median = _percentile(gaps, 50);
    const p95    = _percentile(gaps, 95);

    const isRegular = cv < regularityThreshold && gaps.length >= 3;
    const isBursty  = median > 0 ? (p95 / median) > burstThreshold : false;

    return {
      gapCount: gaps.length,
      minGapMs: Math.round(min),
      maxGapMs: Math.round(max),
      meanGapMs: Math.round(mean),
      medianGapMs: Math.round(median),
      p95GapMs: Math.round(p95),
      stddevMs: Math.round(stddev),
      coefficientOfVariation: Math.round(cv * 10000) / 10000,
      isRegular,
      isBursty,
    };
  }

  function _getActorTimestamps(events, actorId, sinceTs) {
    return events
      .filter(e => {
        const ts = e.ts || e.timestamp || 0;
        if (ts < sinceTs) return false;
        const actor = (e.data && (e.data.actorId || e.data.actor)) || e.actorId || e.actor;
        return actor === actorId;
      })
      .map(e => e.ts || e.timestamp || 0);
  }

  /**
   * analyseActorCadence399(actorId, opts?)
   * Computes inter-event gap stats for a specific actor.
   *
   * opts.sinceTs  — only include events at or after this ts
   * opts.snapshot — append audit event
   *
   * Returns { actorId, eventCount, gapStats, version }
   * gapStats is null if actor has < 2 events.
   */
  function analyseActorCadence399(actorId, opts = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    const now     = Date.now();
    const sinceTs = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;

    const events     = _getEvents();
    const timestamps = _getActorTimestamps(events, actorId, sinceTs);
    const gapStats   = _computeGapStats(timestamps);

    const result = {
      actorId,
      eventCount: timestamps.length,
      gapStats,
      analysedAt: now,
      regularityThreshold,
      burstThreshold,
      version: IDENTITY_CADENCE_ANALYSER_VERSION_399,
    };

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_CADENCE_399, ts: now, data: { actorId, eventCount: timestamps.length, action: 'analyse' } });
    }

    return result;
  }

  /**
   * analyseAllCadences399(opts?)
   * Computes cadence for all actors that appear in the audit log with ≥ 2 events.
   *
   * opts.sinceTs   — filter window
   * opts.minEvents — minimum event count to include (default: 2)
   */
  function analyseAllCadences399(opts = {}) {
    const now      = Date.now();
    const sinceTs  = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const minEvts  = typeof opts.minEvents === 'number' ? opts.minEvents : 2;

    const events = _getEvents().filter(e => (e.ts || e.timestamp || 0) >= sinceTs);

    // Collect unique actors
    const actorSet = new Set();
    for (const evt of events) {
      const actor = (evt.data && (evt.data.actorId || evt.data.actor)) || evt.actorId || evt.actor;
      if (actor && typeof actor === 'string') actorSet.add(actor);
    }

    const results = [];
    for (const actorId of actorSet) {
      const timestamps = _getActorTimestamps(events, actorId, 0); // already filtered above
      if (timestamps.length < minEvts) continue;
      const gapStats = _computeGapStats(timestamps);
      results.push({
        actorId,
        eventCount: timestamps.length,
        gapStats,
      });
    }

    results.sort((a, b) => b.eventCount - a.eventCount);

    return {
      actors: results,
      totalActors: results.length,
      analysedAt: now,
      regularityThreshold,
      burstThreshold,
      version: IDENTITY_CADENCE_ANALYSER_VERSION_399,
    };
  }

  /**
   * flagSuspiciousActors399(opts?)
   * Returns actors flagged as suspiciously regular (CV < regularityThreshold) or
   * bursty (p95/median > burstThreshold).
   *
   * opts.sinceTs   — filter window
   * opts.minEvents — minimum event count (default: 3)
   * opts.snapshot  — append audit event
   */
  function flagSuspiciousActors399(opts = {}) {
    const now     = Date.now();
    const minEvts = typeof opts.minEvents === 'number' ? opts.minEvents : 3;

    const base = analyseAllCadences399({ sinceTs: opts.sinceTs, minEvents: minEvts });

    const regular = base.actors.filter(a => a.gapStats && a.gapStats.isRegular);
    const bursty  = base.actors.filter(a => a.gapStats && a.gapStats.isBursty);

    const result = {
      regularActors: regular,
      burstyActors: bursty,
      totalRegular: regular.length,
      totalBursty: bursty.length,
      flaggedAt: now,
      regularityThreshold,
      burstThreshold,
      version: IDENTITY_CADENCE_ANALYSER_VERSION_399,
    };

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_CADENCE_399, ts: now, data: { action: 'flag', totalRegular: regular.length, totalBursty: bursty.length } });
    }

    return result;
  }

  return {
    analyseActorCadence399,
    analyseAllCadences399,
    flagSuspiciousActors399,
    IDENTITY_CADENCE_ANALYSER_VERSION_399,
    EVT_CADENCE_399,
  };
}

module.exports = {
  createIdentityCadenceAnalyser399,
  IDENTITY_CADENCE_ANALYSER_VERSION_399,
  EVT_CADENCE_399,
  DEFAULT_REGULARITY_THRESHOLD_399: DEFAULT_REGULARITY_THRESHOLD,
  DEFAULT_BURST_THRESHOLD_399: DEFAULT_BURST_THRESHOLD,
};
