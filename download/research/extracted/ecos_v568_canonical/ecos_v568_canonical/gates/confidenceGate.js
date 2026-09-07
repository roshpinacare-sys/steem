/**
 * ECOS Confidence Gate  (src/gates/confidenceGate.js)
 * -------------------------------------------------------
 * Canonical routing gate. Re-exports evaluateConfidenceGate and
 * notifyHitlQueue from src/middleware/confidenceGate.js so all
 * import paths are valid.
 *
 * Anti-scam invariant §2 (Honest Confidence Gate):
 *   - NO floor-clamping (Math.max(c, 0.95) or equivalent) exists anywhere
 *     in this module or in src/middleware/confidenceGate.js.
 *   - If a cloud/local provider returns confidence === null or NaN, the
 *     evaluateConfidenceGate function produces verdict 'HARD_REJECT' with
 *     reason 'confidence must be a finite number between 0 and 1'.
 *   - Callers MUST check for null confidence from offlineInference /
 *     selfRefinementAgent and route to HITL rather than proceeding.
 *
 * Routing summary (V16 thresholds — see middleware/confidenceGate.js):
 *   confidence >= AUTO_THRESHOLD (0.70)             → AUTO_FLOW
 *   confidence in [HITL_THRESHOLD, AUTO) (0.50–0.70) → HITL_QUEUE
 *   confidence < HITL_THRESHOLD (0.50) OR null      → HARD_REJECT → HITL
 *
 * [FIX-V16] HITL_THRESHOLD lowered from 0.75 to 0.50.
 *   This restores the operational band [0.50, 0.70) for HITL_QUEUE routing,
 *   so scores below 0.50 are HARD_REJECT, and >= 0.70 are AUTO_FLOW.
 *
 * Trusted Network Contributor modifier (Win-Win §3):
 *   Applied downstream in _distributeInline (approvalRepo.js) after the
 *   gate verdict. The gate itself is identity-agnostic — it only evaluates
 *   the numeric confidence and structural schema invariants.
 *
 * KNOWN LIMITATIONS:
 *   - confidence values are not calibrated (no temperature/Platt scaling).
 *     Any confidence >= 0.92 from a cloud provider (which returns null)
 *     will never reach AUTO_FLOW until a calibrator is wired in.
 *   - V15: AUTO_THRESHOLD lowered to 0.70 (from 0.92) to match calibrated
 *     output ceiling (~0.71 for rawScore=0.98 via Platt scaling).
 *   - See PRAGMATIC_ROADMAP.md Stage 2 for calibration upgrade path.
 */

'use strict';

// The implementation lives in src/middleware/ (kept for legacy import compat).
const {
  evaluateConfidenceGate,
  notifyHitlQueue,
  AUTO_THRESHOLD,
  HITL_THRESHOLD,
  MAX_PRICE_USD,
  MIN_PRICE_USD,
} = require('../middleware/confidenceGate');

/**
 * Strict null-confidence HITL router.
 *
 * Wraps evaluateConfidenceGate to guarantee that a null/NaN/undefined
 * confidence is NEVER silently passed through. Returns 'HARD_REJECT'
 * with an explicit reason so callers can immediately enqueue to HITL.
 *
 * @param {object} body  Parsed submission body
 * @returns {{ verdict: string, confidence: number|null, reasons: string[], sanitized: object|null }}
 */
function evaluateConfidenceGateStrict(body) {
  const { confidence } = body || {};

  // Pre-flight: explicit null/undefined/NaN check before delegating.
  // evaluateConfidenceGate also catches this, but we make it explicit
  // here so the HITL routing intent is visible at the call site.
  if (confidence === null || confidence === undefined) {
    return {
      verdict: 'HARD_REJECT',
      confidence: null,
      reasons: [
        'confidence is null — provider returned uncalibrated score. ' +
        'Routing to human HITL queue to protect platform from capital loss.',
      ],
      sanitized: null,
    };
  }

  const conf = typeof confidence === 'string' ? parseFloat(confidence) : confidence;
  if (!Number.isFinite(conf)) {
    return {
      verdict: 'HARD_REJECT',
      confidence: null,
      reasons: [
        `confidence "${confidence}" is not a finite number. ` +
        'Routing to human HITL queue.',
      ],
      sanitized: null,
    };
  }

  // Delegate to the full structural gate for all other checks.
  return evaluateConfidenceGate(body);
}

module.exports = {
  evaluateConfidenceGate,          // original (used by middleware/route.js)
  evaluateConfidenceGateStrict,    // strict null-safe wrapper (preferred for new code)
  notifyHitlQueue,
  AUTO_THRESHOLD,
  HITL_THRESHOLD,
  MAX_PRICE_USD,
  MIN_PRICE_USD,
};
