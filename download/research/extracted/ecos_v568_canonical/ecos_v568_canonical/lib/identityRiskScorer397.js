'use strict';
/**
 * identityRiskScorer397.js — ECOS V397 D2
 *
 * Computes a per-actor risk score (0–100) based on bypass frequency,
 * denial rate, enforcement lag, and rate-limit hits from V396 D3.
 * Configurable weights. Emits identity_risk_score_event_type_397.
 *
 * Function: createIdentityRiskScorer397({ auditLog, audit, weights })
 * Method:   scoreActor397(actorId, opts?)
 *           scoreAllActors397(opts?)
 */

const IDENTITY_RISK_SCORER_VERSION_397 = '397.0.0';

// Produced event type
const EVT_RISK_SCORE_397 = 'identity_risk_score_event_type_397';

// Consumed event types
const EVT_BYPASS_393            = 'identity_callsite_bypass_event_type_393';
const EVT_DENY_393              = 'identity_callsite_deny_event_type_393';
const EVT_ENFORCE_393           = 'identity_callsite_enforce_event_type_393';
const EVT_ENFORCE_REWARD_393    = 'identity_callsite_enforce_reward_event_type_393';
const EVT_BATCH_ITEM_394        = 'identity_batch_enforce_item_event_type_394';
const EVT_RATE_LIMIT_396        = 'identity_rate_limit_event_type_396';

// Default weights (must sum to 1.0)
const DEFAULT_WEIGHTS_397 = {
  bypassFrequency:  0.35,
  denialRate:       0.30,
  enforcementLag:   0.20,
  rateLimitHits:    0.15,
};

// Scoring normalisation caps
const CAP_BYPASS_COUNT    = 20;   // 20+ bypasses → 100% contribution
const CAP_DENIAL_RATE     = 1.0;  // ratio 0–1
const CAP_LAG_MS          = 7 * 24 * 60 * 60 * 1000; // 7 days lag → 100%
const CAP_RATE_LIMIT_HITS = 10;   // 10+ hits → 100% contribution

function _clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function _normalise(value, cap) {
  if (cap === 0) return 0;
  return _clamp(value / cap, 0, 1);
}

