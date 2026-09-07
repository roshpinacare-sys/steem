'use strict';
/**
 * src/lib/feedbackConvergenceDetection435.js — ECOS V435
 * Feature 5: Feedback convergence detection — stop optimizing when delta stabilizes.
 * @version 435.0.0
 */
const FEEDBACK_CONVERGENCE_DETECTION_VERSION435 = '435.0.0';
const _convState435 = { threshold: 0.05, converged: false, checks: 0 };

function checkConvergence435(history, threshold) {
  const t = Number(threshold);
  if (Number.isFinite(t)) _convState435.threshold = t;
  const hist = (history || []).slice(-3);
  _convState435.checks += 1;
  if (hist.length < 3) return { ok: true, converged: false, reason: 'insufficient history' };
  const deltas = hist.map(h => Math.abs(Number(h.delta || 0)));
  const avgBase = hist.reduce((a, h) => a + Math.abs(Number(h.before || 0)), 0) / hist.length || 1;
  const maxRatio = Math.max.apply(null, deltas) / avgBase;
  const converged = maxRatio <= _convState435.threshold;
  _convState435.converged = converged;
  return { ok: true, converged, maxRatio, threshold: _convState435.threshold };
}

function wireFeedbackConvergenceDetection435(app) {
  const BASE = '/api/v1/x402/distribute/audit/export/inventory/prune/policy/optimize/feedback/converge';
  app.post(BASE, (req, res) => {
    const { history, threshold } = req.body || {};
    res.json(checkConvergence435(history, threshold));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: FEEDBACK_CONVERGENCE_DETECTION_VERSION435, ..._convState435 }));
}

module.exports = { FEEDBACK_CONVERGENCE_DETECTION_VERSION435, checkConvergence435, wireFeedbackConvergenceDetection435, _convState435 };
