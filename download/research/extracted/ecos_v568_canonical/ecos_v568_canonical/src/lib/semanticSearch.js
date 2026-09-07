/**
 * semanticSearch.js — V96
 * Wraps semanticPatchEngine.js for chat-side patch discovery.
 *
 * Export: async function findSimilarPatches(queryText, opts = {})
 *   opts.limit    = 5  (default)
 *   opts.minScore = 0.3 (default)
 *
 * Path 1: DB pool + pgvector available → vector similarity search
 * Path 2: No DB / no pool → TF-IDF fallback (pure JS)
 *
 * Returns: Array<{ patchId, score, preview, reuseCount }>
 * On any error: returns [] (never throws)
 */

'use strict';

const engine = require('./semanticPatchEngine');

// Stop-words filtered out before TF-IDF scoring
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
]);

/**
 * Tokenize text for TF-IDF: lowercase, strip punctuation,
 * split on whitespace, remove stop-words.
 * @param {string} text
 * @returns {string[]}
 */
function simpleTokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Compute cosine similarity between two TF vectors (plain objects).
 * @param {Object} tfA
 * @param {Object} tfB
 * @returns {number} similarity in [0, 1]
 */
function _cosineTf(tfA, tfB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const keysA = Object.keys(tfA);
  for (const w of keysA) {
    normA += tfA[w] * tfA[w];
    if (tfB[w]) dot += tfA[w] * tfB[w];
  }
  for (const w of Object.keys(tfB)) normB += tfB[w] * tfB[w];
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Build a term-frequency map from a token array.
 * @param {string[]} tokens
 * @returns {Object}
 */
function _buildTf(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

async function findSimilarPatches(queryText, opts = {}) {
  const limit    = Math.max(1, Math.min(opts.limit    || 5,   50));
  const minScore = Math.max(0, Math.min(opts.minScore || 0.3, 1));

  try {
    const { getPool } = require('../db/pool');
    const pool = getPool();

    // Path 1: DB pool available — try pgvector vector search
    const embedding = await engine._getEmbedding(queryText);
    if (embedding) {
      try {
        const distanceThreshold = 1.0 - minScore;
        const vectorStr = `[${embedding.join(',')}]`;
        const { rows } = await pool.query(
          `SELECT id, patch_body, reuse_count, earned_micro,
                  (embedding <=> $1::vector) AS distance
           FROM knowledge_patches
           WHERE active = true AND (embedding <=> $1::vector) <= $2
           ORDER BY distance ASC
           LIMIT $3`,
          [vectorStr, distanceThreshold, limit]
        );
        if (rows.length > 0) {
          return rows.map(r => ({
            patchId:    r.id,
            score:      parseFloat((1.0 - parseFloat(r.distance)).toFixed(4)),
            preview:    _preview(r.patch_body),
            reuseCount: r.reuse_count || 0,
          }));
        }
      } catch (_err) {
        // pgvector not available — fall through to TF-IDF
      }
    }

    // Path 1b: DB available but no embeddings — TF-IDF against all patches
    const { rows } = await pool.query(
      `SELECT id, patch_body, reuse_count, earned_micro
       FROM knowledge_patches
       WHERE active = true
       ORDER BY reuse_count DESC
       LIMIT 200`
    );
    return _rankByTfIdf(queryText, rows, limit, minScore);
  } catch {
    // Path 2: No DB pool — nothing to search, return empty
    return [];
  }
}

function _preview(patchBody) {
  const text  = typeof patchBody === 'string' ? patchBody : JSON.stringify(patchBody);
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
}

/**
 * Rank rows by TF-IDF cosine similarity against queryText.
 * Each result includes a `score` field in [0, 1].
 */
function _rankByTfIdf(queryText, rows, limit, minScore) {
  const queryTf = _buildTf(simpleTokenize(queryText));
  const scored  = [];

  for (const r of rows) {
    const patchText = typeof r.patch_body === 'string'
      ? r.patch_body
      : JSON.stringify(r.patch_body);
    const patchTf = _buildTf(simpleTokenize(patchText));
    const score   = _cosineTf(queryTf, patchTf);
    if (score >= minScore) {
      scored.push({
        patchId:    r.id,
        score:      parseFloat(score.toFixed(4)),
        preview:    _preview(r.patch_body),
        reuseCount: r.reuse_count || 0,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

module.exports = { findSimilarPatches, simpleTokenize, _rankByTfIdf };
