/**
 * ECOS Semantic Patch Engine - Enterprise Major League Edition
 * ------------------------------------------------------------
 * Integrates pgvector for database-level similarity searches,
 * with pure JavaScript Cosine Similarity and a pure local TF-IDF / Bag-of-Words
 * fallback when vector endpoints are completely offline.
 *
 * [FIX-V26-PATCH] logger injection:
 *   setLogger(log) — injectable pino logger from ecos-api-server.js or demo scripts.
 *   3 console calls replaced:
 *     - console.warn OpenAI Embeddings call failed
 *     - console.warn pgvector query failed, falling back
 *     - console.log  Embeddings offline. Invoking Sovereign Local Semantic...
 *   Fallback: console.warn/log (backward-compat for tests and CLI scripts).
 *   Call from server or demo scripts before first findSemanticPatch():
 *     const engine = require('./lib/semanticPatchEngine');
 *     engine.setLogger(logger.child({ component: 'semantic-patch' }));
 */

'use strict';

const { getPool } = require('../db/pool');

class SemanticPatchEngine {
  constructor() {
    this.ollamaUrl = process.env.LOCAL_LLM_URL || 'http://localhost:11434';
    this.embeddingModel = 'all-minilm:latest'; // 384 dimensions

    // [FIX-V26-PATCH] injectable logger — fallback to console for tests / CLI
    this._log = {
      warn: (obj, msg) => console.warn('[SemanticPatchEngine]', msg || obj, typeof obj === 'object' ? JSON.stringify(obj) : ''), // eslint-disable-line no-console
      info: (obj, msg) => console.info('[SemanticPatchEngine]', msg || obj, typeof obj === 'object' ? JSON.stringify(obj) : ''), // eslint-disable-line no-console
    };
  }

  /**
   * [FIX-V26-PATCH] Inject pino logger (or any { warn, info } compatible object).
   * Call before first findSemanticPatch():
   *   engine.setLogger(logger.child({ component: 'semantic-patch' }));
   *
   * @param {{ warn: Function, info: Function }} log
   */
  setLogger(log) {
    if (log && typeof log.warn === 'function') {
      this._log = log;
    }
  }

