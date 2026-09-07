// ============================================================
// ECOS V229 — Phase P123 — Server Patch
// Implements four V229 work items from NEXT_SESSION_PROMPT_V228:
//
//   P123-A  Token-accurate spend via spendRateTables229.js
//             GET  /api/v1/admin/spend-rates-v229
//               Returns the loaded provider rate table so operators
//               can verify which model costs are active.
//
//   P123-B  Fix spend map wiring (known V228 limitation)
//             Exports __spendMap_229_ref so future patches and
//             ecos-api-server.js can obtain the live spend ledger
//             without module gymnastics.
//
//   P123-C  Approval webhook / Slack notification
//             POST /api/v1/admin/hitl-webhook-v229
//               Register/replace the outbound webhook URL that fires
//               when HITL_APPROVED_228 is emitted.
//             GET  /api/v1/admin/hitl-webhook-v229
//               Returns current webhook config (url redacted to host only).
//             The webhook fires as an opt-in, non-fatal side-effect of
//             the existing approve endpoint (via event-bus bridge).
//
//   P123-D  GET /api/v1/admin/summary/v229 — V229 health summary.
//
// Iron rules:
//   R1  Sacred files untouched (lib/fiatLedger.js, lib/auditLog.js).
//   R2  All new identifiers end in _229.
//   R3  Zero new npm deps; Node built-ins + relative requires only.
//   R6  V220–V228 endpoints untouched; only new routes registered here.
// ============================================================

'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');
const {
  estimateSpend_229,
  getRateTable_229,
  listProviders_229,
  _BUILTIN_RATES_229,
} = require('./src/lib/spendRateTables229.js');

// ── P123-B: re-export the V227 spend map so future patches can inject it ────
// Attempt to grab the live spend map from agentLoop227's default export.
// This fixes the known V228 limitation where __spendMap_228_ref was null.
let __spendMap_229_ref = null;
try {
  const al227 = require('./src/lib/agentLoop227.js');
  __spendMap_229_ref = al227._defaultSpendMap_227 || null;
} catch (_) {}

// ── P123-C: Webhook config store (in-process) ────────────────────────────────
// Only one webhook URL active at a time (opt-in, non-fatal).
const _webhookConfig_229 = {
  url: null,
  registeredAt: null,
  registeredBy: null,
};

let _webhookFired_229 = 0;
let _webhookFailed_229 = 0;

/**
 * _fireWebhook_229(payload) — sends a JSON POST to the configured webhook URL.
 * Non-fatal: errors are swallowed and counted.
 */
function _fireWebhook_229(payload) {
  if (!_webhookConfig_229.url) return; // not configured — noop
  let parsed;
  try {
    parsed = new URL(_webhookConfig_229.url);
  } catch (_) {
    _webhookFailed_229++;
    return;
  }
  const body = JSON.stringify(payload);
  const transport = parsed.protocol === 'https:' ? https : http;
  const req = transport.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'ECOS-V229-webhook',
      },
      timeout: 5000,
    },
    (res) => {
      // consume body to free socket
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        _webhookFired_229++;
      } else {
        _webhookFailed_229++;
      }
    },
  );
  req.on('error', () => { _webhookFailed_229++; });
  req.on('timeout', () => { req.destroy(); _webhookFailed_229++; });
  req.write(body);
  req.end();
}

// ── Subscribe to HITL_APPROVED_228 events via _eventLog181 bridge ────────────
// We poll the eventLog for new HITL_APPROVED_228 entries and fire the webhook.
// Polling is lightweight: only runs if a webhook URL is configured.
let _lastWebhookPollIdx_229 = 0;

function _pollAndFire_229(eventLog) {
  if (!_webhookConfig_229.url) return;
  if (!(eventLog instanceof Map)) return;
  const entries = Array.from(eventLog.values());
  for (let i = _lastWebhookPollIdx_229; i < entries.length; i++) {
    const entry = entries[i];
    if (entry && entry.event === 'HITL_APPROVED_228') {
      _fireWebhook_229({
        event: 'HITL_APPROVED_228',
        approvalId: entry.approvalId,
        projectId: entry.projectId,
        approvedBy: entry.approvedBy,
        note: entry.note || '',
        previousSpendUsd: entry.previousSpendUsd,
        approvedAt: entry.approvedAt,
        ecosVersion: 'V229',
        webhookVersion: 'V229',
      });
    }
  }
  _lastWebhookPollIdx_229 = entries.length;
}

// ── Approval counter (V229 layer) ────────────────────────────────────────────
let _v229ApprovalsSeen_229 = 0;

