// ============================================================
// ecos-api-server-v232-patch.js — V232 (Phase P126)
//
// Work items (per NEXT_SESSION_PROMPT_V231):
//   P126-A  agentLoop231 wired to spend ledger persistence
//   P126-B  Navigator V232 artifact endpoint (feature flags v232)
//   P126-C  Research tool V232 artifact endpoint (prompt v232)
//   P126-D  Spend ledger replay UI data (timeline CSV)
//   P126-E  Webhook delivery log CSV export
//   P126-F  V232 Summary endpoint
//
// Iron rules:
//   R1  Sacred files untouched (fiatLedger.js, auditLog.js).
//   R2  All new identifiers end in _232.
//   R3  Zero new npm dependencies — Node built-ins only.
//   R6  All V220–V231 endpoints untouched.
// ============================================================
'use strict';

// ── Lazy-load agentLoop231 (P126-A) ──────────────────────────────────────────
let _agentLoop231Mod_232 = null;
try {
  _agentLoop231Mod_232 = require('./src/lib/agentLoop231');
} catch (_) {
  try {
    _agentLoop231Mod_232 = require('./lib/agentLoop231');
  } catch (__) { /* graceful: endpoints still register, return ok:false */ }
}

// ── Lazy-load spendLedgerPersistence231 ──────────────────────────────────────
let _ledger232 = null;
try {
  _ledger232 = require('./src/lib/spendLedgerPersistence231');
} catch (_) {
  try {
    _ledger232 = require('./lib/spendLedgerPersistence231');
  } catch (__) { /* graceful degradation */ }
}

// ── Research prompt V232 (P126-C) ────────────────────────────────────────────
const _RESEARCH_PROMPT_V232 = `You are a research assistant for the ECOS platform (V232).

ECOS (Economy of Cognitive Services) is a B2B platform where AI agents autonomously
complete paid work tasks, governed by a reputation system, spend limits, and compliance
rules.

## Current V232 State (Phase P126)

### Core additions in V232
1. **agentLoop231** — agentLoop230 with automatic spend ledger persistence (P126-A).
   Every spend event is now auto-persisted to JSONL via appendSpend_231 without
   caller intervention. spendEstimator: 'token-accurate-v231-persisted'.
2. **ecosNavigator232.jsx** — Navigator artifact updated with V232 feature badges;
   calls /api/v1/admin/feature-flags-v232 to show live V232 feature status.
3. **researchTool232.jsx** — Research tool fetches prompt from /api/v1/admin/research-prompt-v232
   (this endpoint) instead of bundled hardcoded text.
4. **Spend ledger timeline CSV** — GET /api/v1/admin/spend-ledger-v232/timeline.csv
   exports the spend history grouped by projectId as a CSV timeline.
5. **Webhook delivery log CSV export** — GET /api/v1/admin/hitl-webhook-v232/log.csv
   exports the delivery ring buffer as CSV for operator SLA review.

### Key endpoints (V232)
- GET  /api/v1/admin/agent-loop-v231/:projectId/spend  — per-project spend (persisted loop)
- GET  /api/v1/admin/agent-loop-v231/spend/all         — all projects sorted by spend
- GET  /api/v1/admin/spend-ledger-v232/timeline.csv    — CSV spend timeline
- POST /api/v1/admin/hitl-webhook-v232                 — register webhook
- GET  /api/v1/admin/hitl-webhook-v232/log             — delivery log
- GET  /api/v1/admin/hitl-webhook-v232/log.csv         — delivery log CSV
- GET  /api/v1/admin/research-prompt-v232              — this prompt
- GET  /api/v1/admin/feature-flags-v232                — detected V232 features
- GET  /api/v1/admin/summary/v232                      — V232 health summary

### Sacred files
- lib/fiatLedger.js   MD5: 563e9b1f…  🔒 DO NOT TOUCH
- lib/auditLog.js     MD5: e5a5c2c2…  🔒 DO NOT TOUCH

### Research questions to explore
1. How should the spend ledger compaction strategy evolve for very high-volume projects?
2. What is the optimal HITL threshold for different vertical markets (legal, finance, HR)?
3. How can token-accurate spend estimation be extended to support multi-modal inputs?
4. What webhook delivery guarantees can ECOS offer operators (at-most-once vs at-least-once)?
5. How should agentLoop231's auto-persistence interact with catastrophic server restarts?
`;

