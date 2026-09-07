'use strict';
/**
 * identityRateLimiter396.js — ECOS V396 D3
 *
 * Per-actor rate limiting on identity enforcement calls.
 * Configurable maxEnforcementsPerWindow and windowMs.
 * Emits identity_rate_limit_event_type_396 when limit exceeded.
 * Complements the bypass monitor by capping abusive re-enforcement attempts.
 *
 * Function: createIdentityRateLimiter396({ audit, maxEnforcementsPerWindow, windowMs })
 * Methods:  checkRateLimit396(actorId, action?)
 *           recordEnforcement396(actorId, action?)
 *           getRateLimitStatus396(actorId?)
 *           resetActor396(actorId)
 */

const IDENTITY_RATE_LIMITER_VERSION_396 = '396.0.0';

// Produced event type
const EVT_RATE_LIMIT_396 = 'identity_rate_limit_event_type_396';
const EVT_RATE_LIMIT_RECORD_396 = 'identity_rate_limit_record_event_type_396';

const DEFAULT_MAX_ENFORCEMENTS = 100;
const DEFAULT_WINDOW_MS        = 60 * 60 * 1000; // 1 hour

function createIdentityRateLimiter396(opts = {}) {
  const audit                  = opts.audit || opts.auditLog || null;
  const maxEnforcementsPerWindow = typeof opts.maxEnforcementsPerWindow === 'number' && opts.maxEnforcementsPerWindow > 0
    ? opts.maxEnforcementsPerWindow
    : DEFAULT_MAX_ENFORCEMENTS;
  const windowMs = typeof opts.windowMs === 'number' && opts.windowMs > 0
    ? opts.windowMs
    : DEFAULT_WINDOW_MS;

  // Map<actorId, { timestamps: number[] }>  — sliding window per actor
  const _windows396 = new Map();

  function _appendAudit(entry) {
    if (!audit) return;
    if (typeof audit.append === 'function') audit.append(entry);
  }

  function _getWindow(actorId) {
    if (!_windows396.has(actorId)) {
      _windows396.set(actorId, { timestamps: [] });
    }
    return _windows396.get(actorId);
  }

  function _pruneWindow(window, now) {
    const cutoff = now - windowMs;
    window.timestamps = window.timestamps.filter(ts => ts >= cutoff);
  }

  /**
   * checkRateLimit396(actorId, action?)
   *
   * Returns { allowed: boolean, actorId, count, limit, windowMs, resetAt? }
   * Does NOT record the enforcement — call recordEnforcement396 separately.
   * Appends EVT_RATE_LIMIT_396 if limit would be exceeded.
   */
  function checkRateLimit396(actorId, action) {
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error('ACTOR_ID_REQUIRED: actorId must be a non-empty string');
    }

    const now    = Date.now();
    const window = _getWindow(actorId);
    _pruneWindow(window, now);

    const count   = window.timestamps.length;
    const allowed = count < maxEnforcementsPerWindow;

    const result = {
      version:  IDENTITY_RATE_LIMITER_VERSION_396,
      allowed,
      actorId,
      action:   action || null,
      count,
      limit:    maxEnforcementsPerWindow,
      windowMs,
      checkedAt: now,
    };

    if (!allowed) {
      // Oldest entry defines when window resets
      const oldest  = window.timestamps[0] || now;
      result.resetAt = oldest + windowMs;

      _appendAudit({
        type: EVT_RATE_LIMIT_396,
        ts:   now,
        data: {
          actorId,
          action:   action || null,
          count,
          limit:    maxEnforcementsPerWindow,
          windowMs,
          resetAt:  result.resetAt,
        },
      });
    }

    return result;
  }

  /**
   * recordEnforcement396(actorId, action?)
   *
   * Records a single enforcement against the actor's sliding window.
   * Returns the updated rate limit status.
   * Appends EVT_RATE_LIMIT_RECORD_396 to audit log.
   */
  function recordEnforcement396(actorId, action) {
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error('ACTOR_ID_REQUIRED: actorId must be a non-empty string');
    }

    const now    = Date.now();
    const window = _getWindow(actorId);
    _pruneWindow(window, now);
    window.timestamps.push(now);

    const count = window.timestamps.length;

    _appendAudit({
      type: EVT_RATE_LIMIT_RECORD_396,
      ts:   now,
      data: { actorId, action: action || null, countAfter: count },
    });

    return {
      version:   IDENTITY_RATE_LIMITER_VERSION_396,
      actorId,
      action:    action || null,
      count,
      limit:     maxEnforcementsPerWindow,
      windowMs,
      recordedAt: now,
    };
  }

  /**
   * getRateLimitStatus396(actorId?)
   *
   * If actorId provided: returns status for that actor.
   * If omitted: returns aggregate status across all tracked actors.
   */
  function getRateLimitStatus396(actorId) {
    const now = Date.now();

    if (actorId !== undefined) {
      if (typeof actorId !== 'string' || !actorId.trim()) {
        throw new Error('ACTOR_ID_REQUIRED: actorId must be a non-empty string');
      }
      const window = _getWindow(actorId);
      _pruneWindow(window, now);
      return {
        version:   IDENTITY_RATE_LIMITER_VERSION_396,
        actorId,
        count:     window.timestamps.length,
        limit:     maxEnforcementsPerWindow,
        windowMs,
        remaining: Math.max(0, maxEnforcementsPerWindow - window.timestamps.length),
        checkedAt: now,
      };
    }

    // Aggregate
    let totalActors   = 0;
    let throttledActors = 0;
    let totalCount    = 0;

    for (const [id, window] of _windows396.entries()) {
      _pruneWindow(window, now);
      totalActors++;
      totalCount += window.timestamps.length;
      if (window.timestamps.length >= maxEnforcementsPerWindow) throttledActors++;
    }

    return {
      version:         IDENTITY_RATE_LIMITER_VERSION_396,
      totalActors,
      throttledActors,
      totalEnforcements: totalCount,
      limit:           maxEnforcementsPerWindow,
      windowMs,
      checkedAt:       now,
    };
  }

  /**
   * resetActor396(actorId)
   *
   * Clears the sliding window for a specific actor (admin use).
   * Returns { reset: true, actorId }.
   */
  function resetActor396(actorId) {
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error('ACTOR_ID_REQUIRED: actorId must be a non-empty string');
    }
    _windows396.delete(actorId);
    return { reset: true, actorId };
  }

  return {
    checkRateLimit396,
    recordEnforcement396,
    getRateLimitStatus396,
    resetActor396,
    IDENTITY_RATE_LIMITER_VERSION_396,
  };
}

module.exports = {
  createIdentityRateLimiter396,
  IDENTITY_RATE_LIMITER_VERSION_396,
  EVT_RATE_LIMIT_396,
  EVT_RATE_LIMIT_RECORD_396,
};
