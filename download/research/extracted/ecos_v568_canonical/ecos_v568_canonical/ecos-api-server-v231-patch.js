// ============================================================
// ECOS V231 — Phase P125 — Server Patch
// Implements all five V231 work items from NEXT_SESSION_PROMPT_V230:
//
//   P125-A  Spend ledger persistence
//             New lib: src/lib/spendLedgerPersistence231.js
//             GET  /api/v1/admin/spend-ledger-v231/status
//             GET  /api/v1/admin/spend-ledger-v231/replay?limit=N
//             POST /api/v1/admin/spend-ledger-v231/init
//             POST /api/v1/admin/spend-ledger-v231/compact
//
//   P125-B  agentLoop230 multi-project dashboard
//             GET  /api/v1/admin/agent-loop-v230/spend/all
//               Returns all projects sorted by totalSpentUsd descending.
//
//   P125-C  Webhook delivery log ring buffer (max 100 entries)
//             GET  /api/v1/admin/hitl-webhook-v231/log
//               Returns recent delivery attempts with status, duration, host.
//             POST /api/v1/admin/hitl-webhook-v231
//               Same as v230 register; uses the delivery log on fire.
//             GET  /api/v1/admin/hitl-webhook-v231
//               Returns config + stats + log summary.
//
//   P125-D  Research tool prompt update
//             GET  /api/v1/admin/research-prompt-v231
//               Returns updated RESEARCH_PROMPT referencing V231 state.
//             (artifact update tracked in CHANGELOG_V231.md)
//
//   P125-E  Navigator V231 version badge
//             GET  /api/v1/admin/feature-flags-v231
//               Returns detected V231 features for Navigator badge display.
//
//   P125-F  GET /api/v1/admin/summary/v231 — V231 health summary.
//
// Iron rules:
//   R1  Sacred files untouched (lib/fiatLedger.js, lib/auditLog.js).
//   R2  All new identifiers end in _231.
//   R3  Zero new npm deps; Node built-ins + relative requires only.
//   R6  V220–V230 endpoints untouched; only new routes registered here.
// ============================================================
'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const { URL } = require('url');

// ── P125-A: Spend ledger persistence ─────────────────────────────────────────
let _ledger231 = null;
try {
  _ledger231 = require('./src/lib/spendLedgerPersistence231.js');
} catch (_) {}

// ── P125-B: multi-project dashboard (reads V230 spend map) ───────────────────
let _agentLoop230Mod_231 = null;
try {
  _agentLoop230Mod_231 = require('./src/lib/agentLoop230.js');
} catch (_) {}

// ── P125-C: Webhook delivery log ring buffer ──────────────────────────────────
const _WEBHOOK_LOG_MAX_231 = 100;
const _webhookLog_231 = [];   // ring buffer [{attemptedAt, webhookHost, event, status, durationMs}]

const _webhookConfig_231 = {
  url:           null,
  secret:        null,
  registeredAt:  null,
  registeredBy:  null,
};
let _webhookFired_231  = 0;
let _webhookFailed_231 = 0;

