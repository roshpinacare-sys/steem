'use strict';
/**
 * src/lib/sovereignModelServer416.js — ECOS V416 (Phase P304) — Sovereign Model Serving
 *
 * V416 introduces a sovereign-by-default model routing layer:
 *   - Local-first (Ollama / vLLM OpenAI-compatible) is the primary backend
 *   - External providers (OpenAI, Anthropic, etc.) are explicitly opt-in only
 *   - Per-user vector store — no shared index between users
 *   - SecretScrubber416 — secrets/API keys/tokens never leak into prompts
 *
 * All identifiers end in 416 (R2). No new npm dependencies (R3).
 * Sacred files fiatLedger.js + auditLog.js untouched (R1).
 *
 * @version 416.0.0
 */

const crypto = require('crypto');

const SOVEREIGN_VERSION_416 = '416.0.0';

// ── SecretScrubber416 ─────────────────────────────────────────────────────────
// Strips secrets (API keys, tokens, passwords) from any prompt string before
// it is sent to any model backend. Sovereign guarantee: never expose secrets.

const _SECRET_PATTERNS_416 = [
  { name: 'api_key',      re: /\b(sk|pk|api_key|apikey|api-key)\s*[:=]\s*\S+/gi },
  { name: 'bearer_token', re: /bearer\s+[A-Za-z0-9\-_./=+]{10,}/gi },
  { name: 'jwt',          re: /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'hex_secret',   re: /\b[0-9a-f]{32,64}\b/gi },
  { name: 'password',     re: /\bpassword\s*[:=]\s*\S+/gi },
  { name: 'secret',       re: /\bsecret\s*[:=]\s*\S+/gi },
];

