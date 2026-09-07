'use strict';
/**
 * src/lib/convergenceAwareScheduler436.js — ECOS V436
 * Feature 5: Skip feedback iterations once feedbackConvergenceDetection435 reports converged.
 * @version 436.0.0
 */
const CONVERGENCE_AWARE_SCHEDULER_VERSION436 = '436.0.0';
const _schedState436 = { skipped: 0, ran: 0, lastDecisionAt: null, lastDecision: null };

function maybeRun436(history, rules, inventory, threshold) {
  let conv = { converged: false };
  try {
    const c435 = require('./feedbackConvergenceDetection435.js');
    conv = c435.checkConvergence435(history, threshold);
  } catch (_) {}
  _schedState436.lastDecisionAt = new Date().toISOString();
  if (conv.converged) {
    _schedState436.skipped += 1;
    _schedState436.lastDecision = 'skipped';
    return { ok: true, ran: false, reason: 'converged', maxRatio: conv.maxRatio };
  }
  let fb = { ok: false };
  try {
    const f434 = require('./policyOptimizationFeedback434.js');
    fb = f434.feedbackLoop434(rules, inventory);
  } catch (_) {}
  _schedState436.ran += 1;
  _schedState436.lastDecision = 'ran';
  return { ok: true, ran: true, result: fb };
}

function wireConvergenceAwareScheduler436(app) {
  const BASE = '/api/v1/x402/distribute/audit/export/inventory/prune/policy/optimize/feedback/converge/schedule';
  app.post(BASE, (req, res) => {
    const { history, rules, inventory, threshold } = req.body || {};
    res.json(maybeRun436(history, rules, inventory, threshold));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: CONVERGENCE_AWARE_SCHEDULER_VERSION436, ..._schedState436 }));
}

module.exports = { CONVERGENCE_AWARE_SCHEDULER_VERSION436, maybeRun436, wireConvergenceAwareScheduler436, _schedState436 };
