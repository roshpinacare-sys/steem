/**
 * ecos-api-server-v243-patch.js — ECOS V243 (Phase P139)
 * ────────────────────────────────────────────────────────
 * Registers the new V243 endpoints on top of V242 without touching any
 * existing routes (R4 additive-only).
 *
 *   P139-A  RAG Pipeline endpoints:
 *     POST /api/v1/rag/ingest          [V243-T01]
 *     POST /api/v1/rag/query           [V243-T02]
 *     GET  /api/v1/rag/stats           [V243-T03]
 *
 *   P139-B  Swarm Planner endpoint:
 *     POST /api/v1/swarm/plan          [V243-T04]
 *     GET  /api/v1/swarm/plan/:planId  [V243-T05]
 *     GET  /api/v1/swarm/plans         [V243-T06]
 *
 *   P139-C  Phase summary:
 *     GET  /api/v1/admin/summary/v243  [V243-T07]
 *
 * R1 — Sacred files untouched.
 * R2 — All new identifiers end in 243.
 * R3 — Zero new npm deps (Node built-ins + relative requires only).
 * R6 — New libs via relative require only.
 */

'use strict';

const { defaultRagPipeline243, RAG_DEFAULT_TOPK_243, RAG_MAX_TOPK_243 } =
  require('./src/lib/ragPipeline243');
const {
  planSwarm243, getPlan243, listPlans243, getPlannerStats243,
  PLANNER_MAX_SUBTASKS_243,
} = require('./src/lib/swarmPlanner243');

function _err243(res, code, msg, httpStatus) {
  return res.status(httpStatus || 400).json({ ok: false, code, error: msg, ecosVersion: 'V243' });
}

function registerV243Endpoints(app, _opts) {
  // ── [V243-T01] POST /api/v1/rag/ingest ─────────────────────────────────────
  app.post('/api/v1/rag/ingest', async (req243a, res243a) => {
    try {
      const { text, meta, chunkSize, overlap } = req243a.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        return _err243(res243a, 'RAG_TEXT_REQUIRED', 'text field required (non-empty string)');
      }
      const result = await defaultRagPipeline243.ingestDocument243(
        text, meta || {}, { chunkSize, overlap }
      );
      return res243a.status(201).json({
        ok: true, ...result, ecosVersion: 'V243',
      });
    } catch (e243a) {
      return _err243(res243a, 'RAG_INGEST_ERROR', e243a.message, 500);
    }
  });

  // ── [V243-T02] POST /api/v1/rag/query ──────────────────────────────────────
  app.post('/api/v1/rag/query', (req243b, res243b) => {
    try {
      const { query, topK, metaFilter, augment } = req243b.body || {};
      if (!query || typeof query !== 'string' || !query.trim()) {
        return _err243(res243b, 'RAG_QUERY_REQUIRED', 'query field required (non-empty string)');
      }
      const k = Math.max(1, Math.min(topK || RAG_DEFAULT_TOPK_243, RAG_MAX_TOPK_243));
      if (augment) {
        const aug = defaultRagPipeline243.augmentPrompt243(query, k, metaFilter);
        return res243b.json({ ok: true, ...aug, topK: k, ecosVersion: 'V243' });
      }
      const chunks = defaultRagPipeline243.retrieveContext243(query, k, metaFilter);
      return res243b.json({ ok: true, query, results: chunks, topK: k, ecosVersion: 'V243' });
    } catch (e243b) {
      return _err243(res243b, 'RAG_QUERY_ERROR', e243b.message, 500);
    }
  });

  // ── [V243-T03] GET /api/v1/rag/stats ───────────────────────────────────────
  app.get('/api/v1/rag/stats', (req243c, res243c) => {
    res243c.json({
      ok: true,
      stats: defaultRagPipeline243.getStats243(),
      ecosVersion: 'V243',
    });
  });

  // ── [V243-T04] POST /api/v1/swarm/plan ─────────────────────────────────────
  app.post('/api/v1/swarm/plan', async (req243d, res243d) => {
    try {
      const { goal, userId, maxSubTasks, skipToolDiscovery } = req243d.body || {};
      if (!goal || typeof goal !== 'string' || !goal.trim()) {
        return _err243(res243d, 'SWARM_PLAN_GOAL_REQUIRED', 'goal field required (non-empty string)');
      }
      if (maxSubTasks !== undefined && (typeof maxSubTasks !== 'number' || maxSubTasks < 1 || maxSubTasks > PLANNER_MAX_SUBTASKS_243)) {
        return _err243(res243d, 'SWARM_PLAN_BAD_MAX', `maxSubTasks must be 1–${PLANNER_MAX_SUBTASKS_243}`);
      }
      const plan = await planSwarm243(goal, { userId, maxSubTasks, skipToolDiscovery });
      return res243d.status(201).json({ ok: true, ...plan, ecosVersion: 'V243' });
    } catch (e243d) {
      return _err243(res243d, 'SWARM_PLAN_ERROR', e243d.message, 500);
    }
  });

  // ── [V243-T05] GET /api/v1/swarm/plan/:planId ──────────────────────────────
  app.get('/api/v1/swarm/plan/:planId', (req243e, res243e) => {
    const plan = getPlan243(req243e.params.planId);
    if (!plan) return _err243(res243e, 'PLAN_NOT_FOUND', `plan ${req243e.params.planId} not found`, 404);
    return res243e.json({ ok: true, ...plan, ecosVersion: 'V243' });
  });

  // ── [V243-T06] GET /api/v1/swarm/plans ─────────────────────────────────────
  app.get('/api/v1/swarm/plans', (req243f, res243f) => {
    const userId = req243f.query.userId || undefined;
    const limit  = parseInt(req243f.query.limit || '50', 10);
    const plans  = listPlans243({ userId, limit });
    return res243f.json({ ok: true, plans, count: plans.length, ecosVersion: 'V243' });
  });

  // ── [V243-T07] GET /api/v1/admin/summary/v243 ──────────────────────────────
  app.get('/api/v1/admin/summary/v243', (req243g, res243g) => {
    res243g.json({
      ok: true,
      version: 'V243',
      phase: 'P139',
      summary: 'RAG Pipeline (ingest/retrieve/augment) + Tool-Routing Swarm Planner',
      newLibs: [
        'src/lib/ragPipeline243.js   (+ lib/ mirror) — chunk/embed/retrieve/augment',
        'src/lib/swarmPlanner243.js  (+ lib/ mirror) — plan without executing; tool-routed',
      ],
      newEndpoints: [
        'POST /api/v1/rag/ingest           [V243-T01]',
        'POST /api/v1/rag/query            [V243-T02]',
        'GET  /api/v1/rag/stats            [V243-T03]',
        'POST /api/v1/swarm/plan           [V243-T04]',
        'GET  /api/v1/swarm/plan/:planId   [V243-T05]',
        'GET  /api/v1/swarm/plans          [V243-T06]',
        'GET  /api/v1/admin/summary/v243   [V243-T07]',
      ],
      ragStats:     defaultRagPipeline243.getStats243(),
      plannerStats: getPlannerStats243(),
      ecosVersion: 'V243',
    });
  });
}

module.exports = { registerV243Endpoints };
