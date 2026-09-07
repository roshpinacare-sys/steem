'use strict';
/**
 * src/lib/scoreDrivenFailoverRouting436.js — ECOS V436
 * Feature 1: Use regionHealthScoring435 ranks as primary failover selector.
 * @version 436.0.0
 */
const SCORE_DRIVEN_FAILOVER_ROUTING_VERSION436 = '436.0.0';
const _routeState436 = { active: null, routings: 0, lastRouteAt: null, history: [] };

function routeByScore436(regions, minScore) {
  let ranked;
  try {
    const r435 = require('./regionHealthScoring435.js');
    ranked = r435.rankRegions435(regions).ranked || [];
  } catch (_) {
    ranked = (regions || []).map(r => ({ id: r.id, score: r.healthy === false ? 0 : 100 }));
  }
  const min = Number.isFinite(Number(minScore)) ? Number(minScore) : 50;
  const top = ranked.find(r => r.score >= min);
  if (!top) return { ok: false, error: 'no region meets minScore', ranked };
  _routeState436.active = top.id;
  _routeState436.routings += 1;
  _routeState436.lastRouteAt = new Date().toISOString();
  _routeState436.history.push({ id: top.id, score: top.score, at: _routeState436.lastRouteAt });
  return { ok: true, active: top.id, score: top.score, ranked };
}

function wireScoreDrivenFailoverRouting436(app) {
  const BASE = '/api/v1/multi/region/sync/heal/failover/score/route';
  app.post(BASE, (req, res) => {
    const { regions, minScore } = req.body || {};
    res.json(routeByScore436(regions, minScore));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: SCORE_DRIVEN_FAILOVER_ROUTING_VERSION436, ..._routeState436 }));
}

module.exports = { SCORE_DRIVEN_FAILOVER_ROUTING_VERSION436, routeByScore436, wireScoreDrivenFailoverRouting436, _routeState436 };