// ── Webhook state V232 ────────────────────────────────────────────────────────
const _WEBHOOK_LOG_MAX_232 = 100;
const _webhookLog_232      = [];
const _webhookConfig_232   = { url: null, secret: null };
let   _webhookFired_232    = 0;
let   _webhookFailed_232   = 0;

const crypto = require('crypto');

function _signBody_232(body, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function _pushLog_232(entry) {
  _webhookLog_232.push(entry);
  if (_webhookLog_232.length > _WEBHOOK_LOG_MAX_232) {
    _webhookLog_232.shift();
  }
}

function _fireWebhook_232(payload) {
  if (!_webhookConfig_232.url) return;
  const body        = JSON.stringify(payload);
  const started_232 = Date.now();
  const headers_232 = { 'Content-Type': 'application/json' };
  if (_webhookConfig_232.secret) {
    headers_232['X-ECOS-Signature-V232'] = _signBody_232(body, _webhookConfig_232.secret);
  }
  const url_232 = new URL(_webhookConfig_232.url);
  const mod_232 = url_232.protocol === 'https:' ? require('https') : require('http');
  const req_232 = mod_232.request({
    hostname: url_232.hostname,
    port:     url_232.port || (url_232.protocol === 'https:' ? 443 : 80),
    path:     url_232.pathname + url_232.search,
    method:   'POST',
    headers:  headers_232,
  }, (res_232) => {
    const entry_232 = {
      attemptedAt: new Date().toISOString(),
      webhookHost: url_232.hostname,
      event:       payload.event || 'unknown',
      status:      res_232.statusCode,
      durationMs:  Date.now() - started_232,
    };
    _pushLog_232(entry_232);
    if (res_232.statusCode >= 200 && res_232.statusCode < 300) {
      _webhookFired_232++;
    } else {
      _webhookFailed_232++;
    }
  });
  req_232.on('error', (err_232) => {
    _webhookFailed_232++;
    _pushLog_232({
      attemptedAt: new Date().toISOString(),
      webhookHost: url_232.hostname,
      event:       payload.event || 'unknown',
      status:      0,
      durationMs:  Date.now() - started_232,
      error:       err_232.message,
    });
  });
  req_232.write(body);
  req_232.end();
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function _toCSV_232(rows, headers) {
  const escape_232 = (v) => {
    const s = String(v == null ? '' : v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines_232 = [headers.join(',')];
  for (const row_232 of rows) {
    lines_232.push(headers.map(h => escape_232(row_232[h])).join(','));
  }
  return lines_232.join('\r\n');
}

// ── Register all V232 endpoints ───────────────────────────────────────────────
function registerV232Endpoints(app, eventLog_232) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('registerV232Endpoints: app (Express) required');
  }

  // ── [P126-A] agentLoop231 per-project spend ─────────────────────────────
  // GET /api/v1/admin/agent-loop-v231/:projectId/spend
  app.get('/api/v1/admin/agent-loop-v231/:projectId/spend', (req_232a, res_232a) => {
    if (!_agentLoop231Mod_232) {
      return res_232a.status(503).json({ ok: false, error: 'agentLoop231 unavailable' });
    }
    const info_232 = _agentLoop231Mod_232.getProjectSpend_231(req_232a.params.projectId);
    res_232a.json({ ok: true, ...info_232, ecosVersion: 'V232' });
  });

  // GET /api/v1/admin/agent-loop-v231/spend/all — all projects sorted by spend (P126-A)
  app.get('/api/v1/admin/agent-loop-v231/spend/all', (req_232b, res_232b) => {
    if (!_agentLoop231Mod_232) {
      return res_232b.status(503).json({ ok: false, error: 'agentLoop231 unavailable' });
    }
    const map_232 = _agentLoop231Mod_232._defaultSpendMap_231;
    const rows_232 = [];
    for (const [pid_232, micro_232] of map_232.entries()) {
      rows_232.push({
        projectId:       pid_232,
        spentMicroCents: micro_232.toString(),
        spentUsd:        (Number(micro_232) / 10_000).toFixed(4),
        totalSpentUsd:   parseFloat((Number(micro_232) / 10_000).toFixed(4)),
        limitUsd:        _agentLoop231Mod_232.HITL_LIMIT_USD_231,
        hitlRequired:    micro_232 >= _agentLoop231Mod_232.HITL_LIMIT_MICRO_231,
      });
    }
    rows_232.sort((a, b) => b.totalSpentUsd - a.totalSpentUsd);
    res_232b.json({
      ok:          true,
      count:       rows_232.length,
      projects:    rows_232,
      ecosVersion: 'V232',
    });
  });

  // ── [P126-D] Spend ledger timeline CSV export ────────────────────────────
  // GET /api/v1/admin/spend-ledger-v232/timeline.csv
  app.get('/api/v1/admin/spend-ledger-v232/timeline.csv', (req_232c, res_232c) => {
    if (!_ledger232) {
      return res_232c.status(503).json({ ok: false, error: 'spendLedgerPersistence231 unavailable' });
    }
    const limit_232 = Math.min(parseInt(req_232c.query.limit || '1000', 10), 10_000);
    const entries_232 = _ledger232.replayLedger_231(limit_232);
    const csv_232 = _toCSV_232(entries_232, ['t', 'projectId', 'deltaMicro', 'totalMicro', 'ecosVersion']);
    res_232c.setHeader('Content-Type', 'text/csv');
    res_232c.setHeader('Content-Disposition', 'attachment; filename="spend_ledger_v232.csv"');
    res_232c.send(csv_232);
  });

  // ── [P126-E] Webhook delivery log CSV export ─────────────────────────────
  // POST /api/v1/admin/hitl-webhook-v232  — register
  app.post('/api/v1/admin/hitl-webhook-v232', (req_232d, res_232d) => {
    const { url: url_232d, secret: secret_232d } = req_232d.body || {};
    if (!url_232d || typeof url_232d !== 'string') {
      return res_232d.status(400).json({ ok: false, error: 'url required' });
    }
    _webhookConfig_232.url    = url_232d;
    _webhookConfig_232.secret = secret_232d || null;
    res_232d.json({
      ok:          true,
      configured:  true,
      hmacEnabled: !!secret_232d,
      ecosVersion: 'V232',
    });
  });

  // GET /api/v1/admin/hitl-webhook-v232
  app.get('/api/v1/admin/hitl-webhook-v232', (req_232e, res_232e) => {
    res_232e.json({
      ok:          true,
      configured:  !!_webhookConfig_232.url,
      hmacEnabled: !!_webhookConfig_232.secret,
      fired:       _webhookFired_232,
      failed:      _webhookFailed_232,
      logCount:    _webhookLog_232.length,
      ecosVersion: 'V232',
    });
  });

  // GET /api/v1/admin/hitl-webhook-v232/log
  app.get('/api/v1/admin/hitl-webhook-v232/log', (req_232f, res_232f) => {
    const limit_232f = Math.min(parseInt(req_232f.query.limit || '100', 10), _WEBHOOK_LOG_MAX_232);
    const slice_232f = _webhookLog_232.slice(-limit_232f);
    res_232f.json({
      ok:          true,
      count:       slice_232f.length,
      entries:     slice_232f,
      ecosVersion: 'V232',
    });
  });

  // GET /api/v1/admin/hitl-webhook-v232/log.csv  (P126-E: CSV export)
  app.get('/api/v1/admin/hitl-webhook-v232/log.csv', (req_232g, res_232g) => {
    const limit_232g = Math.min(parseInt(req_232g.query.limit || '100', 10), _WEBHOOK_LOG_MAX_232);
    const slice_232g = _webhookLog_232.slice(-limit_232g);
    const csv_232g   = _toCSV_232(slice_232g, ['attemptedAt', 'webhookHost', 'event', 'status', 'durationMs', 'error']);
    res_232g.setHeader('Content-Type', 'text/csv');
    res_232g.setHeader('Content-Disposition', 'attachment; filename="webhook_delivery_log_v232.csv"');
    res_232g.send(csv_232g);
  });

  // ── [P126-C] Research prompt V232 ───────────────────────────────────────
  // GET /api/v1/admin/research-prompt-v232
  app.get('/api/v1/admin/research-prompt-v232', (req_232h, res_232h) => {
    res_232h.json({
      ok:          true,
      prompt:      _RESEARCH_PROMPT_V232,
      version:     'V232',
      ecosVersion: 'V232',
    });
  });

  // ── [P126-B] Navigator feature flags V232 ───────────────────────────────
  // GET /api/v1/admin/feature-flags-v232
  app.get('/api/v1/admin/feature-flags-v232', (req_232i, res_232i) => {
    const flags_232 = {
      agentLoop231:          !!_agentLoop231Mod_232,
      spendLedgerAutoWired:  !!_agentLoop231Mod_232,  // P126-A: key new feature
      tokenAccurateSpend:    !!_agentLoop231Mod_232,
      hmacWebhookV230:       true,
      hmacWebhookV231:       true,
      hmacWebhookV232:       true,
      webhookDeliveryLog:    true,
      webhookDeliveryCSV:    true,   // P126-E
      spendLedgerPersist:    !!_ledger232,
      spendLedgerCSV:        !!_ledger232,  // P126-D
      multiProjectDash:      !!_agentLoop231Mod_232,
      rateHotReload:         true,
      autoRefreshArtifacts:  true,
      spendEstimator:        'token-accurate-v231-persisted',
    };
    res_232i.json({
      ok:          true,
      version:     'V232',
      features:    flags_232,
      detectedAt:  new Date().toISOString(),
      ecosVersion: 'V232',
    });
  });

  // ── [P126-F] V232 Summary ────────────────────────────────────────────────
  // GET /api/v1/admin/summary/v232
  app.get('/api/v1/admin/summary/v232', (req_232j, res_232j) => {
    res_232j.json({
      ok:      true,
      version: 'V232',
      phase:   'P126',
      summary: 'agentLoop231 wired to spend ledger · Navigator V232 badges · ResearchTool V232 · Spend timeline CSV · Webhook delivery CSV',
      newEndpoints: [
        'GET  /api/v1/admin/agent-loop-v231/:projectId/spend  — per-project spend (persisted loop)',
        'GET  /api/v1/admin/agent-loop-v231/spend/all         — all projects sorted by spend',
        'GET  /api/v1/admin/spend-ledger-v232/timeline.csv    — CSV spend timeline (?limit=N)',
        'POST /api/v1/admin/hitl-webhook-v232                 — register webhook (url + secret)',
        'GET  /api/v1/admin/hitl-webhook-v232                 — webhook config + stats',
        'GET  /api/v1/admin/hitl-webhook-v232/log             — delivery log (?limit=N)',
        'GET  /api/v1/admin/hitl-webhook-v232/log.csv         — delivery log CSV export',
        'GET  /api/v1/admin/research-prompt-v232              — V232 research prompt',
        'GET  /api/v1/admin/feature-flags-v232                — detected V232 features',
        'GET  /api/v1/admin/summary/v232                      — this endpoint',
      ],
      newLibs: [
        'src/lib/agentLoop231.js — agentLoop230 + auto-persist via appendSpend_231 (P126-A)',
        'lib/agentLoop231.js    — mirror of src/lib/agentLoop231.js',
      ],
      resolvedGaps: [
        'V231 gap-1: agentLoop230 not wired to spend ledger → agentLoop231 auto-persists',
        'V231 gap-2: Navigator artifact at V230 → ecosNavigator231.jsx with V231 badge panel',
        'V231 gap-3: ResearchTool artifact at V230 → researchTool231.jsx fetches /research-prompt-v231',
        'V231 gap-4: No spend timeline visualization → CSV export for operator tooling',
        'V231 gap-5: Webhook log JSON only → CSV export for spreadsheet SLA review',
      ],
      agentLoop231Status: _agentLoop231Mod_232 ? 'loaded' : 'unavailable',
      ledgerStatus:       _ledger232 ? _ledger232.getLedgerStatus_231() : null,
      webhookStats: {
        configured:  !!_webhookConfig_232.url,
        hmacEnabled: !!_webhookConfig_232.secret,
        fired:       _webhookFired_232,
        failed:      _webhookFailed_232,
        logCount:    _webhookLog_232.length,
      },
      ecosVersion: 'V232',
    });
  });

  // ── Polling for HITL events ───────────────────────────────────────────────
  if (eventLog_232) {
    setInterval(() => {
      if (!_webhookConfig_232.url || !eventLog_232) return;
      const pending_232 = eventLog_232.filter(e =>
        e && e.type === 'HITL_APPROVED' && !e._fired_v232
      );
      for (const ev_232 of pending_232) {
        ev_232._fired_v232 = true;
        _fireWebhook_232({ event: 'HITL_APPROVED_232', payload: ev_232 });
      }
    }, 5000).unref();
  }
}

module.exports = {
  registerV232Endpoints,
  _fireWebhook_232,
  _webhookConfig_232,
  _webhookLog_232,
  _signBody_232,
  _RESEARCH_PROMPT_V232,
  _WEBHOOK_LOG_MAX_232,
};
