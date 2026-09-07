/**
 * src/lib/swarmAggregator245.js — ECOS Swarm Result Aggregator (P141)
 * ─────────────────────────────────────────────────────────────────────
 * Configurable aggregation strategies for swarm sub-task results.
 * Plugs into swarmOrchestrator242's run results once a swarm completes.
 *
 * Strategies:
 *   concat      — join all non-empty sub-results with newline separator.
 *   structured  — return a JSON envelope: { goal, subResults[], aggregated }.
 *   rag-rerank  — re-rank sub-results by cosine similarity to the original goal
 *                 using the shared TF-IDF embedder (from ragPipeline243), then
 *                 concat the top-N.
 *
 * Usage:
 *   const { aggregateResults245 } = require('./swarmAggregator245');
 *   const agg = await aggregateResults245(swarmRun, { strategy: 'rag-rerank', topN: 3 });
 *   // → { ok, strategy, aggregated, subCount, subResults }
 *
 * Iron rules:
 *   R1 — Sacred files untouched.
 *   R2 — All new identifiers end in _245.
 *   R3 — Zero new npm deps; built-ins + relative requires only.
 * Mirror rule: this file is mirrored to lib/swarmAggregator245.js.
 */
'use strict';

// ── Soft-require collaborators ────────────────────────────────────────────────
function _req245a(p) { try { return require(p); } catch (_) { return null; } }

const _rag243Mod = _req245a('./ragPipeline243');

// ── Constants ─────────────────────────────────────────────────────────────────
const AGGREGATOR_VERSION_245        = 'V245';
const AGGREGATOR_STRATEGIES_245     = Object.freeze(['concat', 'structured', 'rag-rerank']);
const AGGREGATOR_DEFAULT_STRATEGY_245 = 'concat';
const AGGREGATOR_DEFAULT_SEP_245    = '\n\n---\n\n';
const AGGREGATOR_DEFAULT_TOPN_245   = 3;   // rag-rerank: return top-N sub-results