function createIdentityRiskScorer397(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  // Validate and normalise weights
  const rawWeights = opts.weights && typeof opts.weights === 'object' ? opts.weights : {};
  const weights = {
    bypassFrequency: typeof rawWeights.bypassFrequency === 'number' ? rawWeights.bypassFrequency : DEFAULT_WEIGHTS_397.bypassFrequency,
    denialRate:      typeof rawWeights.denialRate      === 'number' ? rawWeights.denialRate      : DEFAULT_WEIGHTS_397.denialRate,
    enforcementLag:  typeof rawWeights.enforcementLag  === 'number' ? rawWeights.enforcementLag  : DEFAULT_WEIGHTS_397.enforcementLag,
    rateLimitHits:   typeof rawWeights.rateLimitHits   === 'number' ? rawWeights.rateLimitHits   : DEFAULT_WEIGHTS_397.rateLimitHits,
  };

  function _getEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _extractActorId(e) {
    const d = e.data || e.payload || e.details || {};
    return d.actorId || d.actor || null;
  }

  /**
   * _buildActorStats(entries, sinceTs)
   * Scan all audit entries and build per-actor stats maps.
   */
  function _buildActorStats(entries, sinceTs) {
    // Map<actorId, { bypasses, denials, enforcements, rateLimitHits, firstEnforceTs, lastBypassTs }>
    const stats = new Map();

    function _ensure(id) {
      if (!stats.has(id)) {
        stats.set(id, {
          bypasses:       0,
          denials:        0,
          enforcements:   0,
          rateLimitHits:  0,
          enforceTs:      [],  // timestamps of enforcement events
          bypassTs:       [],  // timestamps of bypass events
        });
      }
      return stats.get(id);
    }

    for (const e of entries) {
      const ts  = e.ts || e.timestamp || 0;
      if (ts < sinceTs) continue;
      const type = e.type || e.eventType || '';
      const actorId = _extractActorId(e);
      if (!actorId) continue;

      if (type === EVT_BYPASS_393) {
        const s = _ensure(actorId);
        s.bypasses++;
        s.bypassTs.push(ts);
      } else if (type === EVT_DENY_393) {
        _ensure(actorId).denials++;
      } else if (type === EVT_ENFORCE_393 || type === EVT_ENFORCE_REWARD_393) {
        const s = _ensure(actorId);
        s.enforcements++;
        s.enforceTs.push(ts);
      } else if (type === EVT_BATCH_ITEM_394) {
        const d = e.data || {};
        if (d.status === 'ok' || d.status === 'success') {
          const s = _ensure(actorId);
          s.enforcements++;
          s.enforceTs.push(ts);
        } else if (d.status === 'error' || d.status === 'denied') {
          _ensure(actorId).denials++;
        }
      } else if (type === EVT_RATE_LIMIT_396) {
        _ensure(actorId).rateLimitHits++;
      }
    }

    return stats;
  }

  /**
   * _computeScore(s)
   * Returns { score (0–100), components: { bypassFrequency, denialRate, enforcementLag, rateLimitHits } }
   */
  function _computeScore(s) {
    const total = s.enforcements + s.denials;

    // Component 1: bypass frequency normalised to cap
    const bypassFreqRaw  = _normalise(s.bypasses, CAP_BYPASS_COUNT);

    // Component 2: denial rate = denials / (enforcements + denials)
    const denialRateRaw  = total > 0 ? _normalise(s.denials / total, CAP_DENIAL_RATE) : 0;

    // Component 3: enforcement lag = avg gap between consecutive enforcements
    //   large gaps → actor is slow to comply → higher risk
    let lagRaw = 0;
    if (s.enforceTs.length >= 2) {
      const sorted = [...s.enforceTs].sort((a, b) => a - b);
      let totalGap = 0;
      for (let i = 1; i < sorted.length; i++) totalGap += sorted[i] - sorted[i - 1];
      const avgGap = totalGap / (sorted.length - 1);
      lagRaw = _normalise(avgGap, CAP_LAG_MS);
    }

    // Component 4: rate limit hits
    const rateLimitRaw = _normalise(s.rateLimitHits, CAP_RATE_LIMIT_HITS);

    const rawScore =
      bypassFreqRaw  * weights.bypassFrequency +
      denialRateRaw  * weights.denialRate +
      lagRaw         * weights.enforcementLag +
      rateLimitRaw   * weights.rateLimitHits;

    const score = Math.round(_clamp(rawScore * 100, 0, 100));

    return {
      score,
      components: {
        bypassFrequency: Math.round(bypassFreqRaw  * 100),
        denialRate:      Math.round(denialRateRaw  * 100),
        enforcementLag:  Math.round(lagRaw         * 100),
        rateLimitHits:   Math.round(rateLimitRaw   * 100),
      },
    };
  }

  /**
   * scoreActor397(actorId, opts?)
   *
   * opts.sinceTs  — only consider events after this timestamp
   * opts.snapshot — if true, append EVT_RISK_SCORE_397 to audit log
   *
   * Returns:
   * {
   *   version, actorId, score (0–100), risk ('low'|'medium'|'high'|'critical'),
   *   components, counts: { bypasses, denials, enforcements, rateLimitHits },
   *   weights, scoredAt
   * }
   */
  function scoreActor397(actorId, opts = {}) {
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error('ACTOR_ID_REQUIRED: actorId must be a non-empty string');
    }

    const sinceTs    = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const doSnapshot = opts.snapshot === true;

    const entries = _getEntries();
    const stats   = _buildActorStats(entries, sinceTs);
    const s       = stats.get(actorId) || { bypasses: 0, denials: 0, enforcements: 0, rateLimitHits: 0, enforceTs: [], bypassTs: [] };

    const { score, components } = _computeScore(s);

    const risk = score >= 75 ? 'critical'
               : score >= 50 ? 'high'
               : score >= 25 ? 'medium'
               : 'low';

    const now = Date.now();
    const result = {
      version:   IDENTITY_RISK_SCORER_VERSION_397,
      actorId,
      score,
      risk,
      components,
      counts: {
        bypasses:      s.bypasses,
        denials:       s.denials,
        enforcements:  s.enforcements,
        rateLimitHits: s.rateLimitHits,
      },
      weights,
      sinceTs,
      scoredAt: now,
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_RISK_SCORE_397,
        ts:   now,
        data: { actorId, score, risk },
      });
    }

    return result;
  }

  /**
   * scoreAllActors397(opts?)
   *
   * opts.sinceTs   — filter threshold
   * opts.minScore  — only return actors with score >= minScore (default: 0)
   * opts.limit     — max actors to return (sorted descending by score)
   * opts.snapshot  — if true, append one EVT_RISK_SCORE_397 per high/critical actor
   *
   * Returns:
   * { version, scoredAt, count, actors: [ scoreActor397 result, ... ] }
   */
  function scoreAllActors397(opts = {}) {
    const sinceTs    = typeof opts.sinceTs  === 'number' ? opts.sinceTs  : 0;
    const minScore   = typeof opts.minScore === 'number' ? opts.minScore : 0;
    const limit      = typeof opts.limit    === 'number' && opts.limit > 0 ? opts.limit : Infinity;
    const doSnapshot = opts.snapshot === true;

    const entries = _getEntries();
    const stats   = _buildActorStats(entries, sinceTs);

    const now = Date.now();
    const actors = [];

    for (const [actorId, s] of stats.entries()) {
      const { score, components } = _computeScore(s);
      if (score < minScore) continue;

      const risk = score >= 75 ? 'critical'
                 : score >= 50 ? 'high'
                 : score >= 25 ? 'medium'
                 : 'low';

      actors.push({
        version:   IDENTITY_RISK_SCORER_VERSION_397,
        actorId,
        score,
        risk,
        components,
        counts: {
          bypasses:      s.bypasses,
          denials:       s.denials,
          enforcements:  s.enforcements,
          rateLimitHits: s.rateLimitHits,
        },
        weights,
        sinceTs,
        scoredAt: now,
      });

      if (doSnapshot && (risk === 'high' || risk === 'critical')) {
        _appendAudit({
          type: EVT_RISK_SCORE_397,
          ts:   now,
          data: { actorId, score, risk },
        });
      }
    }

    actors.sort((a, b) => b.score - a.score);
    const sliced = actors.slice(0, limit === Infinity ? actors.length : limit);

    return {
      version:   IDENTITY_RISK_SCORER_VERSION_397,
      scoredAt:  now,
      count:     sliced.length,
      actors:    sliced,
    };
  }

  return {
    scoreActor397,
    scoreAllActors397,
    IDENTITY_RISK_SCORER_VERSION_397,
  };
}

module.exports = {
  createIdentityRiskScorer397,
  IDENTITY_RISK_SCORER_VERSION_397,
  EVT_RISK_SCORE_397,
  DEFAULT_WEIGHTS_397,
};
