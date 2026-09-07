/**
 * ecos-api-server-v250-patch.js — ECOS V250 (Phase P146)
 * ────────────────────────────────────────────────────────
 * Registers all new V250 endpoints. Additive-only (R4).
 *
 *   P146-A  Auto-strategy dispatch (NEXT_SESSION_PROMPT_V249 item 3):
 *     POST /api/v1/swarm/dispatch-bridge/dispatch-and-aggregate-v250   [V250-T01]
 *       Resolves 'auto' strategy via autoSelectStrategy250.
 *       Body: { planId, execOpts?, strategy? }
 *       strategy may be 'auto' (default), 'concat', 'first', 'majority-vote'.
 *
 *   P146-B  Fallback quota registry (NEXT_SESSION_PROMPT_V249 item 2):
 *     POST /api/v1/swarm/dispatch-bridge/set-fallback-quota             [V250-T02]
 *       Registers an in-memory per-user spending limit consulted when getQuota239
 *       is unavailable. Closes withinBudget=null gap.
 *       Body: { userId, limitUsd }
 *     GET  /api/v1/swarm/dispatch-bridge/fallback-quotas                [V250-T03]
 *       Lists all registered fallback quotas.
 *
 *   P146-C  Filtered aggregate history (NEXT_SESSION_PROMPT_V249 item 4):
 *     GET /api/v1/swarm/dispatch-bridge/aggregate-history-v250          [V250-T04]
 *       Extends aggregate-history with ?planId=, ?strategy=, ?onlyFailed=true.
 *
 *   P146-D  Batch cost-guarded dispatch (NEXT_SESSION_PROMPT_V249 item 5):
 *     POST /api/v1/swarm/dispatch-bridge/batch-dispatch-guarded         [V250-T05]
 *       Runs an array of plans through dispatchPlanWithCostGuard249 in sequence.
 *       Body: { plans: Array<{planId, execOpts?, costOpts}>, continueOnReject?: boolean }
 *       HTTP 402 when any plan is over-budget (unless continueOnReject: true).
 *
 *   P146-E  Clear scheduler alerts (NEXT_SESSION_PROMPT_V249 known limitation):
 *     POST /api/v1/rag/corpus/scheduler-alerts/clear                    [V250-T06]
 *       Calls clearSchedulerAlerts250(); resets all accumulated callbacks.
 *
 *   P146-F  V250 summary:
 *     GET /api/v1/admin/summary/v250                                    [V250-T07]
 *
 * Iron rules:
 *   R1 — Sacred files untouched.
 *   R2 — All new identifiers end in 250.
 *   R3 — Zero new npm deps.
 *   R4 — No existing endpoint removed.
 *   R6 — New libs via relative require only.
 */

'use strict';

// ── P146-A/B/C/D: bridge250 ──────────────────────────────────────────────────
const {
  autoSelectStrategy250,
  setFallbackQuota250,
  listFallbackQuotas250,
  dispatchAndAggregatePlan250,
  getAggregateHistory250,
  batchDispatchGuarded250,
  getBridgeStats250,
  BRIDGE_VERSION_250,
} = require('./src/lib/agentDispatchBridge250');

// ── P146-E: clear scheduler alerts from ragCorpusPersistence245 ──────────────
const {
  clearSchedulerAlerts250,
  getSchedulerAlertState249,
} = require('./src/lib/ragCorpusPersistence245');

// ── Helpers ───────────────────────────────────────────────────────────────────
function _err250(res, code, msg, status) {
  return res.status(status || 400).json({ ok: false, code, error: msg, ecosVersion: BRIDGE_VERSION_250 });
}

