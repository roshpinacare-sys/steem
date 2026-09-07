'use strict';
/**
 * ECOS Embedding Provider — V106
 * ──────────────────────────────────────────────────────────────────────────────
 * Real embedding provider abstraction replacing heuristicEmbed() in
 * memorySubstrate.js.
 *
 * Provider priority:
 *   1. EMBEDDING_PROVIDER env var: 'ollama' | 'openai' | 'openai-compat' | 'heuristic'
 *   2. If OPENAI_API_KEY set → OpenAI text-embedding-3-small (1536-dim)
 *   3. If LOCAL_LLM_URL set → Ollama nomic-embed-text (768-dim)
 *   4. Fallback: heuristicEmbed (64-dim, NOT semantic — logs WARNING)
 *
 * Implements EmbeddingProvider interface:
 *   embed(text): Promise<number[]>
 *   get dimensions(): number
 *   get providerId(): string
 *   get isReal(): boolean  — false if heuristic fallback is active
 *
 * Usage:
 *   const { defaultEmbeddingProvider } = require('./embeddingProvider');
 *   const vector = await defaultEmbeddingProvider.embed('some text');
 *
 *   // Inject into MemorySubstrate:
 *   memory.setEmbedFn(text => defaultEmbeddingProvider.embed(text));
 *
 * Migration:
 *   Existing entries stored with heuristicEmbed have embeddingType: 'heuristic'
 *   and CANNOT be semantically compared to entries stored with real embeddings.
 *   See db/migration_phase5.sql for re-embedding migration path.
 */

const crypto = require('node:crypto');

