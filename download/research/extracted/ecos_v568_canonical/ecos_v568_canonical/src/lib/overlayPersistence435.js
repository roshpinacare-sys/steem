'use strict';
/**
 * src/lib/overlayPersistence435.js — ECOS V435
 * Feature 4: Overlay persistence — durable JSONL WAL for dashboard alert overlays.
 * @version 435.0.0
 */
const fs = require('fs');
const path = require('path');

const OVERLAY_PERSISTENCE_VERSION435 = '435.0.0';
const _persistState435 = { dataDir: null, file: null, appended: 0, loaded: 0 };

function _init435(dataDir) {
  const dir = dataDir || path.join(process.cwd(), 'data', 'overlays');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  _persistState435.dataDir = dir;
  _persistState435.file = path.join(dir, 'overlays.jsonl');
  return _persistState435.file;
}

function appendOverlay435(overlay, dataDir) {
  const file = _init435(dataDir);
  const line = JSON.stringify({ at: new Date().toISOString(), overlay }) + '\n';
  try { fs.appendFileSync(file, line); _persistState435.appended += 1; return { ok: true, file }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function loadAll435(dataDir) {
  const file = _init435(dataDir);
  if (!fs.existsSync(file)) return { ok: true, overlays: [] };
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const overlays = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  _persistState435.loaded = overlays.length;
  return { ok: true, overlays };
}

function wireOverlayPersistence435(app, opts) {
  const dataDir = opts && opts.dataDir;
  const BASE = '/api/v1/chat/route/telemetry/rollup/anomalies/correlate/alerting/escalate/analytics/dashboard/overlays/persist';
  app.post(BASE, (req, res) => res.json(appendOverlay435(req.body && req.body.overlay, dataDir)));
  app.get(BASE, (req, res) => res.json(loadAll435(dataDir)));
  app.get(BASE + '/status', (req, res) => res.json({ version: OVERLAY_PERSISTENCE_VERSION435, ..._persistState435 }));
}

module.exports = { OVERLAY_PERSISTENCE_VERSION435, appendOverlay435, loadAll435, wireOverlayPersistence435, _persistState435 };
