'use strict';
/**
 * src/lib/policyAutoOptimization433.js — ECOS V433
 *
 * Feature 5: Policy auto-optimization
 * Auto-optimize pruning rules from inventory statistics.
 *
 * @version 433.0.0
 */

const POLICY_AUTO_OPTIMIZATION_VERSION433 = '433.0.0';

function optimizePolicy433(rules, inventory) {
  const now = Date.now();
  const optimized = (rules || []).map(rule => {
    const matching = (inventory || []).filter(rec =>
      rule.type === 'format' && rec.format === rule.value
    );
    if (matching.length === 0) return rule;
    const ages = matching.map(r => now - new Date(r.recordedAt).getTime());
    const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;
    // suggest retention = 1.25 * avgAge, floored at original
    const suggested = Math.max(rule.retentionMs || 0, Math.floor(avgAge * 1.25));
    return { ...rule, retentionMs: suggested, optimized433: true };
  });
  return { ok: true, optimized };
}

function wirePolicyAutoOptimization433(app, opts, auditLog) {
  const BASE433 = '/api/v1/x402/distribute/audit/export/inventory/prune/policy/optimize';

  app.post(BASE433, (req, res) => {
    const { rules, inventory } = req.body || {};
    res.json(optimizePolicy433(rules, inventory));
  });
}

module.exports = {
  POLICY_AUTO_OPTIMIZATION_VERSION433,
  optimizePolicy433,
  wirePolicyAutoOptimization433,
};
