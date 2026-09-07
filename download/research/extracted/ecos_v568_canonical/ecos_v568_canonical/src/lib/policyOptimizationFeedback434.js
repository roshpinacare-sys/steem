'use strict';
/**
 * src/lib/policyOptimizationFeedback434.js — ECOS V434
 *
 * Feature 5: Policy optimization feedback loop
 * Apply, measure, re-optimize pruning rules. Builds on policyAutoOptimization433.
 *
 * @version 434.0.0
 */

const POLICY_OPTIMIZATION_FEEDBACK_VERSION434 = '434.0.0';

const _feedbackState434 = {
  iterations: 0,
  lastDelta: 0,
  history: [],
};

function _avgRetention(rules) {
  const arr = (rules || []).map(r => Number(r.retentionMs || 0));
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function feedbackLoop434(rules, inventory) {
  let opt;
  try {
    const p433 = require('./policyAutoOptimization433.js');
    opt = p433.optimizePolicy433(rules, inventory);
  } catch (_) {
    opt = { ok: false, optimized: rules || [] };
  }
  const before = _avgRetention(rules);
  const after  = _avgRetention(opt.optimized);
  const delta  = after - before;
  _feedbackState434.iterations += 1;
  _feedbackState434.lastDelta = delta;
  _feedbackState434.history.push({
    at: new Date().toISOString(),
    iteration: _feedbackState434.iterations,
    before, after, delta,
  });
  return { ok: true, iteration: _feedbackState434.iterations, before, after, delta, optimized: opt.optimized };
}

function wirePolicyOptimizationFeedback434(app, opts, auditLog) {
  const BASE434 = '/api/v1/x402/distribute/audit/export/inventory/prune/policy/optimize/feedback';

  app.post(BASE434, (req, res) => {
    const { rules, inventory } = req.body || {};
    res.json(feedbackLoop434(rules, inventory));
  });

  app.get(BASE434 + '/status', (req, res) => {
    res.json({ version: POLICY_OPTIMIZATION_FEEDBACK_VERSION434, ..._feedbackState434 });
  });
}

module.exports = {
  POLICY_OPTIMIZATION_FEEDBACK_VERSION434,
  feedbackLoop434,
  wirePolicyOptimizationFeedback434,
  _feedbackState434,
};
