'use strict';
/**
 * identityAlertDispatcher397.js — ECOS V397 D3
 *
 * Configurable alert rules evaluated on demand or on schedule.
 * Dispatches via pluggable callback.
 * Emits identity_alert_dispatch_event_type_397 on each dispatch.
 *
 * Function: createIdentityAlertDispatcher397({ auditLog, audit, rules, onDispatch })
 * Methods:  registerRule397(ruleId, rule)
 *           removeRule397(ruleId)
 *           listRules397()
 *           evaluateAlerts397(opts?)
 */

const IDENTITY_ALERT_DISPATCHER_VERSION_397 = '397.0.0';

// Produced event type
const EVT_ALERT_DISPATCH_397 = 'identity_alert_dispatch_event_type_397';

// Rule types supported
const RULE_TYPE_DENY_RATE    = 'deny_rate_threshold';   // denialCount / totalCount > threshold in window
const RULE_TYPE_BYPASS_EXPIRY = 'bypass_near_expiry';   // bypassDays remaining < threshold for N actors
const RULE_TYPE_RATE_LIMIT   = 'rate_limit_spike';      // rate limit hits > threshold in window

// Consumed event types
const EVT_DENY_393          = 'identity_callsite_deny_event_type_393';
const EVT_ENFORCE_393       = 'identity_callsite_enforce_event_type_393';
const EVT_ENFORCE_REWARD_393 = 'identity_callsite_enforce_reward_event_type_393';
const EVT_BATCH_ITEM_394    = 'identity_batch_enforce_item_event_type_394';
const EVT_BYPASS_393        = 'identity_callsite_bypass_event_type_393';
const EVT_RATE_LIMIT_396    = 'identity_rate_limit_event_type_396';

const DEFAULT_WINDOW_MS_397 = 60 * 60 * 1000; // 1 hour

