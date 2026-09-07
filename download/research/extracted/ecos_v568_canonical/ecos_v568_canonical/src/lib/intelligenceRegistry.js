'use strict';
  /**
   * ECOS Intelligence Registry — V104 — Phase 1
   * ─────────────────────────────────────────────────────────────────────────────
   * Canonical sovereign intelligence abstraction layer.
   *
   * Implements IntelligenceProvider interface:
   *   infer(prompt, opts)   → { output, confidence, latencyMs, provider, tokens }
   *   stream(prompt, opts)  → AsyncIterable<chunk>
   *   embed(text)           → { vector: number[], provider, dimensions }
   *   moderate(text)        → { safe: boolean, flags: string[], provider }
   *   tokenize(text)        → { tokens: number, provider }
   *   estimate(text, opts)  → { costUsd: number, tokens: number, provider }
   *
   * Provider registry: register any number of IntelligenceProvider implementations.
   * Routing policies:
   *   'latency'    — pick fastest provider based on rolling avg latency
   *   'cost'       — pick cheapest provider
   *   'confidence' — pick provider with highest avg confidence
   *   'primary'    — always use the primary registered provider
   *
   * Supports: Ollama, vLLM, llama.cpp (OpenAI-compat), OpenAI, Anthropic, DeepSeek.
   * External providers are OPTIONAL adapters — core logic owns no vendor dep.
   *
   * Fallback orchestration:
   *   If primary fails, cascade through registered providers in priority order.
   *   Records all attempts in deterministic trace log.
   *
   * Token accounting: per-provider, per-call, cumulative totals.
   */

  const { offlineInference } = (() => {
    try { return require('./offlineInference'); } catch { return { offlineInference: null }; }
  })();

  // ── Provider capability constants ─────────────────────────────────────────────
  const CAPABILITIES = Object.freeze({
    INFER:    'infer',
    STREAM:   'stream',
    EMBED:    'embed',
    MODERATE: 'moderate',
  });

  const ROUTING_POLICIES = Object.freeze({
    LATENCY:    'latency',
    COST:       'cost',
    CONFIDENCE: 'confidence',
    PRIMARY:    'primary',
  });

  // ── Built-in provider adapters ────────────────────────────────────────────────

  /**
   * Wraps the existing OfflineInferenceService as an IntelligenceProvider.
   * Supports: ollama, openai-compat, anthropic, deepseek, synthetic.
   */
  class EcosOfflineAdapter {
    get id()           { return 'ecos-offline'; }
    get capabilities() { return [CAPABILITIES.INFER]; }
    get costPerToken() { return 0.0; }   // local = free

    async infer(systemPrompt, userPrompt, _opts = {}) {
      const svc = require('./offlineInference');
      const start = Date.now();
      const result = await svc.executeTask(systemPrompt, userPrompt);
      return {
        output:     result.aiOutput,
        confidence: result.confidence ?? 0.5,
        latencyMs:  Date.now() - start,
        provider:   this.id,
        tokens:     this._estimateTokens(systemPrompt + userPrompt),
      };
    }

    async embed(_text)    { throw new Error('embed not supported by ecos-offline adapter'); }
    async moderate(_text) { throw new Error('moderate not supported by ecos-offline adapter'); }
    async stream(_sys, _usr) { throw new Error('streaming requires a native streaming adapter'); }
    tokenize(text)  { return { tokens: this._estimateTokens(text), provider: this.id }; }
    estimate(text)  { return { costUsd: 0, tokens: this._estimateTokens(text), provider: this.id }; }

    _estimateTokens(text) { return Math.ceil((text || '').length / 4); }
  }

  /**
   * OpenAI-compatible HTTP adapter.
   * Works with: OpenAI, vLLM, llama.cpp server, LM Studio, Ollama /v1 endpoint.
   */
  class OpenAICompatAdapter {
    constructor(opts = {}) {
      this._id        = opts.id       || 'openai-compat';
      this._baseUrl   = opts.baseUrl  || 'https://api.openai.com';
      this._apiKey    = opts.apiKey   || process.env.OPENAI_API_KEY || '';
      this._model     = opts.model    || 'gpt-4o-mini';
      this._costPer1k = opts.costPer1kTokens || 0.0003;  // USD per 1k tokens
    }

    get id()           { return this._id; }
    get capabilities() { return [CAPABILITIES.INFER, CAPABILITIES.STREAM, CAPABILITIES.EMBED]; }
    get costPerToken() { return this._costPer1k / 1000; }

    async infer(systemPrompt, userPrompt, opts = {}) {
      const start = Date.now();
      const resp  = await fetch(`${this._baseUrl}/v1/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._apiKey}` },
        body:    JSON.stringify({
          model:       opts.model || this._model,
          messages:    [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ],
          temperature: opts.temperature ?? 0.3,
          logprobs:    true,
          top_logprobs: 5,
        }),
      });
      if (!resp.ok) throw new Error(`OpenAI-compat ${resp.status}: ${await resp.text()}`);
      const data   = await resp.json();
      const choice = data.choices?.[0];
      const tokens = data.usage?.total_tokens || this._estimateTokens(systemPrompt + userPrompt);
      const logprobs = choice?.logprobs?.content;
      const confidence = logprobs ? this._computeConfidence(logprobs) : 0.7;
      return {
        output:     { result: choice?.message?.content || '' },
        confidence,
        latencyMs:  Date.now() - start,
        provider:   this.id,
        tokens,
        model:      opts.model || this._model,
      };
    }

    async embed(text) {
      const resp = await fetch(`${this._baseUrl}/v1/embeddings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._apiKey}` },
        body:    JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
      });
      if (!resp.ok) throw new Error(`embed ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      const vec  = data.data?.[0]?.embedding || [];
      return { vector: vec, provider: this.id, dimensions: vec.length };
    }

    async moderate(text) {
      const resp = await fetch(`${this._baseUrl}/v1/moderations`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._apiKey}` },
        body:    JSON.stringify({ input: text }),
      });
      if (!resp.ok) throw new Error(`moderate ${resp.status}: ${await resp.text()}`);
      const data    = await resp.json();
      const result  = data.results?.[0] || {};
      const flags   = Object.entries(result.categories || {}).filter(([, v]) => v).map(([k]) => k);
      return { safe: !result.flagged, flags, provider: this.id };
    }

    tokenize(text)  { return { tokens: this._estimateTokens(text), provider: this.id }; }
    estimate(text, opts = {}) {
      const tokens = this._estimateTokens(text);
      return { costUsd: tokens * this.costPerToken, tokens, provider: this.id };
    }

    _computeConfidence(logprobs) {
      if (!Array.isArray(logprobs) || logprobs.length === 0) return 0.7;
      const sum = logprobs.reduce((s, lp) => s + (lp.logprob || 0), 0);
      const avg = sum / logprobs.length;
      return Math.max(0, Math.min(1, 1 / (1 + Math.exp(-avg))));
    }

    _estimateTokens(text) { return Math.ceil((text || '').length / 4); }
  }

  /**
   * Anthropic adapter — /v1/messages endpoint.
   */
  class AnthropicAdapter {
    constructor(opts = {}) {
      this._id        = opts.id      || 'anthropic';
      this._apiKey    = opts.apiKey  || process.env.ANTHROPIC_API_KEY || '';
      this._model     = opts.model   || 'claude-3-haiku-20240307';
      this._costPer1k = opts.costPer1kTokens || 0.00025;
    }

    get id()           { return this._id; }
    get capabilities() { return [CAPABILITIES.INFER]; }
    get costPerToken() { return this._costPer1k / 1000; }

    async infer(systemPrompt, userPrompt, opts = {}) {
      const start = Date.now();
      const resp  = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         this._apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      opts.model || this._model,
          max_tokens: opts.maxTokens || 1024,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
      const data    = await resp.json();
      const text    = data.content?.[0]?.text || '';
      const tokens  = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
      const confidence = this._heuristicConfidence(text);
      return {
        output: { result: text }, confidence,
        latencyMs: Date.now() - start,
        provider: this.id, tokens,
      };
    }

    async embed(_text)    { throw new Error('Anthropic does not provide embeddings'); }
    async moderate(_text) { throw new Error('Anthropic does not provide moderation endpoint'); }
    tokenize(text)  { return { tokens: Math.ceil((text || '').length / 4), provider: this.id }; }
    estimate(text)  { const t = Math.ceil((text||'').length/4); return { costUsd: t * this.costPerToken, tokens: t, provider: this.id }; }

    _heuristicConfidence(text) {
      // Text-richness heuristic. Calibrated in V104 per BUG-C improvement.
      const len    = (text || '').length;
      const words  = (text || '').split(/\s+/).length;
      const hasJSON = /\{.*\}/.test(text);
      let score = 0.52;
      if (len   > 200) score += 0.10;
      if (len   > 500) score += 0.08;
      if (words > 50)  score += 0.06;
      if (hasJSON)     score += 0.08;
      return Math.min(0.84, score);
    }
  }

  // ── IntelligenceRegistry ──────────────────────────────────────────────────────

  class IntelligenceRegistry {
    constructor() {
      // Map<id, { provider, priority: number, stats: ProviderStats }>
      this._providers   = new Map();
      this._policy      = ROUTING_POLICIES.PRIMARY;
      this._traces      = [];          // deterministic call traces
      this._maxTraces   = 500;
      this._log         = { info: () => {}, warn: () => {}, error: () => {} };
    }

    setLogger(logger) { if (logger && typeof logger.info === 'function') this._log = logger; }
    setPolicy(policy) {
      if (!Object.values(ROUTING_POLICIES).includes(policy)) throw new Error(`Unknown policy: ${policy}`);
      this._policy = policy;
    }

    // ── Provider management ──────────────────────────────────────────────────────

    register(provider, priority = 0) {
      if (!provider || !provider.id) throw new Error('provider.id is required');
      this._providers.set(provider.id, {
        provider,
        priority,
        stats: { calls: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0, totalCostUsd: 0, avgConfidence: 0 },
      });
      this._log.info({ component: 'intelligenceRegistry', providerId: provider.id, priority }, '[Registry] provider registered');
    }

    unregister(id) { this._providers.delete(id); }

    listProviders() {
      return Array.from(this._providers.values()).map(e => ({
        id:       e.provider.id,
        priority: e.priority,
        capabilities: e.provider.capabilities || [],
        stats:    { ...e.stats },
      }));
    }

    // ── Routing ──────────────────────────────────────────────────────────────────

    _selectProvider(capability) {
      const eligible = Array.from(this._providers.values())
        .filter(e => !e.provider.capabilities || e.provider.capabilities.includes(capability));
      if (eligible.length === 0) throw new Error(`No provider registered for capability: ${capability}`);

      if (this._policy === ROUTING_POLICIES.PRIMARY) {
        return eligible.sort((a, b) => b.priority - a.priority)[0];
      }
      if (this._policy === ROUTING_POLICIES.LATENCY) {
        return eligible.sort((a, b) => {
          const la = a.stats.calls ? a.stats.totalLatencyMs / a.stats.calls : Infinity;
          const lb = b.stats.calls ? b.stats.totalLatencyMs / b.stats.calls : Infinity;
          return la - lb;
        })[0];
      }
      if (this._policy === ROUTING_POLICIES.COST) {
        return eligible.sort((a, b) =>
          (a.provider.costPerToken || 0) - (b.provider.costPerToken || 0)
        )[0];
      }
      if (this._policy === ROUTING_POLICIES.CONFIDENCE) {
        return eligible.sort((a, b) => b.stats.avgConfidence - a.stats.avgConfidence)[0];
      }
      return eligible[0];
    }

    _record(entry) {
      this._traces.push(entry);
      if (this._traces.length > this._maxTraces) this._traces.shift();
    }

    _updateStats(providerEntry, result, latencyMs) {
      const s = providerEntry.stats;
      s.calls++;
      s.totalLatencyMs += latencyMs;
      s.totalTokens    += result.tokens || 0;
      s.totalCostUsd   += (result.tokens || 0) * (providerEntry.provider.costPerToken || 0);
      // rolling avg confidence
      s.avgConfidence = s.calls === 1
        ? (result.confidence || 0)
        : s.avgConfidence + ((result.confidence || 0) - s.avgConfidence) / s.calls;
    }

    // ── Public interface methods ─────────────────────────────────────────────────

    /**
     * infer(systemPrompt, userPrompt, opts) — cascade through providers on failure.
     */
    async infer(systemPrompt, userPrompt, opts = {}) {
      const providers = Array.from(this._providers.values())
        .filter(e => !e.provider.capabilities || e.provider.capabilities.includes(CAPABILITIES.INFER))
        .sort((a, b) => b.priority - a.priority);

      if (providers.length === 0) throw new Error('No inference provider registered');

      // Sort cascade order by routing policy
      if (this._policy === ROUTING_POLICIES.COST) {
        providers.sort((a, b) =>
          (a.provider.costPerToken || 0) - (b.provider.costPerToken || 0)
        );
      } else if (this._policy === ROUTING_POLICIES.LATENCY) {
        providers.sort((a, b) => {
          const la = a.stats.calls ? a.stats.totalLatencyMs / a.stats.calls : Infinity;
          const lb = b.stats.calls ? b.stats.totalLatencyMs / b.stats.calls : Infinity;
          return la - lb;
        });
      } else if (this._policy === ROUTING_POLICIES.CONFIDENCE) {
        providers.sort((a, b) => b.stats.avgConfidence - a.stats.avgConfidence);
      }
      // PRIMARY (default): already sorted by priority desc above

      let lastErr;
      for (const entry of providers) {
        const start = Date.now();
        try {
          const result   = await entry.provider.infer(systemPrompt, userPrompt, opts);
          const latency  = Date.now() - start;
          this._updateStats(entry, result, latency);
          this._record({ ts: new Date().toISOString(), op: 'infer', provider: entry.provider.id, latencyMs: latency, confidence: result.confidence, ok: true });
          return { ...result, _trace: { provider: entry.provider.id, policy: this._policy, latencyMs: latency } };
        } catch (err) {
          entry.stats.failures++;
          lastErr = err;
          this._record({ ts: new Date().toISOString(), op: 'infer', provider: entry.provider.id, ok: false, error: err.message });
          this._log.warn({ component: 'intelligenceRegistry', provider: entry.provider.id, err: err.message }, '[Registry] provider failed, trying next');
        }
      }
      throw new Error(`All intelligence providers failed. Last error: ${lastErr?.message}`);
    }

    async embed(text, opts = {}) {
      const entry = this._selectProvider(CAPABILITIES.EMBED);
      const start = Date.now();
      const result = await entry.provider.embed(text, opts);
      this._updateStats(entry, { tokens: Math.ceil(text.length / 4), confidence: 1 }, Date.now() - start);
      return result;
    }

    async moderate(text) {
      const entry = this._selectProvider(CAPABILITIES.MODERATE);
      return entry.provider.moderate(text);
    }

    tokenize(text) {
      const entry = this._selectProvider(CAPABILITIES.INFER);
      return entry.provider.tokenize(text);
    }

    estimate(text, opts = {}) {
      const entry = this._selectProvider(CAPABILITIES.INFER);
      return entry.provider.estimate(text, opts);
    }

    getTraces(limit = 50) { return this._traces.slice(-limit); }

    accountingReport() {
      return Array.from(this._providers.entries()).map(([id, e]) => ({
        id,
        ...e.stats,
        avgLatencyMs: e.stats.calls ? Math.round(e.stats.totalLatencyMs / e.stats.calls) : 0,
      }));
    }
  }

  // ── Singleton + exports ───────────────────────────────────────────────────────
  const defaultRegistry = new IntelligenceRegistry();
  // Register the built-in offline adapter by default
  defaultRegistry.register(new EcosOfflineAdapter(), 10);

  module.exports = {
    IntelligenceRegistry,
    OpenAICompatAdapter,
    AnthropicAdapter,
    EcosOfflineAdapter,
    CAPABILITIES,
    ROUTING_POLICIES,
    defaultRegistry,
  };
  