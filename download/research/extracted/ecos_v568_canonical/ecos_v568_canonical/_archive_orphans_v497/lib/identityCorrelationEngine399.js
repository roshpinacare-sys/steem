'use strict';
/**
 * identityCorrelationEngine399.js — ECOS V399 D2
 *
 * Cross-actor correlation engine: finds pairs of actors whose enforcement event
 * streams are temporally correlated (events co-occurring within a configurable
 * time window). Useful for detecting coordinated bypass attempts.
 *
 * Function: createIdentityCorrelationEngine399({ auditLog, audit, correlationWindowMs })
 * Methods:
 *   computeCorrelations399(opts?)             — find all correlated actor pairs
 *   getActorCorrelations399(actorId, opts?)   — correlations for a specific actor
 *   listTopCorrelations399(opts?)             — top-N most correlated pairs
 *   clearCorrelationCache399()                — admin: wipe cached correlation results
 */

const IDENTITY_CORRELATION_ENGINE_VERSION_399 = '399.0.0';

const EVT_CORRELATION_399 = 'identity_correlation_event_type_399';

const DEFAULT_CORRELATION_WINDOW_MS = 5000; // 5 seconds
const DEFAULT_MIN_CO_OCCURRENCES    = 2;

function createIdentityCorrelationEngine399(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  const correlationWindowMs = typeof opts.correlationWindowMs === 'number' && opts.correlationWindowMs > 0
    ? opts.correlationWindowMs : DEFAULT_CORRELATION_WINDOW_MS;

  // Cache of last computation
  let _correlationCache = null;
  let _cacheTs = null;

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _getEvents() {
    if (auditLog && typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (auditLog && Array.isArray(auditLog._log)) return auditLog._log;
    return [];
  }

  function _extractActorEvents(events) {
    // Map<actorId, [{ts}]>
    const map = new Map();
    for (const evt of events) {
      const ts = evt.ts || evt.timestamp || 0;
      const actor = (evt.data && (evt.data.actorId || evt.data.actor)) || evt.actorId || evt.actor;
      if (!actor || typeof actor !== 'string') continue;
      if (!map.has(actor)) map.set(actor, []);
      map.get(actor).push(ts);
    }
    return map;
  }

  function _countCoOccurrences(tsA, tsB, windowMs) {
    // For each event in tsA, count how many tsB events fall within windowMs
    let count = 0;
    for (const a of tsA) {
      for (const b of tsB) {
        if (Math.abs(a - b) <= windowMs) {
          count++;
          break; // count each A-event at most once
        }
      }
    }
    return count;
  }

  /**
   * computeCorrelations399(opts?)
   * Scans all audit log entries, groups events by actor, then finds pairs whose
   * events co-occur within correlationWindowMs.
   *
   * opts.sinceTs          — only include events at or after this ts
   * opts.minCoOccurrences — minimum co-occurrence count to include pair (default: 2)
   * opts.snapshot         — append audit event
   *
   * Returns { pairs[], totalPairs, computedAt, version }
   */
  function computeCorrelations399(opts = {}) {
    const now      = Date.now();
    const sinceTs  = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const minCoOcc = typeof opts.minCoOccurrences === 'number' ? opts.minCoOccurrences : DEFAULT_MIN_CO_OCCURRENCES;

    const events = _getEvents().filter(e => (e.ts || e.timestamp || 0) >= sinceTs);
    const actorMap = _extractActorEvents(events);
    const actors   = [...actorMap.keys()].sort();

    const pairs = [];
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i];
        const b = actors[j];
        const coOcc = _countCoOccurrences(actorMap.get(a), actorMap.get(b), correlationWindowMs);
        if (coOcc < minCoOcc) continue;

        const totalA = actorMap.get(a).length;
        const totalB = actorMap.get(b).length;
        // Correlation score: coOcc / geometric mean of event counts
        const score  = coOcc / Math.sqrt(totalA * totalB || 1);

        pairs.push({
          actorIdA: a,
          actorIdB: b,
          coOccurrences: coOcc,
          totalEventsA: totalA,
          totalEventsB: totalB,
          correlationScore: Math.round(score * 10000) / 10000,
          windowMs: correlationWindowMs,
        });
      }
    }

    pairs.sort((a, b) => b.correlationScore - a.correlationScore);

    const result = {
      pairs,
      totalPairs: pairs.length,
      totalActors: actors.length,
      computedAt: now,
      correlationWindowMs,
      version: IDENTITY_CORRELATION_ENGINE_VERSION_399,
    };

    _correlationCache = result;
    _cacheTs = now;

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_CORRELATION_399, ts: now, data: { action: 'compute', totalPairs: pairs.length, totalActors: actors.length } });
    }

    return result;
  }

  /**
   * getActorCorrelations399(actorId, opts?)
   * Returns all correlation pairs involving the given actor.
   * opts.minCoOccurrences — filter threshold
   * opts.sinceTs          — passed through to computeCorrelations399 if re-computing
   */
  function getActorCorrelations399(actorId, opts = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    const base = computeCorrelations399(opts);
    const actorPairs = base.pairs.filter(p => p.actorIdA === actorId || p.actorIdB === actorId);
    return {
      actorId,
      pairs: actorPairs,
      totalPairs: actorPairs.length,
      computedAt: base.computedAt,
      version: IDENTITY_CORRELATION_ENGINE_VERSION_399,
    };
  }

  /**
   * listTopCorrelations399(opts?)
   * Returns the top-N most correlated pairs.
   * opts.limit — number of pairs to return (default: 10)
   * opts.minCoOccurrences
   * opts.sinceTs
   */
  function listTopCorrelations399(opts = {}) {
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 10;
    const base  = computeCorrelations399(opts);
    return {
      pairs: base.pairs.slice(0, limit),
      totalPairs: base.totalPairs,
      limit,
      computedAt: base.computedAt,
      version: IDENTITY_CORRELATION_ENGINE_VERSION_399,
    };
  }

  /**
   * clearCorrelationCache399()
   * Admin: clears cached correlation result.
   */
  function clearCorrelationCache399() {
    _correlationCache = null;
    _cacheTs = null;
    return { cleared: true, ts: Date.now(), version: IDENTITY_CORRELATION_ENGINE_VERSION_399 };
  }

  return {
    computeCorrelations399,
    getActorCorrelations399,
    listTopCorrelations399,
    clearCorrelationCache399,
    IDENTITY_CORRELATION_ENGINE_VERSION_399,
    EVT_CORRELATION_399,
  };
}

module.exports = {
  createIdentityCorrelationEngine399,
  IDENTITY_CORRELATION_ENGINE_VERSION_399,
  EVT_CORRELATION_399,
  DEFAULT_CORRELATION_WINDOW_MS_399: DEFAULT_CORRELATION_WINDOW_MS,
};
