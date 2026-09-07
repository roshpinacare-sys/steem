'use strict';
/**
 * identityQuotaManager398.js — ECOS V398 D1
 *
 * Per-actor daily/weekly enforcement quota tracking with sliding-window consumption,
 * remaining-quota exposure, and quota-exceeded events. Integrates with the V396 D3
 * rate limiter for a two-tier throttle/quota model.
 * Emits identity_quota_exceeded_event_type_398 and identity_quota_record_event_type_398.
 *
 * Function: createIdentityQuotaManager398({ auditLog, audit, defaultDailyQuota, defaultWeeklyQuota })
 * Methods:
 *   defineActorQuota398(actorId, quota)    — set per-actor daily/weekly quotas
 *   recordEnforcementForQuota398(actorId)  — consume one quota unit
 *   checkQuota398(actorId)                 — returns current consumption & remaining
 *   resetActorQuota398(actorId)            — admin reset
 *   getQuotaSummary398(opts?)              — aggregate summary across all actors
 */

const IDENTITY_QUOTA_MANAGER_VERSION_398 = '398.0.0';

const EVT_QUOTA_EXCEEDED_398 = 'identity_quota_exceeded_event_type_398';
const EVT_QUOTA_RECORD_398   = 'identity_quota_record_event_type_398';

const MS_PER_DAY  = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const DEFAULT_DAILY_QUOTA  = 100;
const DEFAULT_WEEKLY_QUOTA = 500;

