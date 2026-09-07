/**
 * ecos-api-server-v245-patch.js — ECOS V245 (Phase P141)
 * ────────────────────────────────────────────────────────
 * Registers all new V245 endpoints. Additive-only (R4).
 *
 *   P141-A  RAG Corpus Persistence:
 *     POST /api/v1/rag/corpus/flush   [V245-T01]  NDJSON flush to disk
 *     POST /api/v1/rag/corpus/load    [V245-T02]  warm-restart load from disk
 *
 *   P141-B  RAG Corpus Stats:
 *     GET  /api/v1/rag/corpus/stats   [V245-T03]  IDF corpus size, vocab, chunk counts
 *
 *   P141-C  Swarm Result Aggregation:
 *     POST /api/v1/swarm/:swarmId/aggregate [V245-T04]  aggregate a completed swarm run
 *     GET  /api/v1/swarm/aggregator/stats   [V245-T05]  aggregator operational stats
 *
 *   P141-D  Phase summary:
 *     GET  /api/v1/admin/summary/v245 [V245-T06]
 *
 * R1 — Sacred files untouched.
 * R2 — All new identifiers end in 245.
 * R3 — Zero new npm deps (Node built-ins + relative requires only).
 * R6 — New libs via relative require only.
 */

'use strict';

const {
  flushCorpus245,
  loadCorpus245,
  getCorpusPersistenceStats245,
  CORPUS_VERSION_245,
  CORPUS_DEFAULT_FILE_245,
} = require('./src/lib/ragCorpusPersistence245');

const {
  aggregateResults245,
  getAggregatorStats245,
  AGGREGATOR_STRATEGIES_245,
  AGGREGATOR_VERSION_245,
} = require('./src/lib/swarmAggregator245');

// ── Soft-require collaborators for stats/lookup ───────────────────────────────
function _req245p(p) { try { return require(p); } catch (_) { return null; } }
const _rag243Mod = _req245p('./src/lib/ragPipeline243');
const _sw242Mod  = _req245p('./src/lib/swarmOrchestrator242');
const _vm242Mod  = _req245p('./src/lib/vectorMemory242');

function _err245(res, code, msg, status) {
  return res.status(status || 400).json({ ok: false, code, error: msg, ecosVersion: 'V245' });
}