// ── Heuristic fallback (V104 legacy — NOT semantic) ───────────────────────────
function heuristicEmbed(text, dimensions = 64) {
  const hash = crypto.createHash('sha256').update(text || '').digest();
  const vec  = [];
  for (let i = 0; i < dimensions; i++) {
    const byte = hash[i % 32];
    vec.push((byte - 128) / 128);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

// ── Base class ─────────────────────────────────────────────────────────────────
class EmbeddingProvider {
  get providerId()  { return 'base'; }
  get dimensions()  { return 0; }
  get isReal()      { return true; }

  // eslint-disable-next-line no-unused-vars
  async embed(_text) { throw new Error('embed() must be implemented by subclass'); }
}

// ── HeuristicEmbeddingProvider (64-dim SHA256 fallback) ───────────────────────
class HeuristicEmbeddingProvider extends EmbeddingProvider {
  get providerId()  { return 'heuristic'; }
  get dimensions()  { return 64; }
  get isReal()      { return false; }

  async embed(text) {
    return heuristicEmbed(text, 64);
  }
}

// ── OllamaEmbeddingProvider ────────────────────────────────────────────────────
class OllamaEmbeddingProvider extends EmbeddingProvider {
  constructor(opts = {}) {
    super();
    this._baseUrl = opts.baseUrl || process.env.LOCAL_LLM_URL || 'http://localhost:11434';
    this._model   = opts.model   || process.env.EMBEDDING_MODEL || 'nomic-embed-text';
    this._dims    = opts.dimensions || 768;
    this._log     = opts.logger || { warn: () => {}, info: () => {}, error: () => {} };
  }

  get providerId()  { return `ollama:${this._model}`; }
  get dimensions()  { return this._dims; }
  get isReal()      { return true; }

  async embed(text) {
    const resp = await fetch(`${this._baseUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this._model, prompt: text || '' }),
    });
    if (!resp.ok) {
      throw new Error(`Ollama embed ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error('Ollama embed: empty embedding returned');
    }
    // Update dims based on actual response
    this._dims = data.embedding.length;
    return data.embedding;
  }
}

// ── OpenAIEmbeddingProvider ────────────────────────────────────────────────────
class OpenAIEmbeddingProvider extends EmbeddingProvider {
  constructor(opts = {}) {
    super();
    this._baseUrl  = opts.baseUrl  || 'https://api.openai.com';
    this._apiKey   = opts.apiKey   || process.env.OPENAI_API_KEY || '';
    this._model    = opts.model    || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    this._dims     = opts.dimensions || 1536;
    this._log      = opts.logger || { warn: () => {}, info: () => {}, error: () => {} };
  }

  get providerId()  { return `openai:${this._model}`; }
  get dimensions()  { return this._dims; }
  get isReal()      { return true; }

  async embed(text) {
    const resp = await fetch(`${this._baseUrl}/v1/embeddings`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({ input: text || '', model: this._model }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI embed ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    const vec  = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error('OpenAI embed: no embedding in response');
    }
    this._dims = vec.length;
    return vec;
  }
}

// ── EmbeddingProviderWithCache ─────────────────────────────────────────────────
// In-memory LRU cache to avoid re-embedding identical strings.
class EmbeddingProviderWithCache extends EmbeddingProvider {
  constructor(inner, opts = {}) {
    super();
    this._inner    = inner;
    this._maxSize  = opts.cacheSize || 2000;
    this._cache    = new Map();  // text → vector
    this._order    = [];
  }

  get providerId()  { return this._inner.providerId; }
  get dimensions()  { return this._inner.dimensions; }
  get isReal()      { return this._inner.isReal; }

  async embed(text) {
    const key = text || '';
    if (this._cache.has(key)) {
      // Move to end (LRU: recently used = keep)
      const idx = this._order.indexOf(key);
      if (idx !== -1) this._order.splice(idx, 1);
      this._order.push(key);
      return this._cache.get(key);
    }

    const vec = await this._inner.embed(key);
    // Evict oldest if full
    if (this._cache.size >= this._maxSize) {
      const evict = this._order.shift();
      this._cache.delete(evict);
    }
    this._cache.set(key, vec);
    this._order.push(key);
    return vec;
  }

  cacheStats() {
    return { size: this._cache.size, maxSize: this._maxSize };
  }

  clearCache() {
    this._cache.clear();
    this._order = [];
  }
}

// ── FallbackEmbeddingProvider ──────────────────────────────────────────────────
// Tries a chain of providers, falls back to heuristic on failure.
class FallbackEmbeddingProvider extends EmbeddingProvider {
  constructor(providers, opts = {}) {
    super();
    this._providers = providers;  // ordered: try first, then fallback
    this._log       = opts.logger || { warn: () => {}, info: () => {}, error: () => {} };
    this._active    = null;       // resolved after first successful embed
  }

  get providerId()  { return this._active ? this._active.providerId : 'unresolved'; }
  get dimensions()  { return this._active ? this._active.dimensions : 64; }
  get isReal()      { return this._active ? this._active.isReal : false; }

  async embed(text) {
    // If we have a stable active provider, use it directly
    if (this._active && this._active.isReal) {
      try {
        return await this._active.embed(text);
      } catch (err) {
        this._log.warn({ err: err.message, provider: this._active.providerId },
          '[EmbeddingProvider] Active provider failed, trying fallback chain');
        this._active = null;
      }
    }

    // Try each provider in order
    for (const provider of this._providers) {
      try {
        const vec = await provider.embed(text);
        if (!this._active || !this._active.isReal) {
          this._active = provider;
          this._log.info({ provider: provider.providerId, dims: provider.dimensions },
            '[EmbeddingProvider] Provider resolved');
        }
        return vec;
      } catch (err) {
        this._log.warn({ err: err.message, provider: provider.providerId },
          '[EmbeddingProvider] Provider failed, trying next');
      }
    }

    // All real providers failed — fall to heuristic
    const fallback = new HeuristicEmbeddingProvider();
    this._log.warn(
      { component: 'embeddingProvider' },
      '[EmbeddingProvider] WARNING: All real providers failed. ' +
      'Using heuristicEmbed — semantic retrieval is NOT functional. ' +
      'Configure OPENAI_API_KEY or LOCAL_LLM_URL to enable real embeddings.'
    );
    this._active = fallback;
    return fallback.embed(text);
  }
}

// ── Factory: build default provider from environment ──────────────────────────

function buildDefaultProvider(opts = {}) {
  const explicit = (process.env.EMBEDDING_PROVIDER || '').toLowerCase();
  const log      = opts.logger || { warn: () => {}, info: () => {}, error: () => {} };

  if (explicit === 'heuristic') {
    log.warn({ component: 'embeddingProvider' },
      '[EmbeddingProvider] EMBEDDING_PROVIDER=heuristic — semantic memory is disabled');
    return new HeuristicEmbeddingProvider();
  }

  if (explicit === 'ollama' || (explicit === '' && process.env.LOCAL_LLM_URL && !process.env.OPENAI_API_KEY)) {
    const inner = new OllamaEmbeddingProvider({ logger: log });
    return new EmbeddingProviderWithCache(inner);
  }

  if (explicit === 'openai' || explicit === 'openai-compat' || (explicit === '' && process.env.OPENAI_API_KEY)) {
    const baseUrl = explicit === 'openai-compat'
      ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com')
      : 'https://api.openai.com';
    const inner = new OpenAIEmbeddingProvider({ baseUrl, logger: log });
    return new EmbeddingProviderWithCache(inner);
  }

  // No explicit config — try Ollama then OpenAI then heuristic
  const chain = [];
  if (process.env.LOCAL_LLM_URL) chain.push(new OllamaEmbeddingProvider({ logger: log }));
  if (process.env.OPENAI_API_KEY) chain.push(new OpenAIEmbeddingProvider({ logger: log }));
  chain.push(new HeuristicEmbeddingProvider());

  return new EmbeddingProviderWithCache(
    new FallbackEmbeddingProvider(chain, { logger: log }),
    { cacheSize: 2000 }
  );
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const defaultEmbeddingProvider = buildDefaultProvider();

module.exports = {
  EmbeddingProvider,
  HeuristicEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  EmbeddingProviderWithCache,
  FallbackEmbeddingProvider,
  buildDefaultProvider,
  defaultEmbeddingProvider,
  heuristicEmbed,
};