function _signBody_231(body, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function _pushLog_231(entry) {
  if (_webhookLog_231.length >= _WEBHOOK_LOG_MAX_231) {
    _webhookLog_231.shift();   // drop oldest
  }
  _webhookLog_231.push(entry);
}

function _fireWebhook_231(eventObj) {
  if (!_webhookConfig_231.url) return;
  let parsed;
  try { parsed = new URL(_webhookConfig_231.url); } catch (_) { return; }
  const body    = JSON.stringify({ ...eventObj, ecosVersion: 'V231' });
  const headers = {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-ECOS-Event':   eventObj.event || 'HITL_APPROVED_231',
  };
  if (_webhookConfig_231.secret) {
    headers['X-ECOS-Signature-V231'] = _signBody_231(body, _webhookConfig_231.secret);
  }
  const start    = Date.now();
  const isHttps  = parsed.protocol === 'https:';
  const mod      = isHttps ? https : http;
  const req = mod.request({
    hostname: parsed.hostname,
    port:     parsed.port || (isHttps ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'POST',
    headers,
  }, (res) => {
    const durationMs = Date.now() - start;
    const status     = res.statusCode < 300 ? 'ok' : 'http-error';
    if (res.statusCode < 300) { _webhookFired_231++; }
    else                       { _webhookFailed_231++; }
    _pushLog_231({ attemptedAt: new Date().toISOString(), webhookHost: parsed.hostname, event: eventObj.event || 'HITL_APPROVED_231', status, durationMs });
    res.resume();
  });
  req.on('error', (err) => {
    const durationMs = Date.now() - start;
    _webhookFailed_231++;
    _pushLog_231({ attemptedAt: new Date().toISOString(), webhookHost: parsed.hostname, event: eventObj.event || 'HITL_APPROVED_231', status: 'error', durationMs, error: err.message });
  });
  req.write(body);
  req.end();
}

// ── P125-D: Research prompt V231 ─────────────────────────────────────────────
const _RESEARCH_PROMPT_V231 = `# ECOS Research Prompt — V231 (Phase P125)

## System State at V231
- Version: 231.0.0 | Phase: P125 | Date: ${new Date().toISOString().slice(0, 10)}
- Base: V230 canonical (P124: token-accurate agentLoop230, auto-refresh, HMAC webhook, rate hot-reload)

## V231 Additions (P125)
1. **Spend Ledger Persistence (P125-A)**: agentLoop spend now survives restarts via
   append-only JSONL file at \`data/spend_ledger_231.jsonl\` (max 10,000 entries, auto-compact).
   API: GET /api/v1/admin/spend-ledger-v231/status | replay | compact.
2. **Multi-project Dashboard (P125-B)**: GET /api/v1/admin/agent-loop-v230/spend/all
   returns all projects sorted by totalSpentUsd descending.
3. **Webhook Delivery Log (P125-C)**: ring buffer (max 100) tracks each webhook attempt
   with attemptedAt, host, status, durationMs. API: GET /api/v1/admin/hitl-webhook-v231/log.
4. **Research Prompt V231 (P125-D)**: This prompt now references V231 state accurately.
5. **Navigator Feature Badges (P125-E)**: GET /api/v1/admin/feature-flags-v231 returns
   detected V231 features (agentLoop230, HMAC, ledger persistence, etc.) for Navigator UI.

## Core Economics (unchanged)
- Split: 40% platform / 40% validators / 20% insurance (spec.json)
- HITL spend cap: $20 USD per project (agentLoop230)
- Token-accurate spend: estimateSpend_229 via agentLoop230

## Architecture
- Sacred: lib/fiatLedger.js (MD5: 563e9b1f…) · lib/auditLog.js (MD5: e5a5c2c2…)
- Zero new npm deps (R3). All identifiers suffixed _231 (R2).
- Existing V220–V230 endpoints preserved (R6).
`;

// ── Main register function ────────────────────────────────────────────────────
function registerV231Endpoints(app, eventLog_231) {

  // ── [P125-A] Spend ledger persistence endpoints ───────────────────────────
  // GET /api/v1/admin/spend-ledger-v231/status
  app.get('/api/v1/admin/spend-ledger-v231/status', (req_231a, res_231a) => {
    if (!_ledger231) {
      return res_231a.status(503).json({ ok: false, error: 'spendLedgerPersistence231 not loaded', ecosVersion: 'V231' });
    }
    res_231a.json({ ok: true, ..._ledger231.getLedgerStatus_231() });
  });

  // GET /api/v1/admin/spend-ledger-v231/replay?limit=N
  app.get('/api/v1/admin/spend-ledger-v231/replay', (req_231b, res_231b) => {
    if (!_ledger231) {
      return res_231b.status(503).json({ ok: false, error: 'spendLedgerPersistence231 not loaded', ecosVersion: 'V231' });
    }
    const limit_231 = parseInt(req_231b.query && req_231b.query.limit, 10) || 100;
    const entries_231 = _ledger231.replayLedger_231(limit_231);
    res_231b.json({ ok: true, entries: entries_231, count: entries_231.length, ecosVersion: 'V231' });
  });

  // POST /api/v1/admin/spend-ledger-v231/init
  app.post('/api/v1/admin/spend-ledger-v231/init', (req_231c, res_231c) => {
    if (!_ledger231) {
      return res_231c.status(503).json({ ok: false, error: 'spendLedgerPersistence231 not loaded', ecosVersion: 'V231' });
    }
    const filePath_231 = (req_231c.body && req_231c.body.filePath) || undefined;
    const result_231 = _ledger231.initLedger_231(filePath_231);
    res_231c.json({ ok: result_231.ok, ...result_231, ecosVersion: 'V231' });
  });

  // POST /api/v1/admin/spend-ledger-v231/compact
  app.post('/api/v1/admin/spend-ledger-v231/compact', (req_231d, res_231d) => {
    if (!_ledger231) {
      return res_231d.status(503).json({ ok: false, error: 'spendLedgerPersistence231 not loaded', ecosVersion: 'V231' });
    }
    try {
      _ledger231._compact_231();
      const status_231 = _ledger231.getLedgerStatus_231();
      res_231d.json({ ok: true, message: 'Compaction complete', ...status_231, ecosVersion: 'V231' });
    } catch (err_231) {
      res_231d.status(500).json({ ok: false, error: err_231.message, ecosVersion: 'V231' });
    }
  });

  // GET /api/v1/admin/spend-ledger-v231/rebuild
  app.get('/api/v1/admin/spend-ledger-v231/rebuild', (req_231e, res_231e) => {
    if (!_ledger231) {
      return res_231e.status(503).json({ ok: false, error: 'spendLedgerPersistence231 not loaded', ecosVersion: 'V231' });
    }
    const { ok, entryCount } = _ledger231.rebuildSpendMap_231();
    res_231e.json({ ok, entryCount, message: 'Spend map rebuilt from ledger (in-memory only)', ecosVersion: 'V231' });
  });

  // ── [P125-B] Multi-project spend dashboard ────────────────────────────────
  // GET /api/v1/admin/agent-loop-v230/spend/all
  app.get('/api/v1/admin/agent-loop-v230/spend/all', (req_231f, res_231f) => {
    if (!_agentLoop230Mod_231 || !_agentLoop230Mod_231._defaultSpendMap_230) {
      return res_231f.status(503).json({ ok: false, error: 'agentLoop230 not loaded', ecosVersion: 'V231' });
    }
    const spendMap_231 = _agentLoop230Mod_231._defaultSpendMap_230;
    const projects_231 = [];
    for (const [pid, micro] of spendMap_231.entries()) {
      projects_231.push({
        projectId:       pid,
        spentMicroCents: micro.toString(),
        spentUsd:        (Number(micro) / 10_000).toFixed(4),
        limitUsd:        _agentLoop230Mod_231.HITL_LIMIT_USD_230,
        hitlRequired:    micro >= _agentLoop230Mod_231.HITL_LIMIT_MICRO_230,
      });
    }
    // Sort by spentUsd descending
    projects_231.sort((a, b) => Number(b.spentMicroCents) - Number(a.spentMicroCents));
    res_231f.json({
      ok:        true,
      projects:  projects_231,
      total:     projects_231.length,
      sortedBy:  'totalSpentUsd_desc',
      ecosVersion: 'V231',
    });
  });

  // ── [P125-C] Webhook delivery log ─────────────────────────────────────────
  // POST /api/v1/admin/hitl-webhook-v231
  app.post('/api/v1/admin/hitl-webhook-v231', (req_231g, res_231g) => {
    const b_231 = req_231g.body || {};
    if (!b_231.url || typeof b_231.url !== 'string') {
      return res_231g.status(400).json({ ok: false, error: 'body.url is required', ecosVersion: 'V231' });
    }
    try { new URL(b_231.url); } catch (_) {
      return res_231g.status(400).json({ ok: false, error: 'body.url is not a valid URL', ecosVersion: 'V231' });
    }
    _webhookConfig_231.url           = b_231.url;
    _webhookConfig_231.secret        = b_231.secret || null;
    _webhookConfig_231.registeredAt  = new Date().toISOString();
    _webhookConfig_231.registeredBy  = b_231.registeredBy || 'system';
    res_231g.json({
      ok:          true,
      message:     'V231 webhook registered',
      hmacEnabled: !!_webhookConfig_231.secret,
      ecosVersion: 'V231',
    });
  });

  // GET /api/v1/admin/hitl-webhook-v231
  app.get('/api/v1/admin/hitl-webhook-v231', (req_231h, res_231h) => {
    res_231h.json({
      ok:          true,
      configured:  !!_webhookConfig_231.url,
      hmacEnabled: !!_webhookConfig_231.secret,
      registeredAt: _webhookConfig_231.registeredAt,
      registeredBy: _webhookConfig_231.registeredBy,
      fired:       _webhookFired_231,
      failed:      _webhookFailed_231,
      logCount:    _webhookLog_231.length,
      logMaxSize:  _WEBHOOK_LOG_MAX_231,
      ecosVersion: 'V231',
    });
  });

  // GET /api/v1/admin/hitl-webhook-v231/log
  app.get('/api/v1/admin/hitl-webhook-v231/log', (req_231i, res_231i) => {
    const limit_231 = Math.min(parseInt((req_231i.query && req_231i.query.limit) || 50, 10), _WEBHOOK_LOG_MAX_231);
    const log_231   = _webhookLog_231.slice(-limit_231);
    res_231i.json({
      ok:       true,
      log:      log_231,
      count:    log_231.length,
      total:    _webhookLog_231.length,
      maxSize:  _WEBHOOK_LOG_MAX_231,
      ecosVersion: 'V231',
    });
  });

  // ── [P125-D] Research prompt V231 ─────────────────────────────────────────
  // GET /api/v1/admin/research-prompt-v231
  app.get('/api/v1/admin/research-prompt-v231', (req_231j, res_231j) => {
    res_231j.json({
      ok:     true,
      prompt: _RESEARCH_PROMPT_V231,
      version: 'V231',
      ecosVersion: 'V231',
    });
  });

  // ── [P125-E] Navigator feature flags ──────────────────────────────────────
  // GET /api/v1/admin/feature-flags-v231
  app.get('/api/v1/admin/feature-flags-v231', (req_231k, res_231k) => {
    const flags_231 = {
      agentLoop230:        !!_agentLoop230Mod_231,
      tokenAccurateSpend:  !!_agentLoop230Mod_231,
      hmacWebhookV230:     true,   // registered in v230 patch
      hmacWebhookV231:     true,   // registered in this patch
      webhookDeliveryLog:  true,   // P125-C
      spendLedgerPersist:  !!_ledger231,  // P125-A
      multiProjectDash:    !!_agentLoop230Mod_231,  // P125-B
      rateHotReload:       true,   // V230 feature
      autoRefreshArtifacts: true,  // V230 feature (navigator + research tool)
      spendEstimator:      'token-accurate-v230',
    };
    res_231k.json({
      ok: true,
      version: 'V231',
      features: flags_231,
      detectedAt: new Date().toISOString(),
      ecosVersion: 'V231',
    });
  });

  // ── [P125-F] GET /api/v1/admin/summary/v231 ───────────────────────────────
  app.get('/api/v1/admin/summary/v231', (req_231l, res_231l) => {
    res_231l.json({
      ok:      true,
      version: 'V231',
      phase:   'P125',
      summary: 'Spend ledger persistence · Multi-project dashboard · Webhook delivery log · Research prompt V231 · Navigator feature badges',
      newEndpoints: [
        'GET  /api/v1/admin/spend-ledger-v231/status   — ledger file status',
        'GET  /api/v1/admin/spend-ledger-v231/replay   — last N entries (?limit=N)',
        'POST /api/v1/admin/spend-ledger-v231/init     — initialize ledger file',
        'POST /api/v1/admin/spend-ledger-v231/compact  — manual compaction',
        'GET  /api/v1/admin/spend-ledger-v231/rebuild  — rebuild spend map from ledger',
        'GET  /api/v1/admin/agent-loop-v230/spend/all  — all projects sorted by spend',
        'POST /api/v1/admin/hitl-webhook-v231          — register webhook (with log)',
        'GET  /api/v1/admin/hitl-webhook-v231          — webhook config + stats',
        'GET  /api/v1/admin/hitl-webhook-v231/log      — delivery log (ring buffer 100)',
        'GET  /api/v1/admin/research-prompt-v231        — V231 research prompt',
        'GET  /api/v1/admin/feature-flags-v231          — detected V231 features',
        'GET  /api/v1/admin/summary/v231                — this endpoint',
      ],
      newLibs: [
        'src/lib/spendLedgerPersistence231.js — append-only JSONL spend ledger (P125-A)',
      ],
      resolvedGaps: [
        'V230 gap-1: Spend ledger persistence (data/spend_ledger_231.jsonl)',
        'V230 gap-2: Multi-project dashboard (spend/all sorted by USD)',
        'V230 gap-3: Webhook delivery log ring buffer (100 entries)',
        'V230 gap-4: Research tool prompt updated to reference V231 state',
        'V230 gap-5: Navigator feature badge detection via /feature-flags-v231',
      ],
      ledgerStatus: _ledger231 ? _ledger231.getLedgerStatus_231() : null,
      webhookStats: {
        configured:  !!_webhookConfig_231.url,
        hmacEnabled: !!_webhookConfig_231.secret,
        fired:       _webhookFired_231,
        failed:      _webhookFailed_231,
        logCount:    _webhookLog_231.length,
      },
      ecosVersion: 'V231',
    });
  });

  // ── Polling for HITL events (mirrors V230 pattern) ───────────────────────
  if (eventLog_231) {
    setInterval(() => {
      if (!_webhookConfig_231.url || !eventLog_231) return;
      const pending_231 = eventLog_231.filter(e =>
        e && e.type === 'HITL_APPROVED' && !e._fired_v231
      );
      for (const ev_231 of pending_231) {
        ev_231._fired_v231 = true;
        _fireWebhook_231({ event: 'HITL_APPROVED_231', payload: ev_231 });
      }
    }, 5000).unref();
  }
}

module.exports = {
  registerV231Endpoints,
  _fireWebhook_231,
  _webhookConfig_231,
  _webhookLog_231,
  _signBody_231,
  _RESEARCH_PROMPT_V231,
  _WEBHOOK_LOG_MAX_231,
};
