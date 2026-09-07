'use strict';
/**
 * policyComplianceChecker396.js — ECOS V396 D2
 *
 * Given a named policy from enforcementPolicyRegistry395, verifies that all
 * enforcements performed under that policy match its configured bypassDays
 * and alertThresholdDays. Produces a compliance report with
 * compliant / noncompliant per-event breakdown.
 *
 * Function: createPolicyComplianceChecker396({ auditLog, audit, policyRegistry })
 * Method:   checkPolicyCompliance396(policyName, opts?)
 */

const POLICY_COMPLIANCE_CHECKER_VERSION_396 = '396.0.0';

// Produced event type
const EVT_COMPLIANCE_CHECK_396 = 'policy_compliance_check_event_type_396';

// Consumed event types from V393–V395
const EVT_ENFORCE_TRANSFER_393 = 'identity_callsite_enforce_event_type_393';
const EVT_ENFORCE_REWARD_393   = 'identity_callsite_enforce_reward_event_type_393';
const EVT_BYPASS_393           = 'identity_callsite_bypass_event_type_393';
const EVT_BATCH_ITEM_394       = 'identity_batch_enforce_item_event_type_394';
const EVT_POLICY_REGISTER_395  = 'enforcement_policy_register_event_type_395';

function createPolicyComplianceChecker396(opts = {}) {
  const auditLog       = opts.auditLog || opts.audit || null;
  // policyRegistry may be an instance of createEnforcementPolicyRegistry395
  // or any object with a getPolicy395(name) method
  const policyRegistry = opts.policyRegistry || null;

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

  function _getPolicy(name) {
    if (!policyRegistry) return null;
    if (typeof policyRegistry.getPolicy395 === 'function') {
      try {
        return policyRegistry.getPolicy395(name);
      } catch (e) {
        if (e.code === 'POLICY_NOT_FOUND') return null;
        throw e;
      }
    }
    return null;
  }

  /**
   * checkPolicyCompliance396(policyName, opts?)
   *
   * Scans the audit log for enforcement events matching the policy's action,
   * and validates that each bypass event occurred within the policy's bypassDays
   * window. Produces per-event compliant/noncompliant classification.
   *
   * opts.sinceTs   — restrict to events after this timestamp
   * opts.snapshot  — if true, append EVT_COMPLIANCE_CHECK_396 to audit log
   *
   * Returns:
   * {
   *   version, policyName, policy, checkedAt, sinceTs,
   *   summary: { total, compliant, noncompliant },
   *   events: [ { eventIndex, type, ts, actorId, status: 'compliant'|'noncompliant', reason? } ]
   * }
   */
  function checkPolicyCompliance396(policyName, opts = {}) {
    if (typeof policyName !== 'string' || !policyName.trim()) {
      throw new Error('POLICY_NAME_REQUIRED: policyName must be a non-empty string');
    }

    const sinceTs    = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const doSnapshot = opts.snapshot === true;

    // Resolve policy
    const policy = _getPolicy(policyName);
    if (!policy && policyRegistry) {
      const err = new Error(`POLICY_NOT_FOUND: no policy registered under name "${policyName}"`);
      err.code = 'POLICY_NOT_FOUND';
      throw err;
    }

    // Fall back to defaults if no registry supplied
    const bypassDays         = policy ? policy.bypassDays         : 30;
    const alertThresholdDays = policy ? policy.alertThresholdDays : 3;
    const policyAction       = policy ? policy.action             : null;
    const bypassWindowMs     = bypassDays * 24 * 60 * 60 * 1000;

    const allEntries = _getEntries().filter(e => {
      const ts = e.ts || e.timestamp || 0;
      return ts >= sinceTs;
    });

    const events       = [];
    let compliant      = 0;
    let noncompliant   = 0;

    const now = Date.now();

    allEntries.forEach((e, idx) => {
      const type    = e.type || e.eventType || '';
      const ts      = e.ts   || e.timestamp || 0;
      const d       = e.data || e.payload   || e.details || {};
      const actorId = d.actorId || d.actor || 'unknown';
      const action  = d.action  || '';

      // Only check events that are relevant to this policy's action (if known)
      const isEnforce = type === EVT_ENFORCE_TRANSFER_393 || type === EVT_ENFORCE_REWARD_393;
      const isBypass  = type === EVT_BYPASS_393;
      const isBatchItem = type === EVT_BATCH_ITEM_394;

      if (!isEnforce && !isBypass && !isBatchItem) return;
      if (policyAction && action && action !== policyAction) return;

      let status = 'compliant';
      let reason  = null;

      if (isBypass) {
        // A bypass is compliant if it's still within the bypassDays window
        const bypassTs  = d.bypassGrantedAt || d.grantedAt || ts;
        const expiresAt = bypassTs + bypassWindowMs;
        if (ts > expiresAt) {
          status = 'noncompliant';
          reason = `Bypass event occurred ${Math.round((ts - expiresAt) / (24*60*60*1000))} day(s) after window expiry`;
        } else {
          const remainingMs   = expiresAt - now;
          const remainingDays = remainingMs / (24 * 60 * 60 * 1000);
          if (remainingDays < alertThresholdDays && remainingDays > 0) {
            reason = `Bypass window expires in ${remainingDays.toFixed(1)} day(s)`;
          }
        }
      }

      if (isBatchItem) {
        // For batch items, mark noncompliant if status is 'error' or 'denied'
        const itemStatus = d.status || '';
        if (itemStatus === 'error' || itemStatus === 'denied') {
          status = 'noncompliant';
          reason = `Batch item status: ${itemStatus}`;
        }
      }

      if (status === 'compliant') {
        compliant++;
      } else {
        noncompliant++;
      }

      events.push({
        eventIndex: idx,
        type,
        ts,
        actorId,
        status,
        ...(reason ? { reason } : {}),
      });
    });

    const report = {
      version:    POLICY_COMPLIANCE_CHECKER_VERSION_396,
      policyName,
      policy:     policy || { bypassDays, alertThresholdDays, action: policyAction },
      checkedAt:  now,
      sinceTs,
      summary: {
        total:       events.length,
        compliant,
        noncompliant,
      },
      events,
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_COMPLIANCE_CHECK_396,
        ts:   now,
        data: {
          policyName,
          total:       events.length,
          compliant,
          noncompliant,
        },
      });
    }

    return report;
  }

  return {
    checkPolicyCompliance396,
    POLICY_COMPLIANCE_CHECKER_VERSION_396,
  };
}

module.exports = {
  createPolicyComplianceChecker396,
  POLICY_COMPLIANCE_CHECKER_VERSION_396,
  EVT_COMPLIANCE_CHECK_396,
};