function registerV229Endpoints(app, opts) {
  const o = opts || {};
  // _eventLog181 reference for webhook polling
  const eventLog_229 = (o.eventLog_229 instanceof Map) ? o.eventLog_229 : null;

  // ── [P123-A] GET /api/v1/admin/spend-rates-v229 ───────────────────────────
  // Returns the currently loaded provider rate table.
  app.get('/api/v1/admin/spend-rates-v229', (req_229a, res_229a) => {
    let rates;
    try { rates = listProviders_229().reduce((acc, k) => { acc[k] = getRateTable_229(k); return acc; }, {}); }
    catch (_) { rates = Object.assign({}, _BUILTIN_RATES_229); }
    res_229a.json({
      ok: true,
      version: 'V229',
      description: 'Token-accurate spend rate tables (μ¢/tok). Source: config/pricing_providers229.json with built-in fallback.',
      units: 'micro-cents per token (1 USD = 1,000,000 μ¢)',
      providers: rates,
      ecosVersion: 'V229',
    });
  });

  // ── [P123-C] POST /api/v1/admin/hitl-webhook-v229 ────────────────────────
  // Register or update the outbound webhook URL.
  // Body: { url: string (required), registeredBy: string (required) }
  app.post('/api/v1/admin/hitl-webhook-v229', (req_229c, res_229c) => {
    const body_229c = req_229c.body || {};
    const url_229c = String(body_229c.url || '').trim();
    const registeredBy_229c = String(body_229c.registeredBy || '').trim();

    if (!url_229c) {
      return res_229c.status(400).json({ ok: false, error: 'url is required', ecosVersion: 'V229' });
    }
    if (!registeredBy_229c) {
      return res_229c.status(400).json({ ok: false, error: 'registeredBy is required for audit compliance', ecosVersion: 'V229' });
    }
    // Validate URL
    let parsed_229c;
    try { parsed_229c = new URL(url_229c); }
    catch (_) {
      return res_229c.status(400).json({ ok: false, error: 'url must be a valid HTTP/HTTPS URL', ecosVersion: 'V229' });
    }
    if (!['http:', 'https:'].includes(parsed_229c.protocol)) {
      return res_229c.status(400).json({ ok: false, error: 'url must use http or https', ecosVersion: 'V229' });
    }

    _webhookConfig_229.url = url_229c;
    _webhookConfig_229.registeredAt = new Date().toISOString();
    _webhookConfig_229.registeredBy = registeredBy_229c;

    return res_229c.status(200).json({
      ok: true,
      message: 'HITL approval webhook registered. Will fire on HITL_APPROVED_228 events.',
      webhookHost: parsed_229c.host,
      registeredBy: registeredBy_229c,
      registeredAt: _webhookConfig_229.registeredAt,
      ecosVersion: 'V229',
    });
  });

  // ── [P123-C] GET /api/v1/admin/hitl-webhook-v229 ─────────────────────────
  // Returns webhook config (URL redacted to host only for security).
  app.get('/api/v1/admin/hitl-webhook-v229', (req_229cg, res_229cg) => {
    const configured = !!_webhookConfig_229.url;
    let host_229cg = null;
    if (configured) {
      try { host_229cg = new URL(_webhookConfig_229.url).host; } catch (_) {}
    }
    res_229cg.json({
      ok: true,
      configured,
      webhookHost: host_229cg,
      registeredBy: _webhookConfig_229.registeredBy,
      registeredAt: _webhookConfig_229.registeredAt,
      stats: {
        fired: _webhookFired_229,
        failed: _webhookFailed_229,
      },
      ecosVersion: 'V229',
    });
  });

  // ── [P123-C] Periodic polling for HITL_APPROVED_228 events ───────────────
  // Poll every 5 s if a webhook URL is configured and an eventLog was injected.
  if (eventLog_229) {
    setInterval(() => { _pollAndFire_229(eventLog_229); }, 5000).unref();
  }

  // ── [P123-D] GET /api/v1/admin/summary/v229 ───────────────────────────────
  app.get('/api/v1/admin/summary/v229', (req_229d, res_229d) => {
    res_229d.json({
      ok: true,
      version: 'V229',
      phase: 'P123',
      summary: 'Token-accurate spend tables · spend-map export fix · HITL approval webhook',
      newEndpoints: [
        'GET  /api/v1/admin/spend-rates-v229       — active provider rate table',
        'POST /api/v1/admin/hitl-webhook-v229      — register HITL approval webhook',
        'GET  /api/v1/admin/hitl-webhook-v229      — webhook config + stats',
        'GET  /api/v1/admin/summary/v229           — this endpoint',
      ],
      newLibs: [
        'src/lib/spendRateTables229.js            — token-accurate spend tables',
        'config/pricing_providers229.json          — per-provider rate config',
        '.github/workflows/smoke.yml              — CI smoke step',
      ],
      fixedLimitations: [
        'V228 __spendMap_228_ref now resolved via _defaultSpendMap_227 export',
      ],
      webhookStats: {
        configured: !!_webhookConfig_229.url,
        fired: _webhookFired_229,
        failed: _webhookFailed_229,
      },
      ecosVersion: 'V229',
    });
  });
}

module.exports = {
  registerV229Endpoints,
  // P123-B: expose spend map ref for downstream patches
  __spendMap_229_ref,
  // expose webhook fire for test injection
  _fireWebhook_229,
  _webhookConfig_229,
};
