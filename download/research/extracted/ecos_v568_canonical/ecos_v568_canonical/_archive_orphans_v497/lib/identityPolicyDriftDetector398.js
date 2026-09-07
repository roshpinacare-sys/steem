'use strict';
/**
 * identityPolicyDriftDetector398.js — ECOS V398 D4
 *
 * Compares the current enforcement event distribution against a stored
 * baseline snapshot. Surfaces actors or event types whose frequency has
 * shifted beyond a configurable tolerance.
 * Emits identity_policy_drift_event_type_398.
 *
 * Function: createIdentityPolicyDriftDetector398({ auditLog, audit, tolerance })
 * Methods:
 *   captureBaseline398(opts?)        — snapshot the current distribution as baseline
 *   detectPolicyDrift398(opts?)      — compare current vs baseline
 *   clearBaseline398()               — admin: remove stored baseline
 *   getBaselineInfo398()             — metadata about the stored baseline
 */

const IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398 = '398.0.0';

const EVT_POLICY_DRIFT_398 = 'identity_policy_drift_event_type_398';

// Default tolerance: drift flagged when relative change exceeds 20%
const DEFAULT_TOLERANCE = 0.20;

// Event types considered for drift analysis
const DRIFT_TRACKED_EVENTS = [
  'identity_callsite_enforce_event_type_393',
  'identity_callsite_enforce_reward_event_type_393',
  'identity_callsite_bypass_event_type_393',
  'identity_callsite_deny_event_type_393',
  'identity_batch_enforce_item_event_type_394',
  'identity_rate_limit_event_type_396',
  'identity_rate_limit_record_event_type_396',
  'identity_quota_exceeded_event_type_398',
];

