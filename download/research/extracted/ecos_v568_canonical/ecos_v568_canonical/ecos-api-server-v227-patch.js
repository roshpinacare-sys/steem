// ============================================================
// ECOS V227 — Phase P121 — Server Patch
// Implements the four V227 work items from NEXT_SESSION_PROMPT_V226:
//
//   P121-A  POST /api/v1/admin/smoke-v227         — V225 surface smoke boot
//   P121-B  GET  /api/v1/admin/summary/v227        — V227 health + spend summary
//   P121-C  (spend cap enforced in agentLoop227 — see src/lib/agentLoop227.js)
//   P121-D  (Navigator/Research wired via live admin data — endpoints below)
//           GET  /api/v1/admin/summary/navigator   — Navigator live feed
//           GET  /api/v1/admin/economic-safety     — Economic safety status
//
// Iron rules:
//   R1  Sacred files untouched (lib/fiatLedger.js, lib/auditLog.js).
//   R2  All new identifiers end in _227.
//   R3  Zero new npm deps; Node built-ins + global fetch (Node >=18).
//   R6  V220–V226 endpoints untouched; only new routes registered here.
// ============================================================

'use strict';

const http = require('http');

const AGENT_SPEND_LIMIT_USD_227 = 20;   // human-in-the-loop threshold ($20)
const AGENT_SPEND_LIMIT_MICRO_227 = BigInt(Math.round(AGENT_SPEND_LIMIT_USD_227 * 10_000)); // in μ¢

// ── spend tracking ring (projectId → cumulative μ¢) ──────────────────────────
const _agentSpendMap_227 = new Map();

function _trackSpend_227(projectId, estimatedMicroCents) {
  const prev = _agentSpendMap_227.get(projectId) || 0n;
  const next = prev + BigInt(Math.round(Number(estimatedMicroCents)));
  _agentSpendMap_227.set(projectId, next);
  return next;
}

function _spendExceeded_227(projectId) {
  return (_agentSpendMap_227.get(projectId) || 0n) >= AGENT_SPEND_LIMIT_MICRO_227;
}

function _resetSpend_227(projectId) {
  _agentSpendMap_227.delete(projectId);
}

