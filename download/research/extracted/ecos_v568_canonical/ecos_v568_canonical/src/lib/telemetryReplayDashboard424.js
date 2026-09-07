'use strict';
/**
 * telemetryReplayDashboard424.js — ECOS V424 Feature 1
 * Lightweight HTML dashboard for intent routing telemetry.
 * Serves at /api/v1/chat/route/telemetry/dashboard
 * R1: sacred files untouched. R2: all identifiers end in 424. R3: no new npm deps.
 */

const { createHash } = require('crypto');

const _dashboardStore424 = {
  renderCount: 0,
  lastRender: null,
};

/**
 * buildDashboardHtml424(entries) → HTML string
 * @param {Array} entries - telemetry entries from IntentRoutingTelemetry423
 */
function buildDashboardHtml424(entries = []) {
  const intentCounts = {};
  const intentConf = {};
  let totalEntries = entries.length;

  for (const e of entries) {
    const intent = e.intent || 'unknown';
    intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    if (e.confidence !== undefined) {
      if (!intentConf[intent]) intentConf[intent] = [];
      intentConf[intent].push(e.confidence);
    }
  }

  const rows = Object.keys(intentCounts).sort().map(intent => {
    const count = intentCounts[intent];
    const pct = totalEntries > 0 ? ((count / totalEntries) * 100).toFixed(1) : '0.0';
    const confs = intentConf[intent] || [];
    const avgConf = confs.length > 0
      ? (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3)
      : 'N/A';
    const barWidth = Math.max(1, Math.round(parseFloat(pct)));
    return `<tr>
      <td>${escapeHtml424(intent)}</td>
      <td>${count}</td>
      <td>${pct}%<span class="bar" style="width:${barWidth}px"></span></td>
      <td>${avgConf}</td>
    </tr>`;
  }).join('\n');

  const generated = new Date().toISOString();
  _dashboardStore424.renderCount++;
  _dashboardStore424.lastRender = generated;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ECOS V424 — Intent Telemetry Dashboard</title>
<style>
  body{font-family:monospace;background:#0d1117;color:#e6edf3;margin:0;padding:16px}
  h1{color:#58a6ff;font-size:1.2em;margin-bottom:4px}
  .meta{color:#8b949e;font-size:0.8em;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;max-width:700px}
  th{background:#161b22;color:#58a6ff;padding:6px 10px;text-align:left;font-size:0.85em}
  td{padding:5px 10px;border-bottom:1px solid #21262d;font-size:0.82em}
  tr:hover td{background:#161b22}
  .bar{display:inline-block;height:8px;background:#238636;margin-left:6px;border-radius:2px;vertical-align:middle}
  .summary{background:#161b22;border:1px solid #21262d;border-radius:4px;padding:10px 14px;max-width:700px;margin-bottom:14px}
  .summary span{color:#58a6ff;font-weight:bold}
</style>
</head>
<body>
<h1>📊 ECOS V424 — Intent Routing Telemetry Dashboard</h1>
<p class="meta">Generated: ${generated} | Renders: ${_dashboardStore424.renderCount}</p>
<div class="summary">
  Total entries: <span>${totalEntries}</span> &nbsp;|&nbsp;
  Distinct intents: <span>${Object.keys(intentCounts).length}</span>
</div>
<table>
  <thead><tr><th>Intent</th><th>Count</th><th>Share</th><th>Avg Confidence</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="color:#8b949e">No telemetry entries yet.</td></tr>'}</tbody>
</table>
</body>
</html>`;
}

function escapeHtml424(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getDashboardStats424() {
  return { ..._dashboardStore424 };
}

function wireTelemetryDashboard424(app, telemetry423Instance) {
  /* GET /api/v1/chat/route/telemetry/dashboard */
  app.get('/api/v1/chat/route/telemetry/dashboard', (req, res) => {
    let entries = [];
    try {
      if (telemetry423Instance && typeof telemetry423Instance.getRecent === 'function') {
        const r = telemetry423Instance.getRecent(500);
        entries = r.entries || r || [];
      }
    } catch (_) { /* no-op if telemetry unavailable */ }
    const html = buildDashboardHtml424(entries);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  /* GET /api/v1/chat/route/telemetry/dashboard/stats */
  app.get('/api/v1/chat/route/telemetry/dashboard/stats', (req, res) => {
    res.json({ ok: true, stats: getDashboardStats424() });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    buildDashboardHtml424,
    getDashboardStats424,
    wireTelemetryDashboard424,
    _dashboardStore424,
  };
} else {
  module.exports = { buildDashboardHtml424, getDashboardStats424, wireTelemetryDashboard424 };
}
