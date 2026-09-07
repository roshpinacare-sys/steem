'use strict';
/**
 * src/lib/overlayCompaction436.js — ECOS V436
 * Feature 4: Periodic compaction of overlayPersistence435 WAL.
 * @version 436.0.0
 */
const fs = require('fs');
const path = require('path');
const OVERLAY_COMPACTION_VERSION436 = '436.0.0';
const _compactState436 = { compactions: 0, lastCompactAt: null, lastBefore: 0, lastAfter: 0 };

function compactOverlays436(dataDir, keepLatestN) {
  const dir = dataDir || path.join(process.cwd(), 'data', 'overlays');
  const file = path.join(dir, 'overlays.jsonl');
  if (!fs.existsSync(file)) return { ok: false, error: 'no overlay file' };
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const before = lines.length;
  const keep = Math.max(1, Number(keepLatestN) || 1000);
  const trimmed = lines.slice(-keep);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, trimmed.join('\n') + (trimmed.length ? '\n' : ''));
  fs.renameSync(tmp, file);
  _compactState436.compactions += 1;
  _compactState436.lastCompactAt = new Date().toISOString();
  _compactState436.lastBefore = before;
  _compactState436.lastAfter = trimmed.length;
  return { ok: true, before, after: trimmed.length };
}

function wireOverlayCompaction436(app, opts) {
  const dataDir = opts && opts.dataDir;
  const BASE = '/api/v1/chat/route/telemetry/rollup/anomalies/correlate/alerting/escalate/analytics/dashboard/overlays/persist/compact';
  app.post(BASE, (req, res) => {
    const { keepLatestN } = req.body || {};
    res.json(compactOverlays436(dataDir, keepLatestN));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: OVERLAY_COMPACTION_VERSION436, ..._compactState436 }));
}

module.exports = { OVERLAY_COMPACTION_VERSION436, compactOverlays436, wireOverlayCompaction436, _compactState436 };