// ── Stats ─────────────────────────────────────────────────────────────────────
const _aggregatorStats245 = {
  callCount:    0,
  byStrategy:   { concat: 0, structured: 0, 'rag-rerank': 0 },
  lastUsedAt:   null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * _extractSubResults245(swarmRun) — extract list of { taskId, description, result }
 * from a SwarmRun242 object returned by swarmOrchestrator242.
 */
function _extractSubResults245(swarmRun) {
  if (!swarmRun) return [];
  const tasks = Array.isArray(swarmRun.subTasks) ? swarmRun.subTasks
    : Array.isArray(swarmRun.tasks) ? swarmRun.tasks : [];
  return tasks.map(t => ({
    taskId:      t.taskId || t.id || '',
    description: t.description || t.goal || '',
    result:      (t.result !== undefined && t.result !== null) ? String(t.result) : '',
    status:      t.status || '',
  }));
}

/**
 * _tfidfSimilarity245(textA, textB) — cosine similarity between TF-IDF embeddings
 * of two strings. Returns 0 if ragPipeline243 is unavailable.
 */
function _tfidfSimilarity245(textA, textB) {
  if (!_rag243Mod || typeof _rag243Mod._tfidfVector243 !== 'function') return 0;
  try {
    const vA = _rag243Mod._tfidfVector243(String(textA));
    const vB = _rag243Mod._tfidfVector243(String(textB));
    if (!vA || !vB || vA.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vA.length; i++) {
      dot  += vA[i] * vB[i];
      normA += vA[i] * vA[i];
      normB += vB[i] * vB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  } catch (_) { return 0; }
}

// ── Aggregation strategies ────────────────────────────────────────────────────

function _strategyConcat245(subResults, opts) {
  const sep = typeof opts.separator === 'string' ? opts.separator : AGGREGATOR_DEFAULT_SEP_245;
  const texts = subResults.map(r => r.result).filter(r => r.trim());
  return {
    aggregated: texts.join(sep) || '',
    subCount:   subResults.length,
    usedCount:  texts.length,
  };
}

function _strategyStructured245(swarmRun, subResults) {
  return {
    aggregated: JSON.stringify({
      goal:       swarmRun.goal || '',
      swarmId:    swarmRun.swarmId || swarmRun.id || '',
      subResults: subResults.map(r => ({
        taskId:      r.taskId,
        description: r.description,
        result:      r.result,
        status:      r.status,
      })),
      aggregatedAt: new Date().toISOString(),
      ecosVersion:  AGGREGATOR_VERSION_245,
    }),
    subCount:  subResults.length,
    usedCount: subResults.length,
  };
}

function _strategyRagRerank245(swarmRun, subResults, opts) {
  const goal  = String(swarmRun.goal || '');
  const topN  = Number(opts.topN) > 0 ? Number(opts.topN) : AGGREGATOR_DEFAULT_TOPN_245;
  const sep   = typeof opts.separator === 'string' ? opts.separator : AGGREGATOR_DEFAULT_SEP_245;

  // Score each sub-result by cosine sim to the goal
  const scored245 = subResults
    .filter(r => r.result.trim())
    .map(r => ({
      ...r,
      _score245: _tfidfSimilarity245(goal, r.description + ' ' + r.result),
    }))
    .sort((a, b) => b._score245 - a._score245);

  const top245 = scored245.slice(0, topN);
  const texts  = top245.map(r => r.result);

  return {
    aggregated: texts.join(sep) || '',
    subCount:   subResults.length,
    usedCount:  top245.length,
    scores:     top245.map(r => ({ taskId: r.taskId, score: r._score245 })),
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * aggregateResults245(swarmRun, opts) → { ok, strategy, aggregated, subCount, ... }
 *
 * @param {object} swarmRun  — completed SwarmRun242 object (has .subTasks / .goal).
 * @param {object} opts
 *   opts.strategy  {string}  'concat' | 'structured' | 'rag-rerank' (default: 'concat')
 *   opts.topN      {number}  rag-rerank: how many top sub-results to use (default: 3)
 *   opts.separator {string}  concat/rag-rerank: join separator (default: '\n\n---\n\n')
 */
async function aggregateResults245(swarmRun, opts) {
  const o        = opts || {};
  const strategy = AGGREGATOR_STRATEGIES_245.includes(o.strategy)
    ? o.strategy : AGGREGATOR_DEFAULT_STRATEGY_245;

  _aggregatorStats245.callCount++;
  _aggregatorStats245.byStrategy[strategy] = (_aggregatorStats245.byStrategy[strategy] || 0) + 1;
  _aggregatorStats245.lastUsedAt = new Date().toISOString();

  const subResults = _extractSubResults245(swarmRun);

  let inner245;
  try {
    if (strategy === 'structured') {
      inner245 = _strategyStructured245(swarmRun, subResults);
    } else if (strategy === 'rag-rerank') {
      inner245 = _strategyRagRerank245(swarmRun, subResults, o);
    } else {
      inner245 = _strategyConcat245(subResults, o);
    }
  } catch (e245strat) {
    return { ok: false, strategy, error: e245strat.message, ecosVersion: AGGREGATOR_VERSION_245 };
  }

  return {
    ok:          true,
    strategy,
    aggregated:  inner245.aggregated,
    subCount:    inner245.subCount,
    usedCount:   inner245.usedCount,
    scores:      inner245.scores || null,
    swarmId:     swarmRun ? (swarmRun.swarmId || swarmRun.id || null) : null,
    ecosVersion: AGGREGATOR_VERSION_245,
  };
}

/**
 * getAggregatorStats245() — operational stats.
 */
function getAggregatorStats245() {
  return Object.assign({}, _aggregatorStats245, {
    strategies: AGGREGATOR_STRATEGIES_245,
    ecosVersion: AGGREGATOR_VERSION_245,
  });
}

module.exports = {
  aggregateResults245,
  getAggregatorStats245,
  AGGREGATOR_VERSION_245,
  AGGREGATOR_STRATEGIES_245,
  AGGREGATOR_DEFAULT_STRATEGY_245,
  AGGREGATOR_DEFAULT_TOPN_245,
  // expose helpers for testing
  _extractSubResults245,
  _tfidfSimilarity245,
};
