/**
 * src/lib/ragPipeline243.js — ECOS RAG Pipeline (P139)
 * ─────────────────────────────────────────────────────
 * Retrieval-Augmented Generation pipeline built on vectorMemory242.
 *
 * Steps:
 *   1. ingestDocument243(text, meta) — chunk → TF-IDF embed → storeMemory242
 *   2. retrieveContext243(query, topK) — embed query → searchMemory242 → sorted chunks
 *   3. augmentPrompt243(query, topK) — retrieve → format [CONTEXT]...[QUERY] prompt
 *
 * Embedding strategy: TF-IDF bag-of-words vectors over a shared global IDF
 * corpus built incrementally from all ingested chunks. Same algorithm used
 * by discoverTools237 / semanticPatchEngine — zero new deps, zero pgvector.
 *
 * Zero new npm deps. Identifiers end with 243.
 */

'use strict';

const crypto = require('crypto');

// ── Soft-require collaborators ────────────────────────────────────────────────
function _tryRequire243(p) { try { return require(p); } catch (_) { return null; } }

const _vm242Mod = _tryRequire243('./vectorMemory242');
const _auditLog = _tryRequire243('./auditLog');

// ── Constants ─────────────────────────────────────────────────────────────────
const RAG_CHUNK_SIZE_243       = 500;    // characters per chunk
const RAG_CHUNK_OVERLAP_243    = 50;     // overlap in characters
const RAG_MAX_TOPK_243         = 50;
const RAG_DEFAULT_TOPK_243     = 5;
const RAG_META_PREFIX_243      = 'rag_chunk';
const RAG_CORPUS_KEY_243       = '__rag_idf_corpus__';
const RAG_MAX_VOCAB_243        = 10_000; // IDF vocab cap
const RAG_VEC_DIM_243          = 512;    // output vector dimension (top N terms)

// ── IDF corpus (global, shared across all ingested documents) ─────────────────
/** @type {Map<string, number>}  term → doc-frequency count */
const _idfCorpus243 = new Map();
let _idfDocCount243 = 0;

// ── Tokenizer (mirrors simpleTokenize237 for consistency) ─────────────────────
const _STOP_WORDS_243 = new Set([
  'the','a','an','is','are','was','were','to','of','in','for','on','with',
  'at','by','from','this','that','it','its','as','be','been','being',
  'have','has','had','do','does','did','not','but','and','or','so','if',
]);

function _tokenize243(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !_STOP_WORDS_243.has(w));
}

function _buildTf243(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length || 1;
  for (const k of Object.keys(tf)) tf[k] /= total;
  return tf;
}

function _updateCorpus243(tokens) {
  _idfDocCount243++;
  const seen = new Set(tokens);
  for (const t of seen) {
    _idfCorpus243.set(t, (_idfCorpus243.get(t) || 0) + 1);
  }
  // Trim vocab if over cap
  if (_idfCorpus243.size > RAG_MAX_VOCAB_243) {
    // drop terms with lowest doc-frequency
    const sorted = [..._idfCorpus243.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, _idfCorpus243.size - RAG_MAX_VOCAB_243);
    for (const [t] of toRemove) _idfCorpus243.delete(t);
  }
}

function _idf243(term) {
  const df = _idfCorpus243.get(term) || 0;
  return Math.log((_idfDocCount243 + 1) / (df + 1)) + 1; // smoothed
}

/**
 * Build a TF-IDF vector of dimension RAG_VEC_DIM_243.
 * Projects onto the top-N terms of the global IDF vocab, sorted by IDF desc.
 */
function _tfidfVector243(text) {
  const tokens = _tokenize243(text);
  const tf = _buildTf243(tokens);

  // Compute scores for every term in the text
  const scored = [];
  for (const [term, tfScore] of Object.entries(tf)) {
    scored.push({ term, score: tfScore * _idf243(term) });
  }
  scored.sort((a, b) => b.score - a.score);

  // Build dense vector (pad to RAG_VEC_DIM_243)
  const vec = new Array(RAG_VEC_DIM_243).fill(0);
  // Stable term→index mapping: sort by term name so same term always same slot
  // Use a hash-based index within the dimension space
  for (const { term, score } of scored) {
    const idx = _termIndex243(term);
    vec[idx] += score; // accumulate on collision
  }
  return vec;
}

function _termIndex243(term) {
  // Deterministic index from term: FNV-1a mod DIM
  let h = 2166136261;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % RAG_VEC_DIM_243;
}

// ── Chunker ────────────────────────────────────────────────────────────────────
/**
 * Splits text into overlapping character chunks.
 * @param {string} text
 * @param {number} chunkSize
 * @param {number} overlap
 * @returns {string[]}
 */
