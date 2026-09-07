/**
 * ecos-api-server-v244-patch.js — ECOS V244 (Phase P140)
 * ────────────────────────────────────────────────────────
 * Registers the new V244 endpoints on top of V243 without touching any
 * existing routes (R4 additive-only).
 *
 *   P140-A  Swarm-RAG Bridge (executeSwarmWithRag244):
 *     POST /api/v1/swarm/execute-rag       [V244-T01]  execute swarm with RAG
 *     POST /api/v1/swarm/execute-plan/:planId [V244-T02] plan→execute pipeline
 *
 *   P140-B  RAG Document Management:
 *     GET  /api/v1/rag/documents           [V244-T03]  list ingested docs
 *     GET  /api/v1/rag/documents/:docId    [V244-T04]  single doc info
 *     DELETE /api/v1/rag/documents/:docId  [V244-T05]  delete doc (all chunks)
 *
 *   P140-C  Phase summary:
 *     GET  /api/v1/admin/summary/v244      [V244-T06]
 *
 * R1 — Sacred files untouched.
 * R2 — All new identifiers end in 244.
 * R3 — Zero new npm deps (Node built-ins + relative requires only).
 * R6 — New libs via relative require only.
 */

'use strict';

const {
  executeSwarmWithRag244,
  executePlanWithRag244,
  getBridgeStats244,
  BRIDGE_DEFAULT_TOPK_244,
} = require('./src/lib/swarmRagBridge244');

const {
  listDocuments244,
  deleteDocument244,
  getDocumentInfo244,
  getDocMgrStats244,
  DOC_MANAGER_MAX_LIST_244,
} = require('./src/lib/ragDocManager244');

function _err244(res, code, msg, status) {
  return res.status(status || 400).json({ ok: false, code, error: msg, ecosVersion: 'V244' });
}

