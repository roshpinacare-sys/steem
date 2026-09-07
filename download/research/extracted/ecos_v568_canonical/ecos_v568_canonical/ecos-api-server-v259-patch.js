/**
 * ecos-api-server-v259-patch.js — ECOS V259 (Phase P155)
 * P155: HITL Reject endpoint + Dashboard V2 API improvements
 *
 * New endpoints:
 *   POST /api/v1/automations/:runId/reject         [V259-T01] — reject/cancel HITL-paused run
 *   GET  /api/v1/automations/hitl-queue            [V259-T02] — list all hitl_paused runs
 *   GET  /api/v1/admin/summary/v259                [V259-T03] — V259 summary
 *
 * Rules: R1 sacred, R2 suffix259, R3 no new npm, R4 no removed endpoints, R6 lib/ mirror.
 * @version 259.0.0
 */
'use strict';

// ── Shared in-memory rejected-runs store (cleared per process) ────────────────
const _rejectedRuns259 = new Map();   // runId → { runId, automationId, rejectedAt, reason, userId }

/**
 * rejectHitlRun259(opts) — Mark a HITL-paused run as rejected (operator-side cancel).
 * Does NOT re-execute; simply records the rejection and emits WS push if hub provided.
 *
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} [opts.automationId]
 * @param {string} [opts.reason]
 * @param {string} [opts.userId]
 * @param {object} [opts.missionPersistence] - { resumeMission241, appendMissionStep241 }
 * @param {object} [opts.notificationWsHub]
 * @param {object} [opts.logger]
 * @returns {{ ok: boolean, runId: string, status: 'rejected', rejectedAt: string }}
 */
function rejectHitlRun259(opts) {
  const {
    runId, automationId = null, reason = 'operator_reject',
    userId = '__system__', missionPersistence = null,
    notificationWsHub = null, logger = null,
  } = opts || {};

  if (!runId || typeof runId !== 'string') {
    throw new TypeError('rejectHitlRun259: runId must be a non-empty string');
  }

  const rejectedAt = new Date().toISOString();

  // Record in-memory (persisted best-effort via missionPersistence)
  _rejectedRuns259.set(runId, { runId, automationId, rejectedAt, reason, userId, status: 'rejected' });

  // Best-effort: append a 'rejected' step to mission log
  if (missionPersistence && typeof missionPersistence.appendMissionStep241 === 'function') {
    try {
      missionPersistence.appendMissionStep241({
        runId, step: -1, toolName: '__hitl_reject__',
        args: { reason, userId }, result: null, status: 'rejected',
      });
    } catch (_) { /* non-fatal */ }
  }

  // Best-effort: WS push to operator dashboard
  // ── P155 WS push ──────────────────────────────────────────────────────────
  if (notificationWsHub && typeof notificationWsHub.push === 'function') {
    try {
      notificationWsHub.push(userId, {
        id:          'hitl_reject_' + runId,
        type:        'hitl_rejected',
        runId,
        automationId,
        rejectedAt,
        reason,
        ecosVersion: 'V259',
      });
    } catch (_rejPushErr259) { /* non-fatal — WS failure must never break reject */ }
  }

  try { if (logger) logger.info({ runId, reason }, '[V259] HITL run rejected'); } catch (_) {}

  return { ok: true, runId, status: 'rejected', rejectedAt, reason, ecosVersion: 'V259' };
}

/**
 * listHitlQueue259(missionPersistence) — Return all runs currently in hitl_paused state.
 * Merges in-memory rejected map so callers can see both paused and just-rejected entries.
 *
 * @param {object} [missionPersistence] - { listMissions241 }
 * @returns {Array<object>}
 */
function listHitlQueue259(missionPersistence) {
  const paused259 = [];
  if (missionPersistence && typeof missionPersistence.listMissions241 === 'function') {
    try {
      const all241 = missionPersistence.listMissions241();
      for (const m of all241) {
        const hasHitl = Array.isArray(m.steps) && m.steps.some(s => s.status === 'hitl_paused');
        const hasRejected = _rejectedRuns259.has(m.runId);
        if (hasHitl && !hasRejected) {
          const pausedStep = m.steps.findIndex(s => s.status === 'hitl_paused');
          paused259.push({
            runId:        m.runId,
            automationId: m.automationId || null,
            pausedAtStep: pausedStep,
            toolName:     m.steps[pausedStep] ? m.steps[pausedStep].toolName : null,
            recordedAt:   m.steps[pausedStep] ? m.steps[pausedStep].recordedAt : null,
            status:       'hitl_paused',
          });
        }
      }
    } catch (_) {}
  }
  return paused259;
}

