/**
 * ecos-api-server-v257-patch.js — ECOS V257 (Phase P153)
 * ─────────────────────────────────────────────────────────
 * Automation Dashboard + Persistent Scheduler State + Full Cron Expressions
 *
 *   P153-A  automationDashboard257.jsx (React artifact — artifacts/ directory)
 *
 *   P153-B  Persistent Scheduler State:
 *     POST /api/v1/admin/scheduler257/start     [V257-T01] — start scheduler257 (auto-restores state)
 *     POST /api/v1/admin/scheduler257/stop      [V257-T02] — stop + persist
 *     GET  /api/v1/admin/scheduler257/status    [V257-T03] — scheduler257 status + entries
 *
 *   P153-C  Full Cron Expression Support:
 *     POST /api/v1/admin/cron257/parse          [V257-T04] — parse + validate cron expression
 *     POST /api/v1/admin/cron257/next           [V257-T05] — next N fire times
 *
 *   P153-D  V257 admin summary:
 *     GET  /api/v1/admin/summary/v257           [V257-T06]
 *
 * Iron rules:
 *   R1 — Sacred files untouched.
 *   R2 — All new identifiers end in 257.
 *   R3 — Zero new npm deps.
 *   R4 — No existing endpoint removed.
 *   R6 — New libs via relative require only.
 */

'use strict';

const { createAutomationScheduler257 } = require('./lib/automationScheduler257.js');
const { parseCronExpression257, nextCronFireMs257 } = require('./lib/cronParser257.js');
const { triggerIntake255 } = require('./lib/automationRunner255.js');

/**
 * @param {import('express').Application} app
 * @param {object} deps  — { catalog255, toolCatalog237, logger, snapshotEngine? }
 */
