/**
 * lib/v156TaskMetricsWiring.js — ECOS V156
 * ─────────────────────────────────────────────────────────────────────────────
 * [V156-TASK-01] Wire AI Metrics into real task resolution flow
 *
 * Responsibilities:
 *   - Hook into approval resolution (POST /api/v1/approvals/:id/resolve)
 *   - Extract confidence, verdict, and pressure signals from approval context
 *   - Record task into aiMetricsEngine for real-time dashboard updates
 *   - Non-fatal: all errors logged, never crash the server
 *
 * Design principles:
 *   - Zero external deps (pure Node.js)
 *   - Called AFTER resolution is persisted (non-blocking)
 *   - Sacred files (fiatLedger.js, auditLog.js) are NEVER touched
 */
'use strict';

/**
 * Extract metrics from an approval object after resolution.
 * @param {object} approval - resolved approval from hitlGate
 * @returns {object} { confidence, verdict, pressureDetected, calibrated }
 */
function extractMetricsFromApproval(approval) {
  if (!approval) return null;

  const confidence = typeof approval.confidence === 'number'
    ? Math.max(0, Math.min(1, approval.confidence))
    : null;

  // Verdict: AUTO_FLOW, HITL_QUEUE, BLOCK, HARD_REJECT, or from decision
  let verdict = 'UNKNOWN';
  if (approval.context?.verdict) {
    verdict = approval.context.verdict;
  } else if (approval.decision) {
    // Map decision to verdict
    if (approval.decision === 'APPROVE') verdict = 'APPROVED';
    if (approval.decision === 'REJECT') verdict = 'REJECTED';
  }

  // Pressure detection: check if approval was escalated or had pressure signals
  const pressureDetected = !!(
    approval.context?.pressureDetected ||
    approval.context?.escalated ||
    (approval.confidence !== null && approval.confidence < 0.5)
  );

  // Calibrated confidence (if available from calibrator)
  const calibrated = typeof approval.context?.calibratedConfidence === 'number'
    ? approval.context.calibratedConfidence
    : null;

  return {
    confidence,
    verdict,
    pressureDetected,
    calibrated,
  };
}

/**
 * Record task metrics after approval resolution.
 * Called from ecos-api-server.js after hitlGate.resolveApproval().
 *
 * @param {object} approval - resolved approval object
 * @param {object} aiMetricsEngine - instance of AiMetricsEngine
 * @param {object} logger - pino logger
 */
function recordApprovalMetrics(approval, aiMetricsEngine, logger) {
  if (!approval || !aiMetricsEngine) return;

  try {
    const metrics = extractMetricsFromApproval(approval);
    if (!metrics) return;

    aiMetricsEngine.recordTask(metrics);

    logger.debug(
      { approvalId: approval.id, verdict: metrics.verdict, confidence: metrics.confidence },
      '[V156-TASK-01] Task metrics recorded to aiMetricsEngine'
    );
  } catch (err) {
    logger.warn(
      { err: err.message, approvalId: approval?.id },
      '[V156-TASK-01] recordApprovalMetrics failed (non-fatal)'
    );
  }
}

/**
 * Record task metrics after auto-flow resolution.
 * Called from ecos-api-server.js after AUTO_FLOW approval is created.
 *
 * @param {object} approval - auto-resolved approval object
 * @param {object} aiMetricsEngine - instance of AiMetricsEngine
 * @param {object} logger - pino logger
 */
function recordAutoFlowMetrics(approval, aiMetricsEngine, logger) {
  if (!approval || !aiMetricsEngine) return;

  try {
    const confidence = typeof approval.confidence === 'number'
      ? Math.max(0, Math.min(1, approval.confidence))
      : null;

    aiMetricsEngine.recordTask({
      confidence,
      verdict: 'AUTO_FLOW',
      pressureDetected: false,
      calibrated: null,
    });

    logger.debug(
      { approvalId: approval.id, confidence },
      '[V156-TASK-01] Auto-flow task metrics recorded'
    );
  } catch (err) {
    logger.warn(
      { err: err.message, approvalId: approval?.id },
      '[V156-TASK-01] recordAutoFlowMetrics failed (non-fatal)'
    );
  }
}

module.exports = {
  extractMetricsFromApproval,
  recordApprovalMetrics,
  recordAutoFlowMetrics,
};