function registerV245Endpoints(app, _opts) {

  // ── [V245-T01] POST /api/v1/rag/corpus/flush ──────────────────────────────
  // Serialize the live IDF corpus to an NDJSON file for warm-restart.
  // Body (optional): { filePath?, append? }
  app.post('/api/v1/rag/corpus/flush', (req245a, res245a) => {
    try {
      const b = req245a.body || {};
      const result245a = flushCorpus245({
        filePath: b.filePath || undefined,
        append:   !!b.append,
      });
      const status245a = result245a.ok ? 200 : 500;
      return res245a.status(status245a).json(result245a);
    } catch (e245a) {
      return _err245(res245a, 'CORPUS_FLUSH_ERROR_245', e245a.message, 500);
    }
  });

  // ── [V245-T02] POST /api/v1/rag/corpus/load ───────────────────────────────
  // Load a previously flushed IDF corpus back into the running process.
  // Body (optional): { filePath?, merge? }
  app.post('/api/v1/rag/corpus/load', (req245b, res245b) => {
    try {
      const b = req245b.body || {};
      const result245b = loadCorpus245({
        filePath: b.filePath || undefined,
        merge:    b.merge !== false, // default merge=true
      });
      const status245b = result245b.ok ? 200 : 400;
      return res245b.status(status245b).json(result245b);
    } catch (e245b) {
      return _err245(res245b, 'CORPUS_LOAD_ERROR_245', e245b.message, 500);
    }
  });

  // ── [V245-T03] GET /api/v1/rag/corpus/stats ───────────────────────────────
  // Live stats: IDF vocab size, docCount, per-doc chunk counts.
  app.get('/api/v1/rag/corpus/stats', (req245c, res245c) => {
    try {
      // IDF corpus info from ragPipeline243
      const idfMap     = _rag243Mod ? _rag243Mod._idfCorpus243     : null;
      const vocabSize  = idfMap instanceof Map ? idfMap.size : 0;

      // Vector store info for chunk counts per docId
      const vmInst245 = (_vm242Mod && _vm242Mod.defaultVectorMemory242)
        ? _vm242Mod.defaultVectorMemory242 : null;
      const vmStats245 = vmInst245 && typeof vmInst245.getStats242 === 'function'
        ? vmInst245.getStats242() : null;

      // Per-doc chunk counts — O(N) scan; acceptable up to 50k entries per V244 design notes
      let perDocChunks245 = {};
      if (vmInst245 && vmInst245._store242 instanceof Map) {
        for (const [, entry] of vmInst245._store242) {
          const docId = entry && entry.meta && entry.meta.docId;
          if (docId) perDocChunks245[docId] = (perDocChunks245[docId] || 0) + 1;
        }
      }

      const persistStats = getCorpusPersistenceStats245();

      return res245c.json({
        ok: true,
        vocabSize,
        perDocChunks: perDocChunks245,
        totalChunks:  vmStats245 ? vmStats245.size : null,
        vectorStats:  vmStats245,
        persistence:  persistStats,
        defaultFilePath: CORPUS_DEFAULT_FILE_245,
        ecosVersion: 'V245',
      });
    } catch (e245c) {
      return _err245(res245c, 'CORPUS_STATS_ERROR_245', e245c.message, 500);
    }
  });

  // ── [V245-T04] POST /api/v1/swarm/:swarmId/aggregate ─────────────────────
  // Aggregate results of a completed swarm run.
  // Body: { strategy?, topN?, separator? }
  // Strategies: concat (default) | structured | rag-rerank
  app.post('/api/v1/swarm/:swarmId/aggregate', async (req245d, res245d) => {
    try {
      const swarmId245 = String(req245d.params.swarmId || '').trim();
      if (!swarmId245) {
        return _err245(res245d, 'AGG_MISSING_SWARMID_245', 'swarmId required');
      }

      // Resolve swarm run from orchestrator
      const orch245 = _sw242Mod ? _sw242Mod.defaultSwarmOrchestrator242 : null;
      let swarmRun245 = null;
      if (orch245 && typeof orch245.getRunById242 === 'function') {
        swarmRun245 = orch245.getRunById242(swarmId245);
      } else if (orch245 && orch245._runs242 instanceof Map) {
        swarmRun245 = orch245._runs242.get(swarmId245) || null;
      }

      if (!swarmRun245) {
        return _err245(res245d, 'AGG_SWARM_NOT_FOUND_245', `Swarm run "${swarmId245}" not found`, 404);
      }

      const b = req245d.body || {};
      const result245d = await aggregateResults245(swarmRun245, {
        strategy:  b.strategy  || undefined,
        topN:      b.topN      || undefined,
        separator: b.separator || undefined,
      });

      return res245d.status(result245d.ok ? 200 : 400).json(result245d);
    } catch (e245d) {
      return _err245(res245d, 'AGG_ERROR_245', e245d.message, 500);
    }
  });

  // ── [V245-T05] GET /api/v1/swarm/aggregator/stats ────────────────────────
  app.get('/api/v1/swarm/aggregator/stats', (req245e, res245e) => {
    res245e.json({ ok: true, ...getAggregatorStats245() });
  });

  // ── [V245-T06] GET /api/v1/admin/summary/v245 ────────────────────────────
  app.get('/api/v1/admin/summary/v245', (req245f, res245f) => {
    const persistStats = getCorpusPersistenceStats245();
    const aggStats     = getAggregatorStats245();
    res245f.json({
      ok:      true,
      version: 'V245',
      phase:   'P141',
      summary: 'RAG corpus persistence · corpus stats · swarm aggregator (concat/structured/rag-rerank)',
      newEndpoints: [
        'POST /api/v1/rag/corpus/flush          [V245-T01] — flush IDF corpus to NDJSON',
        'POST /api/v1/rag/corpus/load           [V245-T02] — warm-restart load corpus',
        'GET  /api/v1/rag/corpus/stats          [V245-T03] — IDF vocab + chunk counts',
        'POST /api/v1/swarm/:swarmId/aggregate  [V245-T04] — aggregate swarm results',
        'GET  /api/v1/swarm/aggregator/stats    [V245-T05] — aggregator stats',
        'GET  /api/v1/admin/summary/v245        [V245-T06] — this endpoint',
      ],
      newLibs: [
        'src/lib/ragCorpusPersistence245.js — flush/load IDF corpus (mirrored to lib/)',
        'src/lib/swarmAggregator245.js      — concat/structured/rag-rerank strategies (mirrored to lib/)',
      ],
      aggregatorStrategies: AGGREGATOR_STRATEGIES_245,
      persistenceStats:     persistStats,
      aggregatorStats:      aggStats,
      ironRules: 'R1 sacred intact · R2 ids…245 · R3 zero npm deps · R6 relative require · Mirror rule: both libs in lib/',
      ecosVersion: 'V245',
    });
  });
}

module.exports = {
  registerV245Endpoints,
};
