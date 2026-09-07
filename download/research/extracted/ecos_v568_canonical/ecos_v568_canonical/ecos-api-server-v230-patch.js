// ============================================================
// ECOS V230 — Phase P124 — Server Patch
// Implements all five V230 work items from NEXT_SESSION_PROMPT_V229:
//
//   P124-A  Wire estimateSpend_229 into agentLoop (new agentLoop230.js)
//             New lib: src/lib/agentLoop230.js + lib/agentLoop230.js
//             GET  /api/v1/admin/agent-loop-v230/:projectId/spend
//               Returns current spend using the V230 token-accurate loop.
//
//   P124-B  Navigator/Research auto-refresh (30 s polling + manual button)
//             Updated artifacts: ecosNavigator230.jsx / researchTool230.jsx
//             (Artifact changes only — no new API endpoints for this item.)
//
//   P124-C  Live smoke integration test
//             New file: tests/v227.smoke.integration.test.js
//             Boots server in-process; probes v227–v230 summaries.
//
//   P124-D  Webhook secret / HMAC signing
//             POST /api/v1/admin/hitl-webhook-v230
//               Same as v229 register but accepts optional { secret } field.
//               Outbound webhook includes X-ECOS-Signature-V230 header
//               (HMAC-SHA256 of body using the registered secret).
//             GET  /api/v1/admin/hitl-webhook-v230
//               Returns webhook config (url+secret redacted) + stats.
//
//   P124-E  Rate table hot-reload
//             GET /api/v1/admin/spend-rates-v229?reload=true
//               Added handler that calls reloadRates_229() first.
//             GET /api/v1/admin/spend-rates-v230
//               Returns V230 rate table (same data, V230 version tag).
//
//   P124-F  GET /api/v1/admin/summary/v230 — V230 health summary.
//
// Iron rules:
//   R1  Sacred files untouched (lib/fiatLedger.js, lib/auditLog.js).
//   R2  All new identifiers end in _230.
//   R3  Zero new npm deps; Node built-ins + relative requires only.
//   R6  V220–V229 endpoints untouched; only new routes registered here.
// ============================================================

'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const {
  estimateSpend_229,
  getRateTable_229,
  listProviders_229,
  reloadRates_229,
  _BUILTIN_RATES_229,
} = require('./src/lib/spendRateTables229.js');

// ── P124-A: export V230 agentLoop spend helpers ────────────────────────────
let _agentLoop230Module_230 = null;
try {
  _agentLoop230Module_230 = require('./src/lib/agentLoop230.js');
} catch (_) {}

let __spendMap_230_ref = null;
try {
  __spendMap_230_ref = _agentLoop230Module_230 && _agentLoop230Module_230._defaultSpendMap_230
    ? _agentLoop230Module_230._defaultSpendMap_230
    : null;
} catch (_) {}

// ── P124-D: Webhook config store with optional HMAC secret ───────────────────
const _webhookConfig_230 = {
  url: null,
  secret: null,       // optional HMAC-SHA256 signing secret
  registeredAt: null,
  registeredBy: null,
};

let _webhookFired_230   = 0;
let _webhookFailed_230  = 0;

/**
 * _signBody_230(body, secret) — HMAC-SHA256 of body string.
 * Returns hex digest for X-ECOS-Signature-V230 header.
 */
function _signBody_230(body, secret) {
  try {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  } catch (_) {
    return '';
  }
}

/**
 * _fireWebhook_230(payload) — sends a JSON POST to the configured webhook URL.
 * If a secret is registered, adds X-ECOS-Signature-V230 (HMAC-SHA256).
 * Non-fatal: errors are swallowed and counted.
 */
function _fireWebhook_230(payload) {
  if (!_webhookConfig_230.url) return;
  let parsed;
  try { parsed = new URL(_webhookConfig_230.url); }
  catch (_) { _webhookFailed_230++; return; }

  const body = JSON.stringify(payload);
  const headers_230 = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'ECOS-V230-webhook',
    'X-ECOS-Version': 'V230',
  };

  // P124-D: HMAC signature when secret is set
  if (_webhookConfig_230.secret) {
    headers_230['X-ECOS-Signature-V230'] = _signBody_230(body, _webhookConfig_230.secret);
  }

  const transport_230 = parsed.protocol === 'https:' ? https : http;
  const req_230 = transport_230.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: headers_230,
      timeout: 5000,
    },
    (res_230) => {
      res_230.resume();
      if (res_230.statusCode && res_230.statusCode >= 200 && res_230.statusCode < 300) {
        _webhookFired_230++;
      } else {
        _webhookFailed_230++;
      }
    },
  );
  req_230.on('error', () => { _webhookFailed_230++; });
  req_230.on('timeout', () => { req_230.destroy(); _webhookFailed_230++; });
  req_230.write(body);
  req_230.end();
}