// ── Main registration ─────────────────────────────────────────────────────────
function registerV250Endpoints(app, _opts) {

  // ── [V250-T01] POST /api/v1/swarm/dispatch-bridge/dispatch-and-aggregate-v250 ──
  // Dispatch + auto-select strategy. strategy='auto' (default) resolves via autoSelectStrategy250.
  // Body: { planId: string, execOpts?: object, strategy?: 'auto'|'concat'|'first'|'majority-vote' }
  app.post('/api/v1/swarm/dispatch-bridge/dispatch-and-aggregate-v250', async (req250a, res250a) => {
    try {
      const { planId: pid250a, execOpts: eo250a, strategy: strat250a } = req250a.body || {};
      if (!pid250a || String(pid250a).trim() === '') {
        return _err250(res250a, 'V250_T01_MISSING_PLAN_ID', 'planId required', 400);
      }
      const result250a = await dispatchAndAggregatePlan250(
        String(pid250a).trim(),
        eo250a || {},
        strat250a || 'auto',
      );
      const status250a = result250a.ok ? 200 : 422;
      return res250a.status(status250a).json(result250a);
    } catch (e250a) {
      return _err250(res250a, 'V250_T01_INTERNAL', e250a.message, 500);
    }
  });

  // ── [V250-T02] POST /api/v1/swarm/dispatch-bridge/set-fallback-quota ──────
  // Register an in-memory fallback quota for a user.
  // Body: { userId: string, limitUsd: number }
  app.post('/api/v1/swarm/dispatch-bridge/set-fallback-quota', (req250b, res250b) => {
    try {
      const { userId: uid250b, limitUsd: lim250b } = req250b.body || {};
      if (!uid250b || String(uid250b).trim() === '') {
        return _err250(res250b, 'V250_T02_MISSING_USER', 'userId required', 400);
      }
      if (lim250b === undefined || lim250b === null) {
        return _err250(res250b, 'V250_T02_MISSING_LIMIT', 'limitUsd required', 400);
      }
      const result250b = setFallbackQuota250(String(uid250b).trim(), Number(lim250b));
      const status250b = result250b.ok ? 200 : 400;
      return res250b.status(status250b).json(result250b);
    } catch (e250b) {
      return _err250(res250b, 'V250_T02_INTERNAL', e250b.message, 500);
    }
  });

  // ── [V250-T03] GET /api/v1/swarm/dispatch-bridge/fallback-quotas ──────────
  // List all registered fallback quotas.
  app.get('/api/v1/swarm/dispatch-bridge/fallback-quotas', (req250c, res250c) => {
    try {
      return res250c.status(200).json(listFallbackQuotas250());
    } catch (e250c) {
      return _err250(res250c, 'V250_T03_INTERNAL', e250c.message, 500);
    }
  });

  // ── [V250-T04] GET /api/v1/swarm/dispatch-bridge/aggregate-history-v250 ───
  // Filtered aggregate history. Query: ?planId=, ?strategy=, ?onlyFailed=true, ?limit=N
  app.get('/api/v1/swarm/dispatch-bridge/aggregate-history-v250', (req250d, res250d) => {
    try {
      const q250d = req250d.query || {};
      const result250d = getAggregateHistory250({
        planId:     q250d.planId     || null,
        strategy:   q250d.strategy   || null,
        onlyFailed: q250d.onlyFailed === 'true',
        limit:      q250d.limit      ? Number(q250d.limit) : 50,
      });
      return res250d.status(200).json(result250d);
    } catch (e250d) {
      return _err250(res250d, 'V250_T04_INTERNAL', e250d.message, 500);
    }
  });

  // ── [V250-T05] POST /api/v1/swarm/dispatch-bridge/batch-dispatch-guarded ──
  // Batch cost-guarded dispatch. Stops on first budget rejection unless continueOnReject: true.
  // Body: { plans: Array<{planId, execOpts?, costOpts}>, continueOnReject?: boolean }
  app.post('/api/v1/swarm/dispatch-bridge/batch-dispatch-guarded', async (req250e, res250e) => {
    try {
      const body250e = req250e.body || {};
      const { plans: plans250e, continueOnReject: cor250e } = body250e;
      if (!Array.isArray(plans250e) || plans250e.length === 0) {
        return _err250(res250e, 'V250_T05_MISSING_PLANS', 'plans must be a non-empty array', 400);
      }
      const result250e = await batchDispatchGuarded250(plans250e, { continueOnReject: cor250e === true });
      // Return HTTP 402 if any plan was rejected and we stopped early
      const status250e = result250e.stoppedAt !== null ? 402 : (result250e.ok ? 200 : 207);
      return res250e.status(status250e).json(result250e);
    } catch (e250e) {
      return _err250(res250e, 'V250_T05_INTERNAL', e250e.message, 500);
    }
  });

  // ── [V250-T06] POST /api/v1/rag/corpus/scheduler-alerts/clear ────────────
  // Clear all accumulated scheduler alert callbacks. Closes stale-callback accumulation.
  app.post('/api/v1/rag/corpus/scheduler-alerts/clear', (req250f, res250f) => {
    try {
      const result250f = clearSchedulerAlerts250();
      return res250f.status(200).json(result250f);
    } catch (e250f) {
      return _err250(res250f, 'V250_T06_INTERNAL', e250f.message, 500);
    }
  });

  // ── [V250-T07] GET /api/v1/admin/summary/v250 ────────────────────────────
  app.get('/api/v1/admin/summary/v250', (req250g, res250g) => {
    try {
      const alertState250g = (typeof getSchedulerAlertState249 === 'function')
        ? getSchedulerAlertState249()
        : null;
      return res250g.status(200).json({
        ok:               true,
        ecosVersion:      BRIDGE_VERSION_250,
        phase:            'P146',
        resolvedGaps: [
          'P146-1: Auto-strategy selection in dispatchAndAggregatePlan250',
          'P146-2: Fallback in-memory quota registry for cost-guard',
          'P146-3: Batch cost-guarded dispatch (batch-dispatch-guarded)',
          'P146-4: Filtered aggregate history (aggregate-history-v250)',
          'P146-5: clearSchedulerAlerts250 to prevent stale callback accumulation',
        ],
        newEndpoints: [
          'POST /api/v1/swarm/dispatch-bridge/dispatch-and-aggregate-v250 [V250-T01]',
          'POST /api/v1/swarm/dispatch-bridge/set-fallback-quota           [V250-T02]',
          'GET  /api/v1/swarm/dispatch-bridge/fallback-quotas              [V250-T03]',
          'GET  /api/v1/swarm/dispatch-bridge/aggregate-history-v250       [V250-T04]',
          'POST /api/v1/swarm/dispatch-bridge/batch-dispatch-guarded       [V250-T05]',
          'POST /api/v1/rag/corpus/scheduler-alerts/clear                  [V250-T06]',
          'GET  /api/v1/admin/summary/v250                                 [V250-T07]',
        ],
        newLibs: [
          'src/lib/agentDispatchBridge250.js (mirrored to lib/)',
        ],
        editedFiles: [
          'src/lib/ragCorpusPersistence245.js (clearSchedulerAlerts250 appended)',
          'lib/ragCorpusPersistence245.js (mirror updated)',
          'ecos-api-server.js (_wireV250Orchestration250 call appended)',
          'package.json (version 249.0.0 → 250.0.0)',
          'CLAUDE.md (version header updated)',
        ],
        bridgeStats250:    getBridgeStats250(),
        schedulerAlert249: alertState250g,
      });
    } catch (e250g) {
      return _err250(res250g, 'V250_T07_INTERNAL', e250g.message, 500);
    }
  });
}

module.exports = { registerV250Endpoints };
