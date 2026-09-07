'use strict';
/**
 * src/lib/policyOptimization431.js — ECOS V431
 *
 * Feature 5: Policy optimization
 * Optimize pruning rules based on storage usage.
 *
 * @version 431.0.0
 */

const POLICY_OPTIMIZATION_VERSION431 = '431.0.0';

const _optState431 = {
  autoOptimize: false,
  lastOptimization: null,
};

function optimizePruningPolicy431(currentUsage, rules) {
  const optimized = rules.map(r => {
    if (currentUsage > 0.8 * 1024 * 1024 * 1024) { // 80% of 1GB
      return { ...r, retentionMs: Math.floor(r.retentionMs * 0.8) };
    }
    return r;
  });
  return optimized;
}

function wirePolicyOptimization431(app, opts, auditLog) {
  const BASE431 = '/api/v1/x402/distribute/audit/export/inventory/prune/policy/optimize';

  app.post(BASE431, (req, res) => {
    const { usage, rules } = req.body;
    res.json({ ok: true, optimizedRules: optimizePruningPolicy431(usage, rules) });
  });

  app.get(BASE431 + '/status', (req, res) => {
    res.json({ version: POLICY_OPTIMIZATION_VERSION431, ..._optState431 });
  });
}

module.exports = {
  POLICY_OPTIMIZATION_VERSION431,
  optimizePruningPolicy431,
  wirePolicyOptimization431,
};