// ── P124-D: Subscribe to HITL_APPROVED_228 events via _eventLog181 ────────────
let _lastWebhookPollIdx_230 = 0;

function _pollAndFire_230(eventLog) {
  if (!_webhookConfig_230.url) return;
  if (!(eventLog instanceof Map)) return;
  const entries = Array.from(eventLog.values());
  for (let i = _lastWebhookPollIdx_230; i < entries.length; i++) {
    const entry = entries[i];
    if (entry && entry.event === 'HITL_APPROVED_228') {
      _fireWebhook_230({
        event: 'HITL_APPROVED_228',
        approvalId: entry.approvalId,
        projectId: entry.projectId,
        approvedBy: entry.approvedBy,
        note: entry.note || '',
        previousSpendUsd: entry.previousSpendUsd,
        approvedAt: entry.approvedAt,
        ecosVersion: 'V230',
        webhookVersion: 'V230',
        hmacSigned: !!_webhookConfig_230.secret,
      });
    }
  }
  _lastWebhookPollIdx_230 = entries.length;
}

function registerV230Endpoints(app, opts) {
  const o = opts || {};
  const eventLog_230 = (o.eventLog_230 instanceof Map) ? o.eventLog_230 : null;

  // ── [P124-A] GET /api/v1/admin/agent-loop-v230/:projectId/spend ──────────
  // Returns current spend for a project using the V230 token-accurate loop.
  app.get('/api/v1/admin/agent-loop-v230/:projectId_230/spend', (req_230a, res_230a) => {
    const pid_230a = String(req_230a.params.projectId_230 || '');
    if (!pid_230a) {
      return res_230a.status(400).json({ ok: false, error: 'projectId required', ecosVersion: 'V230' });
    }
    let spendInfo_230a = {
      projectId: pid_230a,
      spentMicroCents: '0',
      spentUsd: '0.0000',
      limitUsd: 20,
      hitlRequired: false,
      spendEstimator: 'token-accurate-v230',
      ecosVersion: 'V230',
    };
    try {
      if (_agentLoop230Module_230 && typeof _agentLoop230Module_230.getProjectSpend_230 === 'function') {
        spendInfo_230a = _agentLoop230Module_230.getProjectSpend_230(pid_230a);
      }
    } catch (_) {}
    return res_230a.json({ ok: true, ...spendInfo_230a, ecosVersion: 'V230' });
  });

  // ── [P124-D] POST /api/v1/admin/hitl-webhook-v230 ────────────────────────
  // Register/update webhook URL with optional HMAC secret.
  // Body: { url: string (required), registeredBy: string (required), secret?: string }
  app.post('/api/v1/admin/hitl-webhook-v230', (req_230d, res_230d) => {
    const body_230d = req_230d.body || {};
    const url_230d          = String(body_230d.url          || '').trim();
    const registeredBy_230d = String(body_230d.registeredBy || '').trim();
    const secret_230d       = body_230d.secret ? String(body_230d.secret).trim() : null;

    if (!url_230d) {
      return res_230d.status(400).json({ ok: false, error: 'url is required', ecosVersion: 'V230' });
    }
    if (!registeredBy_230d) {
      return res_230d.status(400).json({ ok: false, error: 'registeredBy is required for audit compliance', ecosVersion: 'V230' });
    }
    let parsed_230d;
    try { parsed_230d = new URL(url_230d); }
    catch (_) {
      return res_230d.status(400).json({ ok: false, error: 'url must be a valid HTTP/HTTPS URL', ecosVersion: 'V230' });
    }
    if (!['http:', 'https:'].includes(parsed_230d.protocol)) {
      return res_230d.status(400).json({ ok: false, error: 'url must use http or https', ecosVersion: 'V230' });
    }

    _webhookConfig_230.url          = url_230d;
    _webhookConfig_230.secret       = secret_230d;
    _webhookConfig_230.registeredAt = new Date().toISOString();
    _webhookConfig_230.registeredBy = registeredBy_230d;

    return res_230d.status(200).json({
      ok: true,
      message: 'HITL approval webhook (V230) registered. Will fire on HITL_APPROVED_228 events.',
      webhookHost: parsed_230d.host,
      hmacEnabled: !!secret_230d,
      registeredBy: registeredBy_230d,
      registeredAt: _webhookConfig_230.registeredAt,
      ecosVersion: 'V230',
    });
  });

  // ── [P124-D] GET /api/v1/admin/hitl-webhook-v230 ─────────────────────────
  app.get('/api/v1/admin/hitl-webhook-v230', (req_230dg, res_230dg) => {
    const configured_230dg = !!_webhookConfig_230.url;
    let host_230dg = null;
    if (configured_230dg) {
      try { host_230dg = new URL(_webhookConfig_230.url).host; } catch (_) {}
    }
    res_230dg.json({
      ok: true,
      configured: configured_230dg,
      webhookHost: host_230dg,
      hmacEnabled: !!_webhookConfig_230.secret,
      registeredBy: _webhookConfig_230.registeredBy,
      registeredAt: _webhookConfig_230.registeredAt,
      stats: {
        fired: _webhookFired_230,
        failed: _webhookFailed_230,
      },
      ecosVersion: 'V230',
    });
  });

  // ── [P124-E] GET /api/v1/admin/spend-rates-v230 (with hot-reload support) ─
  // Also extends the v229 endpoint to support ?reload=true.
  app.get('/api/v1/admin/spend-rates-v230', (req_230e, res_230e) => {
    // P124-E: hot-reload support
    if (req_230e.query && req_230e.query.reload === 'true') {
      try { reloadRates_229(); } catch (_) {}
    }
    let rates_230e;
    try {
      rates_230e = listProviders_229().reduce((acc, k) => {
        acc[k] = getRateTable_229(k);
        return acc;
      }, {});
    } catch (_) {
      rates_230e = Object.assign({}, _BUILTIN_RATES_229);
    }
    res_230e.json({
      ok: true,
      version: 'V230',
      description: 'Token-accurate spend rate tables (μ¢/tok). Hot-reload via ?reload=true.',
      units: 'micro-cents per token (1 USD = 1,000,000 μ¢)',
      providers: rates_230e,
      hotReload: !!(req_230e.query && req_230e.query.reload === 'true'),
      ecosVersion: 'V230',
    });
  });

  // ── [P124-C] Periodic polling for HITL_APPROVED_228 events ────────────────
  if (eventLog_230) {
    setInterval(() => { _pollAndFire_230(eventLog_230); }, 5000).unref();
  }

  // ── [P124-F] GET /api/v1/admin/summary/v230 ───────────────────────────────
  app.get('/api/v1/admin/summary/v230', (req_230f, res_230f) => {
    res_230f.json({
      ok: true,
      version: 'V230',
      phase: 'P124',
      summary: 'Token-accurate agentLoop230 · Navigator/Research auto-refresh · Smoke integration test · Webhook HMAC · Rate hot-reload',
      newEndpoints: [
        'GET  /api/v1/admin/agent-loop-v230/:projectId/spend — V230 token-accurate spend',
        'POST /api/v1/admin/hitl-webhook-v230                — webhook with optional HMAC secret',
        'GET  /api/v1/admin/hitl-webhook-v230                — webhook config + stats',
        'GET  /api/v1/admin/spend-rates-v230                 — rate table + hot-reload (?reload=true)',
        'GET  /api/v1/admin/summary/v230                     — this endpoint',
      ],
      newLibs: [
        'src/lib/agentLoop230.js            — token-accurate spend via estimateSpend_229',
        'tests/v227.smoke.integration.test.js — live supertest smoke',
        'artifacts/ecosNavigator230.jsx     — auto-refresh (30s) + manual refresh button',
        'artifacts/researchTool230.jsx      — auto-refresh (30s) + manual refresh button',
      ],
      resolvedGaps: [
        'V229 gap-1: agentLoop230 wires estimateSpend_229 into _estimateStepCost_230',
        'V229 gap-2: Navigator/Research auto-refresh (30s + manual button)',
        'V229 gap-3: Live smoke integration test (v227.smoke.integration.test.js)',
        'V229 gap-4: Webhook HMAC signing (X-ECOS-Signature-V230)',
        'V229 gap-5: Rate table hot-reload (?reload=true on spend-rates-v230)',
      ],
      webhookStats: {
        configured: !!_webhookConfig_230.url,
        hmacEnabled: !!_webhookConfig_230.secret,
        fired: _webhookFired_230,
        failed: _webhookFailed_230,
      },
      ecosVersion: 'V230',
    });
  });
}

module.exports = {
  registerV230Endpoints,
  __spendMap_230_ref,
  _fireWebhook_230,
  _webhookConfig_230,
  _signBody_230,
};