function registerV257Endpoints(app, deps = {}) {
  const { catalog255, toolCatalog237, logger, snapshotEngine } = deps;

  const _log257 = (level, msg, data) => {
    try { if (logger && typeof logger[level] === 'function') logger[level](data || {}, msg); } catch (_) {}
  };

  // Lazy singleton scheduler257 (created on first /start call)
  let _scheduler257 = null;
  function _getScheduler257() {
    if (!_scheduler257 && catalog255 && toolCatalog237) {
      _scheduler257 = createAutomationScheduler257({
        catalog254:       catalog255,
        toolCatalog237,
        triggerIntake255,
        snapshotEngine:   snapshotEngine || null,
        audit: (ev) => _log257('info', '[V257] scheduler event', ev),
      });
    }
    return _scheduler257;
  }

  // ── [V257-T01] POST /api/v1/admin/scheduler257/start ─────────────────────
  // Start scheduler257 (auto-restores persisted state via snapshotEngine).
  app.post('/api/v1/admin/scheduler257/start', (req, res) => {
    if (!catalog255)
      return res.status(503).json({ ok: false, error: 'catalog not available', ecosVersion: 'V257' });
    try {
      const sched = _getScheduler257();
      if (!sched)
        return res.status(503).json({ ok: false, error: 'scheduler unavailable', ecosVersion: 'V257' });
      const result = sched.start257();
      _log257('info', '[V257] scheduler257 started', result);
      res.json({ ok: true, ...result, ecosVersion: 'V257' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, code: e.code || 'ERROR', ecosVersion: 'V257' });
    }
  });

  // ── [V257-T02] POST /api/v1/admin/scheduler257/stop ──────────────────────
  app.post('/api/v1/admin/scheduler257/stop', (req, res) => {
    try {
      const sched = _getScheduler257();
      if (!sched)
        return res.json({ ok: true, message: 'scheduler not initialized', ecosVersion: 'V257' });
      const result = sched.stop257();
      _log257('info', '[V257] scheduler257 stopped', result);
      res.json({ ok: true, ...result, ecosVersion: 'V257' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V257' });
    }
  });

  // ── [V257-T03] GET /api/v1/admin/scheduler257/status ─────────────────────
  app.get('/api/v1/admin/scheduler257/status', (req, res) => {
    try {
      const sched = _getScheduler257();
      const stats = sched
        ? sched.stats257()
        : { running: false, scheduled: 0, entries: [] };
      res.json({ ok: true, ...stats, ecosVersion: 'V257' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V257' });
    }
  });

  // ── [V257-T04] POST /api/v1/admin/cron257/parse ──────────────────────────
  // Parse + validate a cron expression.
  // Body: { expr: "0 9 * * 1-5" }
  app.post('/api/v1/admin/cron257/parse', (req, res) => {
    const expr257 = req.body && typeof req.body.expr === 'string' ? req.body.expr.trim() : '';
    if (!expr257) {
      return res.status(400).json({ ok: false, error: 'expr required in body', code: 'MISSING_EXPR', ecosVersion: 'V257' });
    }

    const parsed257 = parseCronExpression257(expr257);
    if (!parsed257.ok) {
      return res.status(422).json({ ok: false, expr: expr257, error: parsed257.error, code: 'PARSE_ERROR', ecosVersion: 'V257' });
    }

    // Serialize Sets to sorted arrays for the response
    const fields257 = {};
    for (const [k, v] of Object.entries(parsed257.fields)) {
      fields257[k] = [...v].sort((a, b) => a - b);
    }

    const nextMs257 = nextCronFireMs257(expr257);
    res.json({
      ok:      true,
      expr:    expr257,
      fields:  fields257,
      nextFireMs:  nextMs257,
      nextFireIso: nextMs257 != null ? new Date(Date.now() + nextMs257).toISOString() : null,
      ecosVersion: 'V257',
    });
  });

  // ── [V257-T05] POST /api/v1/admin/cron257/next ───────────────────────────
  // List next N fire times for a cron expression.
  // Body: { expr: "*/15 * * * *", count?: 5 }
  app.post('/api/v1/admin/cron257/next', (req, res) => {
    const expr257  = req.body && typeof req.body.expr  === 'string' ? req.body.expr.trim() : '';
    const count257 = Math.min(Math.max(parseInt((req.body && req.body.count) || '5', 10), 1), 20);

    if (!expr257) {
      return res.status(400).json({ ok: false, error: 'expr required in body', code: 'MISSING_EXPR', ecosVersion: 'V257' });
    }

    const parsed257 = parseCronExpression257(expr257);
    if (!parsed257.ok) {
      return res.status(422).json({ ok: false, expr: expr257, error: parsed257.error, ecosVersion: 'V257' });
    }

    const now257   = new Date();
    const fires257 = [];
    let   cursor257 = new Date(now257);

    for (let i = 0; i < count257; i++) {
      const ms = nextCronFireMs257(expr257, cursor257);
      if (ms == null) break;
      const fireDate = new Date(cursor257.getTime() + ms);
      fires257.push({ ms, iso: fireDate.toISOString() });
      cursor257 = fireDate;
    }

    res.json({ ok: true, expr: expr257, count: fires257.length, fires: fires257, ecosVersion: 'V257' });
  });

  // ── [V257-T06] GET /api/v1/admin/summary/v257 ────────────────────────────
  app.get('/api/v1/admin/summary/v257', (req, res) => {
    const sched257    = _getScheduler257();
    const schedStats  = sched257 ? sched257.stats257() : { running: false, scheduled: 0 };
    res.json({
      ok:          true,
      version:     'V257',
      phase:       'P153',
      features: [
        'automation-dashboard-react',
        'persistent-scheduler-state',
        'full-cron-expressions',
        'cron-parser-api',
      ],
      description:   'P153-A: React dashboard; P153-B: persistent scheduler; P153-C: 5-field cron',
      schedulerStats: schedStats,
      snapshotBackedPersistence: !!(snapshotEngine),
      ecosVersion: 'V257',
    });
  });

  _log257('info', '[V257] endpoints registered', {
    endpoints: [
      'POST /api/v1/admin/scheduler257/start',
      'POST /api/v1/admin/scheduler257/stop',
      'GET  /api/v1/admin/scheduler257/status',
      'POST /api/v1/admin/cron257/parse',
      'POST /api/v1/admin/cron257/next',
      'GET  /api/v1/admin/summary/v257',
    ],
  });
}

module.exports = { registerV257Endpoints };