function registerV244Endpoints(app, _opts) {

  // ── [V244-T01] POST /api/v1/swarm/execute-rag ───────────────────────────────
  // Execute a swarm with RAG context augmentation on each sub-task.
  // Body: { userId, goal, ragEnabled?, ragTopK?, ragMetaFilter?, subTasks?,
  //         timeoutMs? }
  app.post('/api/v1/swarm/execute-rag', async (req244a, res244a) => {
    try {
      const b = req244a.body || {};
      if (!b.userId || typeof b.userId !== 'string' || !b.userId.trim()) {
        return _err244(res244a, 'BRIDGE_MISSING_USERID_244', 'userId required');
      }
      if (!b.goal || typeof b.goal !== 'string' || !b.goal.trim()) {
        return _err244(res244a, 'BRIDGE_MISSING_GOAL_244', 'goal required');
      }

      const result = await executeSwarmWithRag244({
        userId:        b.userId.trim(),
        goal:          b.goal.trim(),
        ragEnabled:    b.ragEnabled !== false,
        ragTopK:       b.ragTopK   || BRIDGE_DEFAULT_TOPK_244,
        ragMetaFilter: b.ragMetaFilter || null,
        subTasks:      Array.isArray(b.subTasks) ? b.subTasks : undefined,
        timeoutMs:     b.timeoutMs  || undefined,
      });

      const status = result.ok ? 202 : 400;
      return res244a.status(status).json(result);
    } catch (e244a) {
      return _err244(res244a, 'BRIDGE_EXECUTE_ERROR_244', e244a.message, 500);
    }
  });

  // ── [V244-T02] POST /api/v1/swarm/execute-plan/:planId ──────────────────────
  // Lift a stored SwarmPlan243 into a swarm run (with optional RAG augmentation).
  // Body: { userId, ragEnabled?, ragTopK?, ragMetaFilter?, timeoutMs? }
  app.post('/api/v1/swarm/execute-plan/:planId', async (req244b, res244b) => {
    try {
      const planId = String(req244b.params.planId || '').trim();
      if (!planId) return _err244(res244b, 'BRIDGE_MISSING_PLANID_244', 'planId required');

      const b = req244b.body || {};
      if (!b.userId || typeof b.userId !== 'string' || !b.userId.trim()) {
        return _err244(res244b, 'BRIDGE_MISSING_USERID_244', 'userId required');
      }

      const result = await executePlanWithRag244(planId, {
        userId:        b.userId.trim(),
        ragEnabled:    b.ragEnabled !== false,
        ragTopK:       b.ragTopK   || BRIDGE_DEFAULT_TOPK_244,
        ragMetaFilter: b.ragMetaFilter || null,
        timeoutMs:     b.timeoutMs  || undefined,
      });

      const status = result.ok ? 202 : (result.code === 'BRIDGE_PLAN_NOT_FOUND_244' ? 404 : 400);
      return res244b.status(status).json(result);
    } catch (e244b) {
      return _err244(res244b, 'BRIDGE_EXECUTE_PLAN_ERROR_244', e244b.message, 500);
    }
  });

  // ── [V244-T03] GET /api/v1/rag/documents ───────────────────────────────────
  // List ingested RAG documents (distinct docIds).
  // Query: ?limit=N (default 50, max 500)
  app.get('/api/v1/rag/documents', (req244c, res244c) => {
    try {
      const limit = parseInt(req244c.query.limit || '50', 10);
      if (isNaN(limit) || limit < 1 || limit > DOC_MANAGER_MAX_LIST_244) {
        return _err244(res244c, 'DOC_MGR_BAD_LIMIT_244',
          `limit must be 1–${DOC_MANAGER_MAX_LIST_244}`);
      }
      const result = listDocuments244({ limit });
      return res244c.status(result.ok ? 200 : 500).json(result);
    } catch (e244c) {
      return _err244(res244c, 'DOC_MGR_LIST_ERROR_244', e244c.message, 500);
    }
  });

  // ── [V244-T04] GET /api/v1/rag/documents/:docId ────────────────────────────
  // Retrieve info (chunk count + meta) for a specific document.
  app.get('/api/v1/rag/documents/:docId', (req244d, res244d) => {
    try {
      const docId = String(req244d.params.docId || '').trim();
      if (!docId) return _err244(res244d, 'DOC_MGR_MISSING_DOCID_244', 'docId required');
      const result = getDocumentInfo244(docId);
      const status = result.ok ? 200 : (result.code === 'DOC_MGR_NOT_FOUND_244' ? 404 : 400);
      return res244d.status(status).json(result);
    } catch (e244d) {
      return _err244(res244d, 'DOC_MGR_INFO_ERROR_244', e244d.message, 500);
    }
  });

  // ── [V244-T05] DELETE /api/v1/rag/documents/:docId ─────────────────────────
  // Delete all chunks for a document from the vector store.
  app.delete('/api/v1/rag/documents/:docId', (req244e, res244e) => {
    try {
      const docId = String(req244e.params.docId || '').trim();
      if (!docId) return _err244(res244e, 'DOC_MGR_MISSING_DOCID_244', 'docId required');
      const result = deleteDocument244(docId);
      const status = result.ok ? 200 : 400;
      return res244e.status(status).json(result);
    } catch (e244e) {
      return _err244(res244e, 'DOC_MGR_DELETE_ERROR_244', e244e.message, 500);
    }
  });

  // ── [V244-T06] GET /api/v1/admin/summary/v244 ──────────────────────────────
  app.get('/api/v1/admin/summary/v244', (req244f, res244f) => {
    res244f.json({
      ok: true,
      version: 'V244',
      phase: 'P140',
      summary: 'Swarm-RAG execution bridge + Plan→Execute pipeline + RAG document management',
      newLibs: [
        'src/lib/swarmRagBridge244.js  (+ lib/ mirror) — executeSwarmWithRag244, executePlanWithRag244',
        'src/lib/ragDocManager244.js   (+ lib/ mirror) — listDocuments244, deleteDocument244, getDocumentInfo244',
      ],
      newEndpoints: [
        'POST   /api/v1/swarm/execute-rag              [V244-T01]',
        'POST   /api/v1/swarm/execute-plan/:planId     [V244-T02]',
        'GET    /api/v1/rag/documents                  [V244-T03]',
        'GET    /api/v1/rag/documents/:docId           [V244-T04]',
        'DELETE /api/v1/rag/documents/:docId           [V244-T05]',
        'GET    /api/v1/admin/summary/v244             [V244-T06]',
      ],
      bridgeStats:  getBridgeStats244(),
      docMgrStats:  getDocMgrStats244(),
      ecosVersion:  'V244',
    });
  });
}

module.exports = { registerV244Endpoints };
