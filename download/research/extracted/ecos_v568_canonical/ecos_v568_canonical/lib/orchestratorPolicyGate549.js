'use strict';
/**
 * src/lib/orchestratorPolicyGate549.js — ECOS V549
 *
 * Logging wrapper around orchestratorPolicyGate547.
 *
 * ─── מה זה עושה ───────────────────────────────────────────────────────────────
 * gatePlan549 = gatePlan547 + auto-log לתוך deepHealthPolicyLog548.
 * כל קריאה ל-gatePlan549 → מחזיר את אותה תוצאה כמו gatePlan547,
 * ובנוסף מתעד את ה-decision ב-ring buffer של policyLog548.
 *
 * callers של gate547 ממשיכים לעבוד ללא שינוי.
 * callers חדשים שרוצים observability — יקראו ל-gate549.
 *
 * ─── API ─────────────────────────────────────────────────────────────────────
 *   gatePlan549(plan, opts)    — גרסה מלאה עם logging (wraps gate547)
 *   getPolicyStatus549()       — status עם log summary מ-548 (enriched)
 *   probeCapability549(name)   — דלגציה ל-gate547
 *
 * ─── כלל קשיח ────────────────────────────────────────────────────────────────
 *   gate547 לא נשבר. policyLog548 לא נשבר. wrapper בלבד.
 *   אם policyLog548 throws → תיעוד נדחה בשקט (non-fatal), plan נמשך.
 *
 * Zero new npm deps. All identifiers end in 549.
 * @version 549.0.0
 */

const GATE_VERSION_549 = '549.0.0';

// ── Lazy-load dependencies (avoids circular deps at require time) ─────────────
function _gate547_549()  { return require('./orchestratorPolicyGate547.js'); }
function _pLog548_549()  { return require('./deepHealthPolicyLog548.js'); }

// ── Internal: extract logging fields from gate result ─────────────────────────
function _extractLogEntry549(result) {
  return {
    decision:  result.gateDecision || (result.policy && result.policy.decision) || 'MANUAL',
    score:     (result.policy && typeof result.policy.score === 'number') ? result.policy.score : 0,
    trend:     (result.policy && result.policy.trend) || 'unknown',
    reasoning: result.reason || '',
    source:    'gate549',
    blocked:   !!result.blocked,
    blockedBy: result.blocked ? result.gateDecision : null,
  };
}

/**
 * gatePlan549(plan, opts) — gate with auto-logging.
 * Identical return shape to gatePlan547; adds v549 fields for traceability.
 *
 * @param {{ intent?: string, plan?: object }} plan
 * @param {object} [opts]
 * @returns {object} gate result (same shape as gate547 + { loggedAt, gateCaller })
 */
function gatePlan549(plan, opts) {
  const gate547 = _gate547_549();
  const result  = gate547.gatePlan547(plan, opts);

  // Non-fatal logging — never throw here
  try {
    const pLog = _pLog548_549();
    pLog.recordDecision548(_extractLogEntry549(result));
  } catch (logErr) {
    // policyLog unavailable — continue silently
  }

  return {
    ...result,
    version:    GATE_VERSION_549,
    loggedAt:   new Date().toISOString(),
    gateCaller: 'gate549',
  };
}

/**
 * getPolicyStatus549() — enriched status: gate547 status + policyLog548 summary.
 */
function getPolicyStatus549() {
  const gate547 = _gate547_549();
  const base    = gate547.getPolicyStatus547 ? gate547.getPolicyStatus547() : {};

  let logSummary549 = null;
  try {
    logSummary549 = _pLog548_549().getLogSummary548();
  } catch (_) {}

  return {
    ...base,
    version:    GATE_VERSION_549,
    logSummary: logSummary549,
  };
}

/**
 * probeCapability549(capabilityName) — delegates to gate547.
 */
function probeCapability549(capabilityName) {
  return _gate547_549().probeCapability547(capabilityName);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  GATE_VERSION_549,
  gatePlan549,
  getPolicyStatus549,
  probeCapability549,
};