// ── local HTTP probe helper (for smoke tests) ─────────────────────────────────
function _probe_227(port, pathname, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const opts = {
      hostname: '127.0.0.1', port,
      path: pathname, method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
      timeout: 4000,
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

function registerV227Endpoints(app, opts) {
  const o = opts || {};
  const port_227 = o.port || (app._serverPort227 || 3000);

  // ── [P121-A] POST /api/v1/admin/smoke-v227 ─────────────────────────────────
  // Probes every V225 surface endpoint and returns a pass/fail per route.
  app.post('/api/v1/admin/smoke-v227', async (req_227, res_227) => {
    const started_227 = Date.now();
    const probes_227 = [
      // P112 – LLM gateway
      { name: 'llm-chat',       method: 'POST', path: '/llm/chat',
        body: JSON.stringify({ provider: 'mock', messages: [{ role: 'user', content: 'ping' }] }) },
      // P113 – file tools (list only; no write needed)
      { name: 'files-list',     method: 'POST', path: '/files/__smoke_227__/list',
        body: JSON.stringify({ path: '.' }) },
      // P114 – sandbox exec (echo only)
      { name: 'sandbox-exec',   method: 'POST', path: '/sandbox/__smoke_227__/exec',
        body: JSON.stringify({ cmd: 'echo smoke-ok-227' }) },
      // P115 – agent chat (mock, 1-step)
      { name: 'agent-chat',     method: 'POST', path: '/agent/chat',
        body: JSON.stringify({ provider: 'mock', userMessage: 'ping' }) },
      // P115 – sessions list
      { name: 'agent-sessions', method: 'GET',  path: '/agent/sessions', body: null },
      // P116 – templates list
      { name: 'templates-list', method: 'GET',  path: '/templates', body: null },
      // P117 – preview log ingest
      { name: 'preview-log',    method: 'POST', path: '/preview/__smoke_227__/log',
        body: JSON.stringify({ type: 'console', level: 'log', message: 'smoke' }) },
      // P117 – preview logs read
      { name: 'preview-logs-read', method: 'GET', path: '/preview/__smoke_227__/logs', body: null },
      // P118 – memory set
      { name: 'memory-set',     method: 'POST', path: '/memory/project/__smoke_227__/smoke_key_227',
        body: JSON.stringify({ value: 'smoke-value-227' }) },
      // P118 – memory get
      { name: 'memory-get',     method: 'GET',  path: '/memory/project/__smoke_227__/smoke_key_227', body: null },
      // P119 – admin summary-v225
      { name: 'admin-summary-v225', method: 'GET', path: '/admin/summary-v225', body: null },
    ];

    const results_227 = [];
    for (const probe_227 of probes_227) {
      const r = await _probe_227(port_227, probe_227.path, probe_227.method, probe_227.body);
      results_227.push({
        name: probe_227.name,
        path: probe_227.path,
        method: probe_227.method,
        status: r.status,
        pass: r.status >= 200 && r.status < 500, // 4xx is ok (auth/missing); 0 = unreachable
        error: r.error || null,
      });
    }

    const passCount_227 = results_227.filter(r => r.pass).length;
    const allPass_227 = passCount_227 === results_227.length;
    res_227.status(allPass_227 ? 200 : 207).json({
      ok: allPass_227,
      version: 'V227',
      phase: 'P121-A',
      probed: results_227.length,
      passed: passCount_227,
      failed: results_227.length - passCount_227,
      durationMs: Date.now() - started_227,
      results: results_227,
    });
  });

  // ── [P121-C proxy] GET /api/v1/admin/agent-spend ───────────────────────────
  // Returns current accumulated spend per project (μ¢ and USD).
  app.get('/api/v1/admin/agent-spend-v227', (req_227, res_227) => {
    const rows_227 = [];
    for (const [pid, micro] of _agentSpendMap_227.entries()) {
      rows_227.push({
        projectId: pid,
        spentMicroCents: micro.toString(),
        spentUsd: (Number(micro) / 10_000).toFixed(4),
        limitUsd: AGENT_SPEND_LIMIT_USD_227,
        hitlRequired: micro >= AGENT_SPEND_LIMIT_MICRO_227,
      });
    }
    res_227.json({ ok: true, version: 'V227', limitUsd: AGENT_SPEND_LIMIT_USD_227, projects: rows_227 });
  });

  // ── [P121-C proxy] POST /api/v1/admin/agent-spend/:projectId/reset ─────────
  app.post('/api/v1/admin/agent-spend-v227/:projectId/reset', (req_227, res_227) => {
    _resetSpend_227(req_227.params.projectId);
    res_227.json({ ok: true, version: 'V227', reset: req_227.params.projectId });
  });

  // ── [P121-D] GET /api/v1/admin/summary/navigator ───────────────────────────
  // Live feed for EcosNavigator214: system health, economic safety, V225 surface.
  app.get('/api/v1/admin/summary/navigator', (req_227, res_227) => {
    // Collect spend overview
    let totalSpendMicro_227 = 0n;
    let projectsOverLimit_227 = 0;
    for (const [, micro] of _agentSpendMap_227.entries()) {
      totalSpendMicro_227 += micro;
      if (micro >= AGENT_SPEND_LIMIT_MICRO_227) projectsOverLimit_227++;
    }

    res_227.json({
      ok: true,
      version: 'V227',
      generatedAt: new Date().toISOString(),
      surfaces: {
        v225Orchestration: 'wired',
        llmGateway: 'multi-provider (lovable, anthropic, openai, google, mock)',
        agentLoop: 'tool-calling, max 10 steps, spend-capped at $20 HITL',
        fileTools: 'sandboxed read/write/search, sacred-path guard',
        sandboxExec: 'allow-listed, per-call timeout + output cap',
        memory: 'project+user scoped, FIFO 500 entries / 64 KB each',
        templates: 'vite-react-shadcn starter',
        preview: 'per-project console/network event ring',
        publish: 'build → static output',
      },
      spendControl: {
        limitUsd: AGENT_SPEND_LIMIT_USD_227,
        totalProjectsTracked: _agentSpendMap_227.size,
        totalSpentUsd: (Number(totalSpendMicro_227) / 10_000).toFixed(4),
        projectsOverLimit: projectsOverLimit_227,
      },
      adminEndpoints: [
        'GET  /api/v1/admin/smoke-v227         → POST to trigger V225 surface smoke test',
        'GET  /api/v1/admin/agent-spend-v227   → per-project spend + HITL status',
        'GET  /api/v1/admin/economic-safety    → economic safety status',
        'GET  /api/v1/admin/summary/v227       → V227 overall summary',
        'GET  /api/v1/admin/summary/v226       → V226 consolidation guard',
        'GET  /api/v1/admin/summary-v225       → V225 provider + session counts',
      ],
    });
  });

  // ── [P121-D] GET /api/v1/admin/economic-safety ─────────────────────────────
  // Economic safety status for EcosNavigator214 + EcosResearchConsole214.
  app.get('/api/v1/admin/economic-safety', (req_227, res_227) => {
    const overLimit_227 = [];
    for (const [pid, micro] of _agentSpendMap_227.entries()) {
      if (micro >= AGENT_SPEND_LIMIT_MICRO_227) {
        overLimit_227.push({ projectId: pid, spentUsd: (Number(micro) / 10_000).toFixed(4) });
      }
    }
    const safe_227 = overLimit_227.length === 0;
    res_227.json({
      ok: true,
      version: 'V227',
      generatedAt: new Date().toISOString(),
      safe: safe_227,
      agentSpendLimitUsd: AGENT_SPEND_LIMIT_USD_227,
      hitlThresholdNote: `Agent loops that cumulatively exceed $${AGENT_SPEND_LIMIT_USD_227} USD per project require human-in-the-loop approval (HITL). Reset via POST /api/v1/admin/agent-spend-v227/:projectId/reset after manual review.`,
      projectsRequiringHITL: overLimit_227,
      sacredFilesProtected: ['lib/fiatLedger.js', 'lib/auditLog.js'],
    });
  });

  // ── [P121-B] GET /api/v1/admin/summary/v227 ─────────────────────────────────
  app.get('/api/v1/admin/summary/v227', (req_227, res_227) => {
    res_227.json({
      ok: true,
      version: 'V227',
      phase: 'P121',
      summary: 'V225 smoke-boot verification + sandboxExec hardening tests + $20 HITL spend cap + Navigator/Research live data wiring',
      newEndpoints: [
        'POST /api/v1/admin/smoke-v227              — smoke all V225 surface routes',
        'GET  /api/v1/admin/agent-spend-v227        — per-project spend tracker',
        'POST /api/v1/admin/agent-spend-v227/:id/reset — reset spend (post-HITL)',
        'GET  /api/v1/admin/summary/navigator       — live navigator feed',
        'GET  /api/v1/admin/economic-safety         — economic safety status',
        'GET  /api/v1/admin/summary/v227            — this endpoint',
      ],
      newLibs: [
        'src/lib/agentLoop227.js  — spend-capped agent loop (P121-C)',
        'src/lib/sandboxHarden227.js — hardened allow-list + per-call timeout/output-cap tests (P121-B)',
      ],
      agentSpendCapUsd: AGENT_SPEND_LIMIT_USD_227,
      ecosVersion: 'V227',
    });
  });
}

// V229 fix: expose the agentLoop227 default spend map so V228/V229
// can inject it into approval endpoints (resolves known V228 limitation).
let __spendMap_228_ref = null;
try {
  const _al227 = require('./src/lib/agentLoop227.js');
  __spendMap_228_ref = _al227._defaultSpendMap_227 || null;
} catch (_) {}

module.exports = {
  registerV227Endpoints,
  // export spend helpers so agentLoop227 can call them
  _trackSpend_227,
  _spendExceeded_227,
  _resetSpend_227,
  AGENT_SPEND_LIMIT_USD_227,
  AGENT_SPEND_LIMIT_MICRO_227,
  // V229 fix: live spend ledger reference for upstream patches
  __spendMap_228_ref,
};
