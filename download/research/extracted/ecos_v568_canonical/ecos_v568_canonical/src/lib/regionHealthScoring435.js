'use strict';
/**
 * src/lib/regionHealthScoring435.js — ECOS V435
 * Feature 1: Region health scoring — continuous scoring driving smarter failover.
 * @version 435.0.0
 */
const REGION_HEALTH_SCORING_VERSION435 = '435.0.0';
const _scoreState435 = { scores: {} };

function scoreRegion435(region) {
  if (!region || !region.id) return { ok: false, error: 'no region' };
  const lat = Number(region.latencyMs || 0);
  const err = Number(region.errorRate || 0);
  const up  = region.healthy === false ? 0 : 1;
  // 0..100, higher is better
  const latScore = Math.max(0, 100 - lat / 5);
  const errScore = Math.max(0, 100 - err * 100);
  const score = Math.round((latScore * 0.4 + errScore * 0.4 + up * 100 * 0.2));
  _scoreState435.scores[region.id] = { score, at: new Date().toISOString() };
  return { ok: true, regionId: region.id, score };
}

function rankRegions435(regions) {
  const out = (regions || []).map(r => ({ id: r.id, score: scoreRegion435(r).score || 0 }));
  out.sort((a, b) => b.score - a.score);
  return { ok: true, ranked: out };
}

function wireRegionHealthScoring435(app) {
  const BASE = '/api/v1/multi/region/sync/heal/failover/score';
  app.post(BASE, (req, res) => res.json(scoreRegion435(req.body && req.body.region)));
  app.post(BASE + '/rank', (req, res) => res.json(rankRegions435(req.body && req.body.regions)));
  app.get(BASE + '/status', (req, res) => res.json({ version: REGION_HEALTH_SCORING_VERSION435, ..._scoreState435 }));
}

module.exports = { REGION_HEALTH_SCORING_VERSION435, scoreRegion435, rankRegions435, wireRegionHealthScoring435, _scoreState435 };
