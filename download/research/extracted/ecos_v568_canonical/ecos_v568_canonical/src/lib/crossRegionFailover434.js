'use strict';
/**
 * src/lib/crossRegionFailover434.js — ECOS V434
 *
 * Feature 1: Cross-region failover
 * Automatic failover across regions on sync break. Builds on selfHealingSync433.
 *
 * @version 434.0.0
 */

const CROSS_REGION_FAILOVER_VERSION434 = '434.0.0';

const _failoverState434 = {
  primary: null,
  active: null,
  failovers: 0,
  lastFailoverAt: null,
  history: [],
};

function failover434(regions) {
  const list = regions || [];
  const primary = list.find(r => r && r.primary) || list[0] || null;
  const healthy = list.filter(r => r && r.healthy !== false);
  if (!primary) return { ok: false, error: 'no regions' };
  _failoverState434.primary = primary.id;
  if (primary.healthy === false) {
    const next = healthy.find(r => r.id !== primary.id);
    if (!next) return { ok: false, error: 'no healthy region' };
    _failoverState434.active = next.id;
    _failoverState434.failovers += 1;
    _failoverState434.lastFailoverAt = new Date().toISOString();
    _failoverState434.history.push({ from: primary.id, to: next.id, at: _failoverState434.lastFailoverAt });
    return { ok: true, failedOver: true, from: primary.id, to: next.id };
  }
  _failoverState434.active = primary.id;
  return { ok: true, failedOver: false, active: primary.id };
}

function wireCrossRegionFailover434(app, opts, auditLog) {
  const BASE434 = '/api/v1/multi/region/sync/heal/failover';

  app.post(BASE434, (req, res) => {
    const { regions } = req.body || {};
    res.json(failover434(regions));
  });

  app.get(BASE434 + '/status', (req, res) => {
    res.json({ version: CROSS_REGION_FAILOVER_VERSION434, ..._failoverState434 });
  });
}

module.exports = {
  CROSS_REGION_FAILOVER_VERSION434,
  failover434,
  wireCrossRegionFailover434,
  _failoverState434,
};