function scrubSecrets416(text) {
  let t = String(text || '');
  for (const p of _SECRET_PATTERNS_416) {
    t = t.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return t;
}

function hasSensitiveContent416(text) {
  const t = String(text || '');
  return _SECRET_PATTERNS_416.some(p => { p.re.lastIndex = 0; return p.re.test(t); });
}

// ── PerUserVectorStore416 ─────────────────────────────────────────────────────
// In-memory per-user vector store. Each user gets their own isolated namespace.
// No shared index — data from user A is never visible to user B.
// Vectors are simple float arrays; similarity is cosine distance.

class PerUserVectorStore416 {
  constructor(opts = {}) {
    this._stores   = new Map();   // userId → [ {id, vector, payload, ts} ]
    this._maxPerUser416 = opts.maxPerUser || 10000;
    this._maxUsers416   = opts.maxUsers   || 5000;
  }

  _userStore(userId) {
    if (!this._stores.has(userId)) {
      if (this._stores.size >= this._maxUsers416) {
        // evict the oldest user (insertion order)
        const oldest = this._stores.keys().next().value;
        this._stores.delete(oldest);
      }
      this._stores.set(userId, []);
    }
    return this._stores.get(userId);
  }

  upsert416(userId, id, vector, payload = {}) {
    if (!userId || !id || !Array.isArray(vector)) throw new Error('userId, id, vector required');
    const store = this._userStore(userId);
    const existing = store.findIndex(e => e.id === id);
    const entry = { id, vector, payload, ts: Date.now(), userId };
    if (existing >= 0) { store[existing] = entry; }
    else {
      if (store.length >= this._maxPerUser416) store.shift(); // ring
      store.push(entry);
    }
    return { ok: true, id, userId };
  }

  search416(userId, queryVector, topK = 5) {
    if (!userId || !Array.isArray(queryVector)) throw new Error('userId and queryVector required');
    const store = this._stores.get(userId) || [];
    if (store.length === 0) return [];
    const scored = store.map(entry => ({
      id:      entry.id,
      payload: entry.payload,
      score:   _cosineSim416(queryVector, entry.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  delete416(userId, id) {
    const store = this._stores.get(userId);
    if (!store) return { ok: false, reason: 'user not found' };
    const idx = store.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, reason: 'entry not found' };
    store.splice(idx, 1);
    return { ok: true, id, userId };
  }

  stats416(userId) {
    const store = this._stores.get(userId) || [];
    return { userId, count: store.length, maxPerUser: this._maxPerUser416 };
  }

  globalStats416() {
    return { totalUsers: this._stores.size, maxUsers: this._maxUsers416 };
  }
}

function _cosineSim416(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── SovereignRouter416 ────────────────────────────────────────────────────────
// Routes model queries sovereign-first (local Ollama/vLLM) with external
// providers as explicitly opt-in only.
//
// Backend registry:
//   { id, type: 'local'|'external', baseUrl, model, enabled, requiresOptIn }
//
// Routing logic:
//   1. Filter to enabled backends
//   2. Prefer 'local' unless caller explicitly opts in to external
//   3. If no local available and caller opted in → use first available external
//   4. If no backends available → return { ok:false, reason:'no_backend' }

const _DEFAULT_BACKENDS_416 = [
  {
    id: 'ollama_local',
    type: 'local',
    baseUrl: 'http://localhost:11434',
    model: 'llama3',
    enabled: true,
    requiresOptIn: false,
    description: 'Local Ollama instance (sovereign default)',
  },
  {
    id: 'vllm_local',
    type: 'local',
    baseUrl: 'http://localhost:8000',
    model: 'mistral-7b',
    enabled: false,
    requiresOptIn: false,
    description: 'Local vLLM instance (OpenAI-compatible)',
  },
  {
    id: 'openai_external',
    type: 'external',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    enabled: false,
    requiresOptIn: true,
    description: 'OpenAI API (external, opt-in only)',
  },
  {
    id: 'anthropic_external',
    type: 'external',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    enabled: false,
    requiresOptIn: true,
    description: 'Anthropic API (external, opt-in only)',
  },
];

class SovereignRouter416 {
  constructor(opts = {}) {
    this._backends416 = JSON.parse(JSON.stringify(opts.backends || _DEFAULT_BACKENDS_416));
    this._scrubber416 = opts.scrubber || scrubSecrets416;
    this._auditLog416 = []; // ring, max 1000
    this._auditLimit416 = 1000;
  }

  _recordAudit416(event) {
    if (this._auditLog416.length >= this._auditLimit416) this._auditLog416.shift();
    this._auditLog416.push(Object.assign({ ts: Date.now() }, event));
  }

  /**
   * Resolve which backend to use for a given query.
   * @param {object} opts
   * @param {boolean} [opts.allowExternal] — caller explicitly opts in to external
   * @param {string}  [opts.preferBackendId] — prefer a specific backend id
   * @returns {{ ok, backend, reason }}
   */
  resolveBackend416(opts = {}) {
    const allowExt = Boolean(opts.allowExternal);
    const preferId = opts.preferBackendId || null;
    const enabled  = this._backends416.filter(b => b.enabled);

    if (preferId) {
      const b = enabled.find(b => b.id === preferId);
      if (b) {
        if (b.requiresOptIn && !allowExt) {
          return { ok: false, reason: 'external_opt_in_required', backendId: preferId };
        }
        return { ok: true, backend: b };
      }
    }

    // local first
    const local = enabled.filter(b => b.type === 'local');
    if (local.length > 0) return { ok: true, backend: local[0] };

    // external only if explicitly opted in
    if (allowExt) {
      const ext = enabled.filter(b => b.type === 'external' && !b.requiresOptIn === false);
      if (ext.length > 0) return { ok: true, backend: ext[0] };
    }

    return { ok: false, reason: 'no_backend_available' };
  }

  /**
   * "Send" a query through the sovereign pipeline (scrub → resolve → simulate).
   * In production this would make an HTTP call to the backend.
   * In test/offline mode it returns a mock response.
   *
   * @param {object} p
   * @param {string}  p.prompt
   * @param {string}  p.userId
   * @param {boolean} [p.allowExternal]
   * @param {string}  [p.preferBackendId]
   * @returns {object} SovereignQueryResult416
   */
  query416(p = {}) {
    const raw   = String(p.prompt || '');
    const userId = String(p.userId || 'anonymous');

    // R1-compliant: secrets never in prompts
    const scrubbed = this._scrubber416(raw);
    const wasScrubbede = scrubbed !== raw;

    const resolved = this.resolveBackend416({
      allowExternal:   p.allowExternal,
      preferBackendId: p.preferBackendId,
    });

    const queryId416 = 'query416_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

    this._recordAudit416({
      type: 'sovereign.query416',
      queryId: queryId416,
      userId,
      backendId: resolved.ok ? resolved.backend.id : null,
      backendType: resolved.ok ? resolved.backend.type : null,
      wasScrubbedSecret: wasScrubbede,
      resolved: resolved.ok,
      reason: resolved.ok ? null : resolved.reason,
    });

    if (!resolved.ok) {
      return {
        ok: false, queryId: queryId416, userId,
        reason: resolved.reason,
        sovereignVersion: SOVEREIGN_VERSION_416,
        secretsScrubbed: wasScrubbede,
      };
    }

    const backend = resolved.backend;

    // Offline-safe: simulate response (no actual HTTP call in this module)
    const simulatedResponse = `[Sovereign:${backend.id}] Response to: ${scrubbed.slice(0, 60)}`;

    return {
      ok: true,
      queryId: queryId416,
      userId,
      backend: { id: backend.id, type: backend.type, model: backend.model },
      prompt: scrubbed,
      response: simulatedResponse,
      secretsScrubbed: wasScrubbede,
      sovereignVersion: SOVEREIGN_VERSION_416,
    };
  }

  /** Enable or disable a backend at runtime */
  setBackendEnabled416(id, enabled) {
    const b = this._backends416.find(b => b.id === id);
    if (!b) return { ok: false, reason: 'backend_not_found' };
    b.enabled = Boolean(enabled);
    return { ok: true, id, enabled: b.enabled };
  }

  /** Register a new backend (must not be opt-in external by default) */
  registerBackend416(config) {
    if (!config.id || !config.type || !config.baseUrl) {
      throw new Error('Backend config requires id, type, baseUrl');
    }
    const existing = this._backends416.findIndex(b => b.id === config.id);
    const entry = Object.assign({ enabled: false, requiresOptIn: false, model: 'default' }, config);
    if (existing >= 0) this._backends416[existing] = entry;
    else this._backends416.push(entry);
    return { ok: true, id: config.id };
  }

  summary416() {
    const enabled = this._backends416.filter(b => b.enabled);
    const local   = enabled.filter(b => b.type === 'local');
    const ext     = enabled.filter(b => b.type === 'external');
    return {
      sovereignVersion: SOVEREIGN_VERSION_416,
      totalBackends:   this._backends416.length,
      enabledBackends: enabled.length,
      localBackends:   local.length,
      externalBackends: ext.length,
      sovereign: local.length > 0,
      auditEntries: this._auditLog416.length,
      backends: this._backends416.map(b => ({
        id: b.id, type: b.type, enabled: b.enabled, requiresOptIn: b.requiresOptIn, model: b.model,
      })),
    };
  }

  auditLog416(limit = 50) {
    return this._auditLog416.slice(-limit);
  }
}

// ── default singletons ────────────────────────────────────────────────────────

let _defaultRouter416 = null;
function defaultSovereignRouter416() {
  if (!_defaultRouter416) _defaultRouter416 = new SovereignRouter416();
  return _defaultRouter416;
}

let _defaultVectorStore416 = null;
function defaultVectorStore416() {
  if (!_defaultVectorStore416) _defaultVectorStore416 = new PerUserVectorStore416();
  return _defaultVectorStore416;
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SOVEREIGN_VERSION_416,
  SovereignRouter416,
  PerUserVectorStore416,
  scrubSecrets416,
  hasSensitiveContent416,
  defaultSovereignRouter416,
  defaultVectorStore416,
  // exported for tests
  _cosineSim416,
  _DEFAULT_BACKENDS_416,
};