function createIdentityPolicyDriftDetector398(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  const defaultTolerance = typeof opts.tolerance === 'number' && opts.tolerance >= 0
    ? opts.tolerance : DEFAULT_TOLERANCE;

  // Stored baseline
  let baseline = null;

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _getEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _extractActorId(e) {
    const d = e.data || e.payload || e.details || {};
    return d.actorId || d.actor || null;
  }

  /**
   * _buildDistribution(entries, sinceTs)
   * Returns { byType: { [type]: count }, byActor: { [actorId]: count }, total }
   */
  function _buildDistribution(entries, sinceTs) {
    const byType  = {};
    const byActor = {};
    let   total   = 0;

    for (const e of entries) {
      const type = e.type || e.eventType || '';
      if (!DRIFT_TRACKED_EVENTS.includes(type)) continue;
      const ts = e.ts || e.timestamp || 0;
      if (sinceTs !== undefined && ts < sinceTs) continue;

      byType[type] = (byType[type] || 0) + 1;
      const actor = _extractActorId(e);
      if (actor) byActor[actor] = (byActor[actor] || 0) + 1;
      total++;
    }

    return { byType, byActor, total };
  }

  /**
   * _relativeDelta(base, curr)
   * Relative change: (curr - base) / max(base, 1)
   */
  function _relativeDelta(base, curr) {
    const denom = Math.max(base, 1);
    return (curr - base) / denom;
  }

  /**
   * captureBaseline398(opts?)
   * Snapshots the current event distribution as the baseline.
   *
   * opts.sinceTs  — only include events from this ts onwards
   * opts.label    — optional human label for this baseline
   * opts.snapshot — append EVT_POLICY_DRIFT_398
   *
   * Returns { version, capturedAt, label, distribution }
   */
  function captureBaseline398(opts = {}) {
    const now     = Date.now();
    const sinceTs = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const label   = typeof opts.label   === 'string' ? opts.label   : `baseline-${now}`;

    const entries      = _getEntries();
    const distribution = _buildDistribution(entries, sinceTs);

    baseline = {
      capturedAt:   now,
      sinceTs,
      label,
      distribution,
    };

    const result = {
      version:     IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398,
      capturedAt:  now,
      label,
      sinceTs,
      distribution,
    };

    if (opts.snapshot === true) {
      _appendAudit({ type: EVT_POLICY_DRIFT_398, ts: now, data: { action: 'baseline_captured', label, total: distribution.total } });
    }

    return result;
  }

  /**
   * detectPolicyDrift398(opts?)
   * Compares current distribution against the stored baseline.
   *
   * opts.sinceTs   — current window lower bound (default: baseline.capturedAt)
   * opts.tolerance — override drift threshold (0.0–1.0)
   * opts.snapshot  — append EVT_POLICY_DRIFT_398 with results
   *
   * Returns {
   *   version, detectedAt, baselineCapturedAt, tolerance,
   *   driftByType: [{ type, baseline, current, delta, drifted }],
   *   driftByActor: [{ actorId, baseline, current, delta, drifted }],
   *   summary: { totalTypesDrifted, totalActorsDrifted, hasDrift }
   * }
   *
   * Throws BASELINE_NOT_CAPTURED if no baseline exists.
   */
  function detectPolicyDrift398(opts = {}) {
    if (!baseline) throw new Error('BASELINE_NOT_CAPTURED');

    const now       = Date.now();
    const sinceTs   = typeof opts.sinceTs   === 'number' ? opts.sinceTs   : (baseline.sinceTs || 0);
    const tolerance = typeof opts.tolerance === 'number' && opts.tolerance >= 0
      ? opts.tolerance : defaultTolerance;

    const entries  = _getEntries();
    const current  = _buildDistribution(entries, sinceTs);
    const base     = baseline.distribution;

    // --- Type-level drift ---
    const allTypes = new Set([...Object.keys(base.byType), ...Object.keys(current.byType)]);
    const driftByType = [];

    for (const type of allTypes) {
      const baseCount = base.byType[type]    || 0;
      const currCount = current.byType[type] || 0;
      const delta     = _relativeDelta(baseCount, currCount);
      driftByType.push({
        type,
        baseline: baseCount,
        current:  currCount,
        delta:    Math.round(delta * 10000) / 10000,
        drifted:  Math.abs(delta) > tolerance,
      });
    }
    driftByType.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // --- Actor-level drift ---
    const allActors = new Set([...Object.keys(base.byActor), ...Object.keys(current.byActor)]);
    const driftByActor = [];

    for (const actorId of allActors) {
      const baseCount = base.byActor[actorId]    || 0;
      const currCount = current.byActor[actorId] || 0;
      const delta     = _relativeDelta(baseCount, currCount);
      driftByActor.push({
        actorId,
        baseline: baseCount,
        current:  currCount,
        delta:    Math.round(delta * 10000) / 10000,
        drifted:  Math.abs(delta) > tolerance,
      });
    }
    driftByActor.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const summary = {
      totalTypesDrifted:  driftByType.filter(x => x.drifted).length,
      totalActorsDrifted: driftByActor.filter(x => x.drifted).length,
      hasDrift:           driftByType.some(x => x.drifted) || driftByActor.some(x => x.drifted),
      baselineTotal:      base.total,
      currentTotal:       current.total,
    };

    const result = {
      version:             IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398,
      detectedAt:          now,
      baselineCapturedAt:  baseline.capturedAt,
      baselineLabel:       baseline.label,
      sinceTs,
      tolerance,
      driftByType,
      driftByActor,
      summary,
    };

    if (opts.snapshot === true) {
      _appendAudit({
        type: EVT_POLICY_DRIFT_398,
        ts:   now,
        data: {
          action:             'drift_detected',
          hasDrift:           summary.hasDrift,
          totalTypesDrifted:  summary.totalTypesDrifted,
          totalActorsDrifted: summary.totalActorsDrifted,
        },
      });
    }

    return result;
  }

  /**
   * clearBaseline398()
   * Admin: removes the stored baseline.
   */
  function clearBaseline398() {
    const had = !!baseline;
    baseline  = null;
    return { cleared: had, version: IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398, ts: Date.now() };
  }

  /**
   * getBaselineInfo398()
   * Returns metadata about the stored baseline, or null if none.
   */
  function getBaselineInfo398() {
    if (!baseline) return { version: IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398, baseline: null };
    return {
      version:     IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398,
      capturedAt:  baseline.capturedAt,
      label:       baseline.label,
      sinceTs:     baseline.sinceTs,
      total:       baseline.distribution.total,
      typeCount:   Object.keys(baseline.distribution.byType).length,
      actorCount:  Object.keys(baseline.distribution.byActor).length,
    };
  }

  return {
    captureBaseline398,
    detectPolicyDrift398,
    clearBaseline398,
    getBaselineInfo398,
    IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398,
    EVT_POLICY_DRIFT_398,
  };
}

module.exports = {
  createIdentityPolicyDriftDetector398,
  IDENTITY_POLICY_DRIFT_DETECTOR_VERSION_398,
  EVT_POLICY_DRIFT_398,
  DEFAULT_TOLERANCE_398:  DEFAULT_TOLERANCE,
  DRIFT_TRACKED_EVENTS_398: DRIFT_TRACKED_EVENTS,
};