function chunkText243(text, chunkSize = RAG_CHUNK_SIZE_243, overlap = RAG_CHUNK_OVERLAP_243) {
  if (!text || typeof text !== 'string') return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

// ── RAG Pipeline class ────────────────────────────────────────────────────────
class RagPipeline243 {
  /**
   * @param {object} [opts]
   * @param {object} [opts.vectorMemory]  - VectorMemory242 instance (defaults to shared default)
   */
  constructor(opts) {
    const o = opts || {};
    if (o.vectorMemory) {
      this._mem243 = o.vectorMemory;
    } else if (_vm242Mod) {
      this._mem243 = _vm242Mod.defaultVectorMemory242;
    } else {
      throw new Error('RAG_243: vectorMemory242 not available');
    }
    this._ingestCount243 = 0;
    this._queryCount243  = 0;
  }

  /**
   * Ingest a document: chunk → embed → store in vector memory.
   * @param {string} text - document text
   * @param {object} [meta] - arbitrary metadata (docId, source, etc.)
   * @param {object} [opts]
   * @param {number} [opts.chunkSize]
   * @param {number} [opts.overlap]
   * @returns {{ docId: string, chunksStored: number }}
   */
  async ingestDocument243(text, meta, opts) {
    const o = opts || {};
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('RAG_243: text must be a non-empty string');
    }
    const docId = (meta && meta.docId) ? String(meta.docId)
      : 'doc_' + crypto.randomBytes(6).toString('hex');
    const baseMeta = Object.assign({}, meta, { docId, type: RAG_META_PREFIX_243 });

    const chunks = chunkText243(text, o.chunkSize, o.overlap);
    let stored = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const tokens = _tokenize243(chunkText);
      _updateCorpus243(tokens);  // update global IDF
      const vec = _tfidfVector243(chunkText);
      const key = `${docId}__chunk${i}`;
      this._mem243.storeMemory242(key, vec, Object.assign({}, baseMeta, { chunkIndex: i, chunkText }));
      stored++;
    }
    this._ingestCount243++;

    if (_auditLog) {
      try { _auditLog.defaultAuditLog && _auditLog.defaultAuditLog.append('RAG_INGEST_243', { docId, chunksStored: stored }); } catch (_) {}
    }

    return { docId, chunksStored: stored };
  }

  /**
   * Retrieve relevant chunks for a query.
   * @param {string} query
   * @param {number} [topK]
   * @param {object} [metaFilter]  - optional additional meta filter
   * @returns {{ chunk: string, score: number, key: string, meta: object }[]}
   */
  retrieveContext243(query, topK, metaFilter) {
    if (typeof query !== 'string' || !query.trim()) return [];
    const k = Math.max(1, Math.min(topK || RAG_DEFAULT_TOPK_243, RAG_MAX_TOPK_243));
    const tokens = _tokenize243(query);
    _updateCorpus243(tokens); // let query terms influence IDF
    const vec = _tfidfVector243(query);

    const filter = Object.assign({ type: RAG_META_PREFIX_243 }, metaFilter || {});
    const results = this._mem243.searchMemory242(vec, k, { metaFilter: filter });
    this._queryCount243++;

    return results.map(r => ({
      chunk: r.meta.chunkText || '',
      score: r.score,
      key: r.key,
      meta: r.meta,
    }));
  }

  /**
   * Build an augmented prompt: [CONTEXT]...[QUERY]
   * @param {string} query
   * @param {number} [topK]
   * @param {object} [metaFilter]
   * @returns {{ prompt: string, chunks: Array, query: string }}
   */
  augmentPrompt243(query, topK, metaFilter) {
    const chunks = this.retrieveContext243(query, topK, metaFilter);
    if (chunks.length === 0) {
      return { prompt: `[CONTEXT]\n(no relevant context found)\n[QUERY]\n${query}`, chunks: [], query };
    }
    const contextBlock = chunks
      .map((c, i) => `[${i + 1}] (score=${c.score.toFixed(3)}) ${c.chunk}`)
      .join('\n\n');
    const prompt = `[CONTEXT]\n${contextBlock}\n\n[QUERY]\n${query}`;
    return { prompt, chunks, query };
  }

  /** Stats for monitoring. */
  getStats243() {
    return {
      ingestCount:  this._ingestCount243,
      queryCount:   this._queryCount243,
      vocabSize:    _idfCorpus243.size,
      docCount:     _idfDocCount243,
      vectorDim:    RAG_VEC_DIM_243,
      chunkSize:    RAG_CHUNK_SIZE_243,
      overlap:      RAG_CHUNK_OVERLAP_243,
    };
  }
}

const defaultRagPipeline243 = new RagPipeline243();

module.exports = {
  RagPipeline243,
  defaultRagPipeline243,
  chunkText243,
  RAG_CHUNK_SIZE_243,
  RAG_CHUNK_OVERLAP_243,
  RAG_MAX_TOPK_243,
  RAG_DEFAULT_TOPK_243,
  RAG_VEC_DIM_243,
  // expose internals for testing
  _tokenize243,
  _buildTf243,
  _tfidfVector243,
  _idfCorpus243,
};