  async _getEmbedding(text) {
    const provider = (process.env.EMBEDDING_PROVIDER || 'ollama').toLowerCase();

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      try {
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
            input: text
          })
        });
        if (!res.ok) throw new Error(`OpenAI Embeddings returned status ${res.status}`);
        const data = await res.json();
        return data.data[0].embedding;
      } catch (err) {
        // [FIX-V26-PATCH] was: console.warn('[SemanticPatchEngine] OpenAI Embeddings call failed:', err.message)
        this._log.warn({ component: 'semantic-patch', provider: 'openai', err: err.message }, 'OpenAI Embeddings call failed');
        return null;
      }
    }

    // Default Ollama local embedding
    try {
      const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      });
      if (!res.ok) throw new Error(`Ollama status ${res.status}`);
      const data = await res.json();
      return data.embedding;
    } catch (err) {
      return null;
    }
  }

  /**
   * Search for closest matching patches.
   * Path 1: Database-level pgvector Cosine similarity (blazing fast)
   * Path 2: In-Memory JS Cosine similarity (on calculated embeddings)
   * Path 3: Sovereign Local Semantic Cosine Similarity (pure JS, offline-safe Bag-of-Words)
   * Path 4: Keyword overlap index search (standard SQL GIN)
   * Path 5: Popular fallback
   */
  async findSemanticPatch(taskType, aiOutput, threshold = 0.85, similarityKeys = []) {
    const serializedOutput = JSON.stringify(aiOutput);

    // Fetch active patches for the given taskType first to save execution overhead
    const { rows: patches } = await getPool().query(
      `SELECT id, patch_body, metadata, validator_id, reward_per_reuse, reuse_count,
              similarity_keys, earned_micro
       FROM knowledge_patches
       WHERE task_type = $1 AND active = true`,
      [taskType]
    );

    if (patches.length === 0) return null;

    // Try to get embeddings for active matching
    const embedding = await this._getEmbedding(serializedOutput);

    if (embedding) {
      // Path 1: pgvector Cosine Distance in database
      try {
        const distanceThreshold = 1.0 - threshold;
        const vectorStr = `[${embedding.join(',')}]`;
        
        const { rows } = await getPool().query(
          `SELECT id, patch_body, metadata, validator_id, reward_per_reuse, reuse_count,
                  similarity_keys, earned_micro, (embedding <=> $1::vector) AS distance
           FROM knowledge_patches
           WHERE task_type = $2 AND active = true AND (embedding <=> $1::vector) <= $3
           ORDER BY distance ASC LIMIT 1`,
          [vectorStr, taskType, distanceThreshold]
        );

        if (rows.length > 0) {
          return {
            ...this._shape(rows[0]),
            similarity: 1.0 - parseFloat(rows[0].distance),
            matchType: 'pgvector_cosine'
          };
        }
      } catch (err) {
        // [FIX-V26-PATCH] was: console.warn('[SemanticPatchEngine] pgvector query failed, falling back ...')
        this._log.warn({ component: 'semantic-patch', err: err.message }, 'pgvector query failed, falling back to JS-side calculations');
      }

      // Path 2: JS-side Cosine Similarity on active embeddings
      let bestMatch = null;
      let highestSimilarity = 0;

      for (const patch of patches) {
        const originalText = patch.metadata?.original_ai_output ? JSON.stringify(patch.metadata.original_ai_output) : JSON.stringify(patch.patch_body);
        const patchEmbedding = await this._getEmbedding(originalText);

        if (!patchEmbedding) continue;

        const similarity = this._cosineSimilarity(embedding, patchEmbedding);
        if (similarity > highestSimilarity && similarity >= threshold) {
          highestSimilarity = similarity;
          bestMatch = {
            ...this._shape(patch),
            similarity,
            matchType: 'js_cosine'
          };
        }
      }
      if (bestMatch) return bestMatch;
    }

    // Path 3: Sovereign Local Semantic Similarity (Pure JS Fallback when models/networks are offline)
    if (!embedding) {
      // [FIX-V26-PATCH] was: console.log('[SemanticPatchEngine] Embeddings offline. Invoking Sovereign Local Semantic Cosine Similarity...')
      this._log.info({ component: 'semantic-patch', path: 'local_semantic_cosine' }, 'Embeddings offline — invoking Sovereign Local Semantic Cosine Similarity');
      let bestMatch = null;
      let highestSimilarity = 0;

      for (const patch of patches) {
        const originalText = patch.metadata?.original_ai_output ? JSON.stringify(patch.metadata.original_ai_output) : JSON.stringify(patch.patch_body);
        const similarity = this._calculateLocalSemanticSimilarity(serializedOutput, originalText);
        
        if (similarity > highestSimilarity && similarity >= threshold) {
          highestSimilarity = similarity;
          bestMatch = {
            ...this._shape(patch),
            similarity,
            matchType: 'local_semantic_cosine'
          };
        }
      }
      if (bestMatch) return bestMatch;
    }

    // Path 4: Keyword overlap fallback (similarityKeys)
    if (similarityKeys && similarityKeys.length > 0) {
      let bestMatch = null;
      let highestOverlap = 0;

      for (const patch of patches) {
        const patchKeys = patch.similarity_keys || [];
        const overlap = patchKeys.filter(k => similarityKeys.includes(k)).length;
        if (overlap > highestOverlap) {
          highestOverlap = overlap;
          bestMatch = {
            ...this._shape(patch),
            matchType: 'keyword_overlap',
            overlapCount: overlap
          };
        }
      }
      if (bestMatch && highestOverlap > 0) return bestMatch;
    }

    // Path 5: Global popular fallback
    const sortedPatches = patches.slice().sort((a, b) => b.reuse_count - a.reuse_count);
    return {
      ...this._shape(sortedPatches[0]),
      matchType: 'popular_fallback'
    };
  }

  /**
   * Pure JS Bag-of-Words Cosine Similarity Engine.
   * Tokenizes text, strips formatting, builds frequency vectors, and calculates alignment.
   */
  _calculateLocalSemanticSimilarity(textA, textB) {
    const tokenize = (t) => {
      return t.toLowerCase()
              .replace(/[{}[\]":,\n\r\t]/g, ' ')
              .split(/\s+/)
              .filter(w => w.length > 1);
    };
    const tokensA = tokenize(textA);
    const tokensB = tokenize(textB);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    
    const mapA = {};
    const mapB = {};
    const uniqueWords = new Set();
    
    tokensA.forEach(w => { mapA[w] = (mapA[w] || 0) + 1; uniqueWords.add(w); });
    tokensB.forEach(w => { mapB[w] = (mapB[w] || 0) + 1; uniqueWords.add(w); });
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    uniqueWords.forEach(w => {
      const valA = mapA[w] || 0;
      const valB = mapB[w] || 0;
      dotProduct += valA * valB;
    });
    
    Object.values(mapA).forEach(val => { normA += val * val; });
    Object.values(mapB).forEach(val => { normB += val * val; });
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  _shape(r) {
    const { microcentsToUsdString } = require('./fiatLedger');
    return {
      id: r.id,
      patchBody: r.patch_body,
      validatorId: r.validator_id,
      rewardPerReuse: r.reward_per_reuse,
      reuseCount: r.reuse_count,
      earnedUsd: microcentsToUsdString(BigInt(r.earned_micro || 0))
    };
  }
}

const _singleton = new SemanticPatchEngine();
module.exports = _singleton;