function createIdentityQuotaManager398(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  const defaultDailyQuota  = typeof opts.defaultDailyQuota  === 'number' && opts.defaultDailyQuota  > 0
    ? opts.defaultDailyQuota  : DEFAULT_DAILY_QUOTA;
  const defaultWeeklyQuota = typeof opts.defaultWeeklyQuota === 'number' && opts.defaultWeeklyQuota > 0
    ? opts.defaultWeeklyQuota : DEFAULT_WEEKLY_QUOTA;

  // Map<actorId, { dailyQuota, weeklyQuota, events: [{ts}] }>
  const actorState = new Map();

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _ensureActor(actorId) {
    if (!actorState.has(actorId)) {
      actorState.set(actorId, {
        dailyQuota:  defaultDailyQuota,
        weeklyQuota: defaultWeeklyQuota,
        events:      [],
      });
    }
    return actorState.get(actorId);
  }

  function _pruneEvents(state, now) {
    const cutoff = now - MS_PER_WEEK;
    state.events = state.events.filter(e => e.ts >= cutoff);
  }

  function _countWindow(events, now, windowMs) {
    const cutoff = now - windowMs;
    return events.filter(e => e.ts >= cutoff).length;
  }

  /**
   * defineActorQuota398(actorId, quota)
   * quota: { dailyQuota?, weeklyQuota? }
   * Returns the merged quota config for the actor.
   */
  function defineActorQuota398(actorId, quota = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    const state = _ensureActor(actorId);
    if (typeof quota.dailyQuota  === 'number' && quota.dailyQuota  > 0) state.dailyQuota  = quota.dailyQuota;
    if (typeof quota.weeklyQuota === 'number' && quota.weeklyQuota > 0) state.weeklyQuota = quota.weeklyQuota;
    return {
      actorId,
      dailyQuota:  state.dailyQuota,
      weeklyQuota: state.weeklyQuota,
      version:     IDENTITY_QUOTA_MANAGER_VERSION_398,
    };
  }

  /**
   * recordEnforcementForQuota398(actorId, opts?)
   * Consume one quota unit; emits exceeded event if over quota.
   * Returns { actorId, allowed, dailyUsed, weeklyUsed, dailyRemaining, weeklyRemaining }
   */
  function recordEnforcementForQuota398(actorId, opts = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    const now   = Date.now();
    const state = _ensureActor(actorId);
    _pruneEvents(state, now);

    const dailyUsed  = _countWindow(state.events, now, MS_PER_DAY);
    const weeklyUsed = _countWindow(state.events, now, MS_PER_WEEK);

    const dailyExceeded  = dailyUsed  >= state.dailyQuota;
    const weeklyExceeded = weeklyUsed >= state.weeklyQuota;
    const allowed        = !dailyExceeded && !weeklyExceeded;

    // Record the event regardless (for tracking); quota enforcement is advisory
    state.events.push({ ts: now });

    const result = {
      actorId,
      allowed,
      dailyUsed:       dailyUsed  + 1,
      weeklyUsed:      weeklyUsed + 1,
      dailyQuota:      state.dailyQuota,
      weeklyQuota:     state.weeklyQuota,
      dailyExceeded:   dailyExceeded,
      weeklyExceeded:  weeklyExceeded,
      dailyRemaining:  Math.max(0, state.dailyQuota  - dailyUsed  - 1),
      weeklyRemaining: Math.max(0, state.weeklyQuota - weeklyUsed - 1),
      ts:              now,
      version:         IDENTITY_QUOTA_MANAGER_VERSION_398,
    };

    _appendAudit({ type: EVT_QUOTA_RECORD_398, ts: now, data: result });

    if (!allowed) {
      const exceededEvt = { type: EVT_QUOTA_EXCEEDED_398, ts: now, data: { actorId, dailyExceeded, weeklyExceeded, dailyUsed: result.dailyUsed, weeklyUsed: result.weeklyUsed } };
      _appendAudit(exceededEvt);
    }

    return result;
  }

  /**
   * checkQuota398(actorId, opts?)
   * Returns current quota status without consuming.
   */
  function checkQuota398(actorId, opts = {}) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    const now   = Date.now();
    const state = _ensureActor(actorId);
    _pruneEvents(state, now);

    const dailyUsed  = _countWindow(state.events, now, MS_PER_DAY);
    const weeklyUsed = _countWindow(state.events, now, MS_PER_WEEK);

    return {
      actorId,
      dailyUsed,
      weeklyUsed,
      dailyQuota:      state.dailyQuota,
      weeklyQuota:     state.weeklyQuota,
      dailyRemaining:  Math.max(0, state.dailyQuota  - dailyUsed),
      weeklyRemaining: Math.max(0, state.weeklyQuota - weeklyUsed),
      dailyExceeded:   dailyUsed  >= state.dailyQuota,
      weeklyExceeded:  weeklyUsed >= state.weeklyQuota,
      checkedAt:       now,
      version:         IDENTITY_QUOTA_MANAGER_VERSION_398,
    };
  }

  /**
   * resetActorQuota398(actorId)
   * Admin reset — clears all sliding-window events for the actor.
   */
  function resetActorQuota398(actorId) {
    if (!actorId || typeof actorId !== 'string') throw new Error('INVALID_ACTOR_ID');
    if (!actorState.has(actorId)) throw new Error('ACTOR_NOT_FOUND');
    actorState.get(actorId).events = [];
    return { actorId, reset: true, ts: Date.now(), version: IDENTITY_QUOTA_MANAGER_VERSION_398 };
  }

  /**
   * getQuotaSummary398(opts?)
   * Aggregate view across all tracked actors.
   * opts.minUsage — filter actors below this daily usage threshold
   * opts.snapshot — append audit event
   */
  function getQuotaSummary398(opts = {}) {
    const now     = Date.now();
    const minUsage = typeof opts.minUsage === 'number' ? opts.minUsage : 0;

    const actors = [];
    for (const [actorId, state] of actorState) {
      _pruneEvents(state, now);
      const dailyUsed  = _countWindow(state.events, now, MS_PER_DAY);
      const weeklyUsed = _countWindow(state.events, now, MS_PER_WEEK);
      if (dailyUsed < minUsage) continue;
      actors.push({
        actorId,
        dailyUsed,
        weeklyUsed,
        dailyQuota:      state.dailyQuota,
        weeklyQuota:     state.weeklyQuota,
        dailyRemaining:  Math.max(0, state.dailyQuota  - dailyUsed),
        weeklyRemaining: Math.max(0, state.weeklyQuota - weeklyUsed),
        dailyExceeded:   dailyUsed  >= state.dailyQuota,
        weeklyExceeded:  weeklyUsed >= state.weeklyQuota,
      });
    }

    // Sort by dailyUsed descending
    actors.sort((a, b) => b.dailyUsed - a.dailyUsed);

    const summary = {
      totalActors:    actors.length,
      exceededDaily:  actors.filter(a => a.dailyExceeded).length,
      exceededWeekly: actors.filter(a => a.weeklyExceeded).length,
    };

    const result = {
      version:     IDENTITY_QUOTA_MANAGER_VERSION_398,
      generatedAt: now,
      defaultDailyQuota,
      defaultWeeklyQuota,
      summary,
      actors,
    };

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_QUOTA_RECORD_398, ts: now, data: { summary: true, ...summary } });
    }

    return result;
  }

  return {
    defineActorQuota398,
    recordEnforcementForQuota398,
    checkQuota398,
    resetActorQuota398,
    getQuotaSummary398,
    // Exported constants
    IDENTITY_QUOTA_MANAGER_VERSION_398,
    EVT_QUOTA_EXCEEDED_398,
    EVT_QUOTA_RECORD_398,
  };
}

module.exports = {
  createIdentityQuotaManager398,
  IDENTITY_QUOTA_MANAGER_VERSION_398,
  EVT_QUOTA_EXCEEDED_398,
  EVT_QUOTA_RECORD_398,
  DEFAULT_DAILY_QUOTA_398:  DEFAULT_DAILY_QUOTA,
  DEFAULT_WEEKLY_QUOTA_398: DEFAULT_WEEKLY_QUOTA,
};