function createIdentityAlertDispatcher397(opts = {}) {
  const auditLog    = opts.auditLog || opts.audit || null;
  const onDispatch  = typeof opts.onDispatch === 'function' ? opts.onDispatch : null;

  // Map<ruleId, ruleConfig>
  const _rules397 = new Map();

  // Seed with any initial rules provided
  if (opts.rules && typeof opts.rules === 'object') {
    for (const [id, rule] of Object.entries(opts.rules)) {
      _rules397.set(id, rule);
    }
  }

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

  /**
   * registerRule397(ruleId, rule)
   *
   * rule shape:
   * {
   *   type:      RULE_TYPE_*,
   *   windowMs:  number (default 1 hour),
   *   threshold: number — semantic depends on rule type,
   *   minActors: number (bypass_near_expiry only),
   *   description: string (optional),
   * }
   */
  function registerRule397(ruleId, rule) {
    if (typeof ruleId !== 'string' || !ruleId.trim()) {
      throw new Error('RULE_ID_REQUIRED: ruleId must be a non-empty string');
    }
    if (!rule || typeof rule !== 'object') {
      throw new Error('RULE_REQUIRED: rule config object required');
    }
    if (![RULE_TYPE_DENY_RATE, RULE_TYPE_BYPASS_EXPIRY, RULE_TYPE_RATE_LIMIT].includes(rule.type)) {
      throw new Error(`INVALID_RULE_TYPE: type must be one of ${RULE_TYPE_DENY_RATE}, ${RULE_TYPE_BYPASS_EXPIRY}, ${RULE_TYPE_RATE_LIMIT}`);
    }
    _rules397.set(ruleId, {
      ...rule,
      windowMs:    typeof rule.windowMs    === 'number' && rule.windowMs    > 0 ? rule.windowMs    : DEFAULT_WINDOW_MS_397,
      threshold:   typeof rule.threshold   === 'number' ? rule.threshold   : 0.2,
      minActors:   typeof rule.minActors   === 'number' ? rule.minActors   : 1,
      description: rule.description || '',
    });
    return { registered: true, ruleId };
  }

  /**
   * removeRule397(ruleId) — removes a named rule.
   */
  function removeRule397(ruleId) {
    if (!_rules397.has(ruleId)) {
      const err = new Error(`RULE_NOT_FOUND: ${ruleId}`);
      err.code  = 'RULE_NOT_FOUND';
      throw err;
    }
    _rules397.delete(ruleId);
    return { removed: true, ruleId };
  }

  /**
   * listRules397() — returns array of { ruleId, ...rule }
   */
  function listRules397() {
    return Array.from(_rules397.entries()).map(([ruleId, rule]) => ({ ruleId, ...rule }));
  }

  // ── Rule evaluators ──────────────────────────────────────────────────────────

  function _evalDenyRate(rule, entries, now) {
    const cutoff = now - rule.windowMs;
    let denials = 0, total = 0;
    for (const e of entries) {
      const ts   = e.ts || e.timestamp || 0;
      const type = e.type || e.eventType || '';
      if (ts < cutoff) continue;
      if (type === EVT_DENY_393) { denials++; total++; }
      else if (type === EVT_ENFORCE_393 || type === EVT_ENFORCE_REWARD_393) { total++; }
      else if (type === EVT_BATCH_ITEM_394) { total++; }
    }
    const rate = total > 0 ? denials / total : 0;
    return {
      triggered: rate > rule.threshold,
      actual:    rate,
      threshold: rule.threshold,
      detail:    `deny rate ${(rate * 100).toFixed(1)}% > ${(rule.threshold * 100).toFixed(1)}% in last ${rule.windowMs}ms (${denials}/${total} events)`,
    };
  }

  function _evalBypassExpiry(rule, entries, now) {
    const cutoff = now - rule.windowMs;
    // Find actors with recent bypass events and estimate remaining bypass window
    // We look for actors whose most-recent bypass ts is old relative to windowMs
    const actorLastBypass = new Map();
    for (const e of entries) {
      const ts   = e.ts || e.timestamp || 0;
      const type = e.type || e.eventType || '';
      if (ts < cutoff) continue;
      if (type !== EVT_BYPASS_393) continue;
      const d = e.data || {};
      const actorId = d.actorId || d.actor || null;
      if (!actorId) continue;
      if (!actorLastBypass.has(actorId) || actorLastBypass.get(actorId) < ts) {
        actorLastBypass.set(actorId, ts);
      }
    }
    // threshold here = remaining ms fraction (0–1). 0 = expired. < threshold = near expiry
    const nearExpiry = [];
    for (const [actorId, lastTs] of actorLastBypass.entries()) {
      const elapsed = now - lastTs;
      const remaining = Math.max(0, rule.windowMs - elapsed);
      const fraction  = remaining / rule.windowMs;
      if (fraction < rule.threshold) {
        nearExpiry.push({ actorId, remaining, fraction });
      }
    }
    return {
      triggered: nearExpiry.length >= rule.minActors,
      actual:    nearExpiry.length,
      threshold: rule.minActors,
      detail:    `${nearExpiry.length} actor(s) near bypass expiry (threshold: ${rule.minActors})`,
      actors:    nearExpiry,
    };
  }

  function _evalRateLimitSpike(rule, entries, now) {
    const cutoff = now - rule.windowMs;
    let hits = 0;
    for (const e of entries) {
      const ts   = e.ts || e.timestamp || 0;
      const type = e.type || e.eventType || '';
      if (ts < cutoff) continue;
      if (type === EVT_RATE_LIMIT_396) hits++;
    }
    return {
      triggered: hits > rule.threshold,
      actual:    hits,
      threshold: rule.threshold,
      detail:    `${hits} rate limit hits > ${rule.threshold} in last ${rule.windowMs}ms`,
    };
  }

  /**
   * evaluateAlerts397(opts?)
   *
   * opts.ruleIds  — array of rule IDs to evaluate (default: all)
   * opts.snapshot — if true, append EVT_ALERT_DISPATCH_397 per triggered rule
   *
   * Returns:
   * {
   *   version, evaluatedAt,
   *   evaluated: number,
   *   triggered: number,
   *   alerts: [ { ruleId, type, triggered, actual, threshold, detail, dispatchedAt? } ]
   * }
   */
  function evaluateAlerts397(opts = {}) {
    const filterIds  = Array.isArray(opts.ruleIds) ? new Set(opts.ruleIds) : null;
    const doSnapshot = opts.snapshot === true;

    const entries = _getEntries();
    const now     = Date.now();
    const alerts  = [];

    for (const [ruleId, rule] of _rules397.entries()) {
      if (filterIds && !filterIds.has(ruleId)) continue;

      let evalResult;
      if (rule.type === RULE_TYPE_DENY_RATE) {
        evalResult = _evalDenyRate(rule, entries, now);
      } else if (rule.type === RULE_TYPE_BYPASS_EXPIRY) {
        evalResult = _evalBypassExpiry(rule, entries, now);
      } else if (rule.type === RULE_TYPE_RATE_LIMIT) {
        evalResult = _evalRateLimitSpike(rule, entries, now);
      } else {
        continue;
      }

      const alert = {
        ruleId,
        type:        rule.type,
        description: rule.description || '',
        triggered:   evalResult.triggered,
        actual:      evalResult.actual,
        threshold:   evalResult.threshold,
        detail:      evalResult.detail,
        evaluatedAt: now,
      };

      if (evalResult.actors) alert.actors = evalResult.actors;

      if (evalResult.triggered) {
        alert.dispatchedAt = now;

        if (doSnapshot) {
          _appendAudit({
            type: EVT_ALERT_DISPATCH_397,
            ts:   now,
            data: { ruleId, ruleType: rule.type, actual: evalResult.actual, threshold: evalResult.threshold },
          });
        }

        if (onDispatch) {
          try { onDispatch(alert); } catch (_) { /* pluggable callback — swallow */ }
        }
      }

      alerts.push(alert);
    }

    const triggeredCount = alerts.filter(a => a.triggered).length;

    return {
      version:     IDENTITY_ALERT_DISPATCHER_VERSION_397,
      evaluatedAt: now,
      evaluated:   alerts.length,
      triggered:   triggeredCount,
      alerts,
    };
  }

  return {
    registerRule397,
    removeRule397,
    listRules397,
    evaluateAlerts397,
    IDENTITY_ALERT_DISPATCHER_VERSION_397,
  };
}

module.exports = {
  createIdentityAlertDispatcher397,
  IDENTITY_ALERT_DISPATCHER_VERSION_397,
  EVT_ALERT_DISPATCH_397,
  RULE_TYPE_DENY_RATE,
  RULE_TYPE_BYPASS_EXPIRY,
  RULE_TYPE_RATE_LIMIT,
};