/**
 * registerV259Endpoints(app, deps) — Mount V259 REST endpoints on the Express app.
 *
 * @param {object} app   - Express app
 * @param {object} deps  - { catalog255, toolCatalog237, logger, notificationWsHub }
 */
function registerV259Endpoints(app, deps) {
  const {
    catalog255       = null,
    toolCatalog237   = null,
    logger           = console,
    notificationWsHub = null,
  } = deps || {};

  function _log259(level, msg, meta) {
    try { if (logger && typeof logger[level] === 'function') logger[level](meta || {}, msg); }
    catch (_) {}
  }
  function _writeLine259(obj) {
    try { process.stdout.write(JSON.stringify({ ...obj, ecosVersion: 'V259' }) + '\n'); } catch (_) {}
  }

  // Lazy-load missionPersistence at request time so V259 patch is usable
  // even if missionPersistence241 is registered after this patch is loaded.
  function _mp259() {
    try { return require('./lib/missionPersistence241.js'); } catch (_) { return null; }
  }

  // ── [V259-T01] POST /api/v1/automations/:runId/reject ────────────────────
  // Rejects (cancels) a HITL-paused run without re-executing it.
  app.post('/api/v1/automations/:runId/reject', async (req, res) => {
    const runId259   = (req.params.runId || '').trim();
    const reason259  = (req.body && req.body.reason) ? String(req.body.reason) : 'operator_reject';
    const userId259  = (req.body && req.body.userId) ? String(req.body.userId) : '__system__';
    const autoId259  = (req.body && req.body.automationId) ? String(req.body.automationId) : null;

    if (!runId259) {
      return res.status(400).json({ ok: false, error: 'runId is required', code: 'MISSING_RUN_ID', ecosVersion: 'V259' });
    }

    // Verify run exists and is in hitl_paused state (best-effort, non-blocking if mp unavailable)
    const mp259 = _mp259();
    if (mp259) {
      let savedRun259 = null;
      try { savedRun259 = mp259.resumeMission241(runId259); } catch (_) {}
      if (!savedRun259) {
        return res.status(404).json({ ok: false, error: 'run not found', code: 'RUN_NOT_FOUND', runId: runId259, ecosVersion: 'V259' });
      }
      const isPaused259 = Array.isArray(savedRun259.steps) && savedRun259.steps.some(s => s.status === 'hitl_paused');
      if (!isPaused259) {
        return res.status(409).json({ ok: false, error: 'run is not in hitl_paused state', code: 'NOT_PAUSED', runId: runId259, ecosVersion: 'V259' });
      }
    }

    try {
      const result259 = rejectHitlRun259({
        runId: runId259, automationId: autoId259, reason: reason259,
        userId: userId259, missionPersistence: mp259,
        notificationWsHub, logger,
      });
      _writeLine259({ type: 'hitl_reject', runId: runId259, reason: reason259, userId: userId259 });
      return res.json(result259);
    } catch (e259) {
      _log259('warn', '[V259] reject error', { err: e259.message, runId: runId259 });
      return res.status(500).json({ ok: false, error: e259.message, runId: runId259, ecosVersion: 'V259' });
    }
  });

  // ── [V259-T02] GET /api/v1/automations/hitl-queue ────────────────────────
  // Returns the list of currently HITL-paused runs awaiting human approval.
  app.get('/api/v1/automations/hitl-queue', (req, res) => {
    try {
      const queue259 = listHitlQueue259(_mp259());
      return res.json({ ok: true, count: queue259.length, queue: queue259, ecosVersion: 'V259' });
    } catch (e259) {
      _log259('warn', '[V259] hitl-queue error', { err: e259.message });
      return res.status(500).json({ ok: false, error: e259.message, ecosVersion: 'V259' });
    }
  });

  // ── [V259-T03] GET /api/v1/admin/summary/v259 ────────────────────────────
  app.get('/api/v1/admin/summary/v259', (req, res) => {
    res.json({
      ok:           true,
      version:      '259.0.0',
      phase:        'P155',
      features: [
        'POST /api/v1/automations/:runId/reject — reject HITL-paused run [V259-T01]',
        'GET  /api/v1/automations/hitl-queue   — list paused runs [V259-T02]',
        'artifacts/automationDashboard258.jsx  — Dashboard V2 with HITL action panel',
      ],
      rejectedRunsInMemory: _rejectedRuns259.size,
      ecosVersion:  'V259',
    });
  });

  _log259('info', '[V259] endpoints registered (T01–T03)', { phase: 'P155' });
}

module.exports = {
  registerV259Endpoints,
  rejectHitlRun259,
  listHitlQueue259,
  _rejectedRuns259,   // exported for tests
};
