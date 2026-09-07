/**
 * src/lib/discoverTools237.js — ECOS Semantic Tool Discovery (P129)
 * ------------------------------------------------------------
 * Implements semantic search over the Tool Catalog.
 * Leverages semanticPatchEngine's Pure JS TF-IDF / Bag-of-Words similarity calculations
 * to avoid inventing new embedding logic and to guarantee robust offline fallback.
 * Integrates with defaultAuditLog for auditing each discovery request.
 * Zero new npm dependencies. Identifiers end with 237.
 */

'use strict';

const { defaultCatalog237 } = require('./toolCatalog237');
const { defaultAuditLog } = require('./auditLog');

// Stop-words filtered out before TF-IDF scoring
const STOP_WORDS_237 = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
]);

/**
 * Tokenize text for TF-IDF: lowercase, strip punctuation,
 * split on whitespace, remove stop-words.
 */
function simpleTokenize237(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOP_WORDS_237.has(w));
}

/**
 * Compute cosine similarity between two TF vectors (plain objects).
 */
function cosineTf237(tfA, tfB) {
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
 */
function buildTf237(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

/**
 * Perform semantic tool discovery over the registered catalog.
 * Uses local TF-IDF on tool names and descriptions.
 * Logs the query and metadata to the audit log.
 * 
 * @param {string} queryText - The search query (e.g. 'find weather in London')
 * @param {object} [opts]
 * @param {number} [opts.limit=5] - Maximum number of results
 * @param {number} [opts.minScore=0.1] - Minimum cosine similarity score threshold
 * @param {string} [opts.userId] - The user requesting discovery (for audit)
 * @returns {Promise<Array<object>>} Matched tools with scores
 */
async function discoverTools237(queryText, opts = {}) {
  const limit = Math.max(1, Math.min(opts.limit || 5, 50));
  const minScore = Math.max(0, Math.min(opts.minScore !== undefined ? opts.minScore : 0.1, 1));
  const userId = opts.userId || null;

  const queryTokens = simpleTokenize237(queryText);
  const queryTf = buildTf237(queryTokens);

  const tools = defaultCatalog237.listTools237();
  const scored = [];

  for (const t of tools) {
    // Combine name and description for richer semantic matching
    const toolText = `${t.name} ${t.description}`;
    const toolTokens = simpleTokenize237(toolText);
    const toolTf = buildTf237(toolTokens);

    const score = cosineTf237(queryTf, toolTf);
    if (score >= minScore) {
      scored.push({
        tool: t,
        score: parseFloat(score.toFixed(4))
      });
    }
  }

  // Sort by score descending, then by name alphabetically
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tool.name.localeCompare(b.tool.name);
  });

  const results = scored.slice(0, limit);

  // Cryptographically audit the discovery event (no secrets logged)
  try {
    defaultAuditLog.append('TOOL_DISCOVERY', {
      query: queryText,
      userId,
      resultsCount: results.length,
      matchedTools: results.map(r => ({ name: r.tool.name, score: r.score }))
    });
  } catch (err) {
    console.error('[discoverTools237] Failed to append to audit log:', err.message);
  }

  return results;
}

module.exports = {
  discoverTools237,
  simpleTokenize237,
  cosineTf237,
  buildTf237
};
