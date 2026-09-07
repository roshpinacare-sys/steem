'use strict';
/**
 * src/lib/pruningPolicy430.js — ECOS V430
 *
 * Feature 5: Pruning policy engine
 * Complex rules for inventory retention.
 *
 * @version 430.0.0
 */

const PRUNING_POLICY_VERSION430 = '430.0.0';

const _policyState430 = {
  rules: [
    { type: 'format', value: 'csv', retentionMs: 86400000 * 7 }, // Keep CSV for 7 days
    { type: 'size', value: 10485760, action: 'keep' },           // Keep files > 10MB
  ],
};

function evaluatePruningPolicy430(record) {
  for (const rule of _policyState430.rules) {
    if (rule.type === 'format' && record.format === rule.value) {
      const age = Date.now() - new Date(record.recordedAt).getTime();
      if (age > rule.retentionMs) return 'prune';
    }
    if (rule.type === 'size' && record.bytes > rule.value) {
      if (rule.action === 'keep') return 'keep';
    }
  }
  return 'default';
}

function wirePruningPolicy430(app, opts, auditLog) {
  const BASE430 = '/api/v1/x402/distribute/audit/export/inventory/prune/policy';

  app.get(BASE430, (req, res) => {
    res.json({ version: PRUNING_POLICY_VERSION430, rules: _policyState430.rules });
  });

  app.post(BASE430 + '/configure', (req, res) => {
    if (req.body.rules) _policyState430.rules = req.body.rules;
    res.json({ ok: true, rules: _policyState430.rules });
  });
}

module.exports = {
  PRUNING_POLICY_VERSION430,
  evaluatePruningPolicy430,
  wirePruningPolicy430,
};
