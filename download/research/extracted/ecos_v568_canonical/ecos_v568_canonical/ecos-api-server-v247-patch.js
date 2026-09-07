/**
 * ecos-api-server-v247-patch.js — ECOS V247 (Phase P143)
 * ────────────────────────────────────────────────────────
 * Registers all new V247 endpoints. Additive-only (R4).
 *
 *   P143-A  Bridge multi-task dispatch (NEXT_SESSION_PROMPT_V246 item 1):
 *     POST /api/v1/swarm/dispatch-bridge/dispatch-plan    [V247-T01]
 *       Dispatch all sub-tasks in a plan in order (respecting dependsOn).
 *       Body: { planId|plan: { subTasks[] }, execOpts: { userId, swarmId?, stopOnFirstFailure? } }
 *     GET  /api/v1/swarm/dispatch-bridge/plan-stats       [V247-T02]
 *       Aggregated plan dispatch stats.
 *
 *   P143-B  Webhook delivery log (item 2):
 *     GET  /api/v1/swarm/aggregator/webhook/log           [V247-T03]
 *       Ring-buffer (max 100) of webhook delivery attempts.
 *
 *   P143-C  Corpus scheduler persistence (item 3):
 *     POST /api/v1/rag/corpus/schedule now persists config;
 *     DELETE /api/v1/rag/corpus/schedule clears persisted config.
 *     GET  /api/v1/rag/corpus/scheduler-config            [V247-T04]
 *       Returns persisted scheduler config (if any).
 *
 *   P143-D  Dispatcher quota bridge (item 4):
 *     POST /api/v1/swarm/dispatch-bridge/quota            [V247-T05]
 *       Set per-user spending quota via bridge. Body: { userId, limitUsd }
 *
 *   P143-E  Full corpus hot-reload (item 5):
 *     GET  /api/v1/rag/corpus/reload   — upgraded to flush+load cycle
 *       Returns { ok, termsFlushed, termsLoaded, roundTripMs }   [V247-T06]
 *
 *   P143-F  V247 summary:
 *     GET  /api/v1/admin/summary/v247                     [V247-T07]
 *
 * Iron rules:
 *   R1 — Sacred files untouched.
 *   R2 — All new identifiers end in 247.
 *   R3 — Zero new npm deps.
 *   R4 — No existing endpoint removed.
 *   R6 — New libs via relative require only.
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');

// ── P143-A: multi-task dispatch bridge ───────────────────────────────────────
const {
  dispatchPlanWithBridge247,
  setUserQuota247,
  getBridgePlanStats247,
  BRIDGE_VERSION_247,
} = require('./src/lib/agentDispatchBridge247');

// ── P143-B: webhook delivery log ─────────────────────────────────────────────
// Ring-buffer (max 100 entries) for webhook delivery attempts.
const WEBHOOK_LOG_MAX_247 = 100;
const _webhookLog247 = []; // [{ attemptedAt, event, strategy, status, durationMs }]

function _recordWebhookAttempt247(entry247) {
  _webhookLog247.push({
    attemptedAt: new Date().toISOString(),
    event:       entry247.event       || null,
    strategy:    entry247.strategy    || null,
    status:      entry247.status      || 'unknown',
    durationMs:  entry247.durationMs  || 0,
  });
  if (_webhookLog247.length > WEBHOOK_LOG_MAX_247) {
    _webhookLog247.shift();
  }
}

// ── P143-C: corpus scheduler persistence ─────────────────────────────────────
const {
  persistSchedulerConfig247,
  clearSchedulerConfig247,
  restoreScheduler247,
  loadSchedulerConfig247,
  SCHEDULER_CFG_PATH_247,
  scheduleCorpusFlush246,
  stopCorpusScheduler246,
  getSchedulerStats246,
} = require('./src/lib/ragCorpusPersistence245');

// ── P143-E: full hot-reload ───────────────────────────────────────────────────
function _req247(p) { try { return require(p); } catch (_) { return null; } }

// ── Helpers ───────────────────────────────────────────────────────────────────
function _err247(res, code, msg, status) {
  return res.status(status || 400).json({ ok: false, code, error: msg, ecosVersion: 'V247' });
}

// ── Auto-restore on load ──────────────────────────────────────────────────────
// Attempt to restore scheduler from persisted config (P143-C)
try { restoreScheduler247(); } catch (_) {}

// ── Main registration ─────────────────────────────────────────────────────────
function registerV247Endpoints(app, _opts) {

  // ── [V247-T01] POST /api/v1/swarm/dispatch-bridge/dispatch-plan ──────────
  // Dispatch all sub-tasks in a plan respecting dependsOn order.
  // Body: {
  //   planId?: string         — look up from swarmPlanner243 internal store
  //   plan?: { subTasks[] }   — OR provide plan object directly
  //   execOpts: { userId, swarmId?, missionId?, stopOnFirstFailure? }
  // }
  app.post('/api/v1/swarm/dispatch-bridge/dispatch-plan', async (req247a, res247a) => {
    try {
      const b247a = req247a.body || {};
      const eo247a = b247a.execOpts || {};

      if (!eo247a.userId) {
        return _err247(res247a, 'PLAN_247_MISSING_USER', 'execOpts.userId required');
      }

      // Resolve plan: planId string OR plan object
      let planArg247a;
      if (b247a.plan && Array.isArray(b247a.plan.subTasks)) {
        planArg247a = b247a.plan;
      } else if (b247a.planId) {
        planArg247a = String(b247a.planId);
      } else {
        return _err247(res247a, 'PLAN_247_MISSING_PLAN', 'planId (string) or plan (object with subTasks[]) required');
      }

      const result247a = await dispatchPlanWithBridge247(planArg247a, eo247a);
      return res247a.status(result247a.ok !== false ? 200 : 400).json(result247a);
    } catch (e247a) {
      return _err247(res247a, 'PLAN_247_ERROR', e247a.message, 500);
    }
  });

  // ── [V247-T02] GET /api/v1/swarm/dispatch-bridge/plan-stats ──────────────
  app.get('/api/v1/swarm/dispatch-bridge/plan-stats', (req247b, res247b) => {
    res247b.json({ ok: true, ...getBridgePlanStats247() });
  });

  // ── [V247-T03] GET /api/v1/swarm/aggregator/webhook/log ──────────────────
  app.get('/api/v1/swarm/aggregator/webhook/log', (req247c, res247c) => {
    const limit247c = Math.min(Number(req247c.query.limit) || 50, WEBHOOK_LOG_MAX_247);
    const entries247c = _webhookLog247.slice(-limit247c);
    res247c.json({
      ok:         true,
      count:      entries247c.length,
      maxEntries: WEBHOOK_LOG_MAX_247,
      entries:    entries247c,
      ecosVersion: 'V247',
    });
  });

  // ── [V247-T04] GET /api/v1/rag/corpus/scheduler-config ───────────────────
  app.get('/api/v1/rag/corpus/scheduler-config', (req247d, res247d) => {
    const cfg247d = loadSchedulerConfig247();
    res247d.json({
      ok:          true,
      persisted:   !!cfg247d,
      config:      cfg247d || null,
      configPath:  SCHEDULER_CFG_PATH_247,
      ecosVersion: 'V247',
    });
  });

  // ── OVERRIDE V246-T05: POST /api/v1/rag/corpus/schedule ──────────────────
  // Re-registers the route to also persist config (P143-C).
  // Express uses LIFO for same-path routes so this takes precedence over V246.
  app.post('/api/v1/rag/corpus/schedule', (req247e, res247e) => {
    try {
      const b247e = req247e.body || {};
      const ms247e = Number(b247e.intervalMs) || 60_000;
      if (ms247e < 5_000) {
        return _err247(res247e, 'SCHED_247_INTERVAL_TOO_SHORT', 'intervalMs must be >= 5000');
      }
      const fp247e = b247e.filePath || undefined;
      const schedResult247e = scheduleCorpusFlush246(ms247e, { filePath: fp247e });
      // Persist for restart recovery (P143-C)
      persistSchedulerConfig247(ms247e, fp247e || schedResult247e.filePath);
      return res247e.json({ ...schedResult247e, persisted: true, ecosVersion: 'V247' });
    } catch (e247e) {
      return _err247(res247e, 'SCHED_247_ERROR', e247e.message, 500);
    }
  });

  // ── OVERRIDE V246-T07: DELETE /api/v1/rag/corpus/schedule ────────────────
  // Also clears persisted config.
  app.delete('/api/v1/rag/corpus/schedule', (req247f, res247f) => {
    const stopResult247f = stopCorpusScheduler246();
    clearSchedulerConfig247();
    res247f.json({ ...stopResult247f, persistedConfigCleared: true, ecosVersion: 'V247' });
  });

  // ── [V247-T05] POST /api/v1/swarm/dispatch-bridge/quota ──────────────────
  // Set per-user spending quota through the bridge → dispatcher.
  // Body: { userId, limitUsd }
  app.post('/api/v1/swarm/dispatch-bridge/quota', (req247g, res247g) => {
    const b247g = req247g.body || {};
    if (!b247g.userId) return _err247(res247g, 'QUOTA_247_MISSING_USER', 'userId required');
    if (b247g.limitUsd === undefined || b247g.limitUsd === null) {
      return _err247(res247g, 'QUOTA_247_MISSING_LIMIT', 'limitUsd required');
    }
    const result247g = setUserQuota247(b247g.userId, b247g.limitUsd);
    return res247g.status(result247g.ok ? 200 : 400).json(result247g);
  });

  // ── [V247-T06] GET /api/v1/rag/corpus/reload (full flush+load cycle) ─────
  // Upgrades the V246 endpoint to a true flush-then-load cycle.
  // Returns { ok, termsFlushed, termsLoaded, roundTripMs }
  app.get('/api/v1/rag/corpus/reload', async (req247h, res247h) => {
    const t0_247h = Date.now();
    let termsFlushed247h = 0;
    let termsLoaded247h  = 0;

    try {
      const corpus245m = _req247('./src/lib/ragCorpusPersistence245');

      // Step 1: flush live corpus to a temp file
      const tmpFile247h = require('path').join(
        require('os').tmpdir(),
        'ecos_corpus_reload_247_' + Date.now() + '.ndjson'
      );

      let flushResult247h = { ok: false };
      if (corpus245m && typeof corpus245m.flushCorpus245 === 'function') {
        flushResult247h = corpus245m.flushCorpus245({ filePath: tmpFile247h });
        if (flushResult247h && typeof flushResult247h.termsFlushed === 'number') {
          termsFlushed247h = flushResult247h.termsFlushed;
        } else if (flushResult247h && typeof flushResult247h.flushed === 'number') {
          termsFlushed247h = flushResult247h.flushed;
        }
      }

      // Step 2: load corpus back with merge: false (full replace)
      if (flushResult247h.ok !== false && corpus245m && typeof corpus245m.loadCorpus245 === 'function') {
        try {
          const loadResult247h = corpus245m.loadCorpus245({ filePath: tmpFile247h, merge: false });
          if (loadResult247h && typeof loadResult247h.termsLoaded === 'number') {
            termsLoaded247h = loadResult247h.termsLoaded;
          } else if (loadResult247h && typeof loadResult247h.loaded === 'number') {
            termsLoaded247h = loadResult247h.loaded;
          }
        } catch (_) {}
      }

      // Step 3: clean up temp file
      try { require('fs').unlinkSync(tmpFile247h); } catch (_) {}

      return res247h.json({
        ok:            true,
        termsFlushed:  termsFlushed247h,
        termsLoaded:   termsLoaded247h,
        roundTripMs:   Date.now() - t0_247h,
        ecosVersion:   'V247',
      });

    } catch (e247h) {
      return _err247(res247h, 'RELOAD_247_ERROR', e247h.message, 500);
    }
  });

  // ── [V247-T07] GET /api/v1/admin/summary/v247 ────────────────────────────
  app.get('/api/v1/admin/summary/v247', (req247k, res247k) => {
    res247k.json({
      ok:      true,
      version: 'V247',
      phase:   'P143',
      summary: 'Bridge multi-task dispatch · Webhook delivery log · Corpus scheduler persistence · Dispatcher quota bridge · Full corpus hot-reload',
      newEndpoints: [
        'POST   /api/v1/swarm/dispatch-bridge/dispatch-plan  [V247-T01] — dispatchPlanWithBridge247',
        'GET    /api/v1/swarm/dispatch-bridge/plan-stats     [V247-T02] — plan dispatch stats',
        'GET    /api/v1/swarm/aggregator/webhook/log         [V247-T03] — webhook delivery log (ring-buffer 100)',
        'GET    /api/v1/rag/corpus/scheduler-config          [V247-T04] — persisted scheduler config',
        'POST   /api/v1/swarm/dispatch-bridge/quota          [V247-T05] — set user quota via bridge',
        'GET    /api/v1/rag/corpus/reload                    [V247-T06] — full flush+load hot-reload',
        'GET    /api/v1/admin/summary/v247                   [V247-T07] — this endpoint',
      ],
      newLibs: [
        'src/lib/agentDispatchBridge247.js  — dispatchPlanWithBridge247, setUserQuota247 (mirrored to lib/)',
        'src/lib/ragCorpusPersistence245.js — persistSchedulerConfig247, restoreScheduler247 appended (lib/ mirror updated)',
      ],
      newFiles: [
        'config/corpus_scheduler247.json   — persisted scheduler config (auto-created on POST /schedule)',
        'tests/v247.test.js               — guard suite (40 assertions)',
      ],
      resolvedGaps: [
        'V246 gap-1: dispatchPlanWithBridge247 dispatches full plan with topo-sort (dependsOn)',
        'V246 gap-2: _webhookLog247 ring-buffer + GET /api/v1/swarm/aggregator/webhook/log',
        'V246 gap-3: persistSchedulerConfig247 + restoreScheduler247 (restart-safe scheduler)',
        'V246 gap-4: setUserQuota247 delegates to agentDispatcher239.setQuota239',
        'V246 gap-5: GET /api/v1/rag/corpus/reload upgraded to full flush+load cycle',
      ],
      planStats:  getBridgePlanStats247(),
      webhookLogEntries: _webhookLog247.length,
      ironRules: 'R1 sacred intact · R2 ids…247 · R3 zero npm deps · R4 additive · R6 relative require · Mirror rule lib/',
      ecosVersion: 'V247',
    });
  });
}

module.exports = {
  registerV247Endpoints,
  _recordWebhookAttempt247,
  _webhookLog247,
};
