'use strict';
/**
 * src/lib/driftRootCauseTagging436.js — ECOS V436
 * Feature 2: Annotate ttlBoundsDriftDetection435 results with likely causes.
 * @version 436.0.0
 */
const DRIFT_ROOT_CAUSE_TAGGING_VERSION436 = '436.0.0';
const _tagState436 = { tagged: [] };

function tagDrift436(detection, bounds) {
  if (!detection || !detection.drifted) return { ok: false, error: 'no drift' };
  const tags = [];
  const b = bounds || {};
  const samples = detection.samples || [];
  const avg = samples.length ? samples.reduce((a,b)=>a+Number(b||0),0)/samples.length : 0;
  if (b.maxTtl && avg > b.maxTtl) tags.push('load_spike');
  if (b.minTtl && avg > 0 && avg < b.minTtl) tags.push('load_drop');
  if ((detection.ratio || 0) > 0.5) tags.push('regime_change');
  if (tags.length === 0) tags.push('unspecified');
  const out = { workload: detection.workload, ratio: detection.ratio, tags, at: new Date().toISOString() };
  _tagState436.tagged.push(out);
  return { ok: true, ...out };
}

function wireDriftRootCauseTagging436(app) {
  const BASE = '/api/v1/alerts/webhook/retry/dedup/feedback/scale/bounds/drift/tag';
  app.post(BASE, (req, res) => {
    const { detection, bounds } = req.body || {};
    res.json(tagDrift436(detection, bounds));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: DRIFT_ROOT_CAUSE_TAGGING_VERSION436, ..._tagState436 }));
}

module.exports = { DRIFT_ROOT_CAUSE_TAGGING_VERSION436, tagDrift436, wireDriftRootCauseTagging436, _tagState436 };
