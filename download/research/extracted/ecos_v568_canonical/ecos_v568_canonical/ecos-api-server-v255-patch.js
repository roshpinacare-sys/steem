/**
 * ecos-api-server-v255-patch.js — ECOS V255 (Phase P151)
 * ────────────────────────────────────────────────────────
 * Automation execution — closes the loop on automationCatalog254.
 * Each registered recipe can now be RUN via a single POST.
 *
 *   P151-A  Run an automation (core feature):
 *     POST /api/v1/automations/:id/run                           [V255-T01]
 *       Runs the named automation, streams progress via ndjson.
 *       Body: { ctx?: object }
 *       Response: ndjson stream of progress events, closed with a final summary line.
 *
 *   P151-B  Trigger intake:
 *     POST /api/v1/automations/trigger-intake                    [V255-T02]
 *       Fire all automations whose trigger matches the incoming type.
 *       Body: { triggerType: 'schedule'|'webhook'|'event', ctx?: object }
 *
 *   P151-C  V255 admin summary:
 *     GET  /api/v1/admin/summary/v255                            [V255-T03]
 *
 * Iron rules:
 *   R1 — Sacred files untouched.
 *   R2 — All new identifiers end in 255.
 *   R3 — Zero new npm deps.
 *   R4 — No existing endpoint removed.
 *   R6 — New libs via relative require only.
 */

'use strict';

const { runAutomation255, triggerIntake255 } = require('./lib/automationRunner255.js');

/**
 * @param {import('express').Application} app
 * @param {object} deps  — { catalog255, toolCatalog237, logger }
 */
function registerV255Endpoints(app, deps = {}) {
  const { catalog255, toolCatalog237, logger } = deps;

  const _log255 = (level, msg, data) => {
    try { if (logger && typeof logger[level] === 'function') logger[level](data || {}, msg); } catch (_) {}
  };

  // ── [V255-T01] POST /api/v1/automations/:id/run ───────────────────────────
  // Streams ndjson progress. Each line is a JSON event; last line is the summary.
  app.post('/api/v1/automations/:id/run', async (req, res) => {
    const id = req.params.id;
    const ctx = (req.body && typeof req.body.ctx === 'object') ? req.body.ctx : {};

    if (!catalog255) {
      return res.status(503).json({ ok: false, error: 'automation catalog not available', code: 'NO_CATALOG', ecosVersion: 'V255' });
    }

    // Start ndjson stream
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('X-ECOS-Version', 'V255');

    const _writeLine255 = (obj) => {
      try { res.write(JSON.stringify(obj) + '\n'); } catch (_) {}
    };

    const auditFn255 = (ev) => _log255('info', '[V255] automation run event', ev);

    try {
      const result255 = await runAutomation255({
        catalog:     catalog255,
        toolCatalog: toolCatalog237,
        automationId: id,
        ctx,
        onProgress: _writeLine255,
        audit:      auditFn255,
      });
      // Final summary line
      _writeLine255({ type: 'summary', ok: true, ...result255, ecosVersion: 'V255' });
    } catch (e255) {
      _log255('warn', '[V255] run error', { err: e255.message, id });
      _writeLine255({ type: 'summary', ok: false, error: e255.message, code: e255.code || 'RUN_ERROR', ecosVersion: 'V255' });
    }

    res.end();
  });

  // ── [V255-T02] POST /api/v1/automations/trigger-intake ────────────────────
  app.post('/api/v1/automations/trigger-intake', async (req, res) => {
    const { triggerType, ctx = {} } = req.body || {};

    if (!catalog255) {
      return res.status(503).json({ ok: false, error: 'automation catalog not available', code: 'NO_CATALOG', ecosVersion: 'V255' });
    }
    if (!['schedule', 'webhook', 'event'].includes(triggerType)) {
      return res.status(400).json({ ok: false, error: 'triggerType must be schedule | webhook | event', code: 'BAD_TRIGGER', ecosVersion: 'V255' });
    }

    try {
      const results = await triggerIntake255({
        catalog:     catalog255,
        toolCatalog: toolCatalog237,
        triggerType,
        ctx,
        audit: (ev) => _log255('info', '[V255] trigger-intake event', ev),
      });
      res.json({ ok: true, triggerType, results, ecosVersion: 'V255' });
    } catch (e) {
      _log255('warn', '[V255] trigger-intake error', { err: e.message });
      res.status(500).json({ ok: false, error: e.message, code: e.code || 'ERROR', ecosVersion: 'V255' });
    }
  });

  // ── [V255-T03] GET /api/v1/admin/summary/v255 ─────────────────────────────
  app.get('/api/v1/admin/summary/v255', (req, res) => {
    const catalogStats = (catalog255 && typeof catalog255.stats === 'function') ? catalog255.stats() : null;
    res.json({
      ok:      true,
      version: 'V255',
      phase:   'P151',
      feature: 'automation-execution',
      description: 'runAutomation255: executes recipes step-by-step with V240 interlock + silent-failure guard',
      catalogStats,
      ecosVersion: 'V255',
    });
  });

  _log255('info', '[V255] endpoints registered', { endpoints: ['/api/v1/automations/:id/run', '/api/v1/automations/trigger-intake', '/api/v1/admin/summary/v255'] });
}

module.exports = { registerV255Endpoints };
