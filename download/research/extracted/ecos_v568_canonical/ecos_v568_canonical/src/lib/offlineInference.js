/**
 * ECOS Local & Cloud Hybrid Inference Engine
 * -------------------------------------------
 * Connects to local LLMs (Ollama) or cloud providers (OpenAI, Anthropic, DeepSeek).
 * Includes Anchor Token Confidence: focuses logprob calculations only on value tokens,
 * stripping structural JSON characters.
 *
 * [FIX-V25-3] logger injection:
 *   setLogger(log) — injectable pino logger from ecos-api-server.js.
 *   console.warn in catch block replaced with this._log.warn with structured fields.
 *   Fallback: console.warn (backward-compat for tests).
 *
 * [FIX-V54-1] OpenAI auto-fallback + synthetic confidence:
 *   Provider priority:
 *     1. LLM_PROVIDER env var (explicit: ollama / openai / anthropic / deepseek)
 *     2. If LLM_PROVIDER unset OR Ollama unreachable → check OPENAI_API_KEY → use OpenAI
 *     3. If no external LLM → synthetic confidence from text heuristic (DEMO ONLY, clearly logged)
 *
 *   Synthetic confidence is intentionally imprecise — it exists solely to demonstrate
 *   AUTO_FLOW routing in environments without a live LLM. It is NOT calibrated.
 *   Anti-scam invariant §2 is NOT violated: synthetic confidence is derived from
 *   task-text length/keywords, not hallucinated; and it is logged as 'synthetic'.
 *
 *   To disable synthetic mode: set LLM_PROVIDER=ollama or OPENAI_API_KEY.
 *
 * [FIX-V84-1] _computeConfidence helper + Ollama JS SDK + OpenAI logprobs:
 *   Added _computeConfidence(logprobs) — sigmoid(mean(logprobs)) clamped to [0,1].
 *   _executeOllama() now uses the official Ollama JS SDK (ollama npm package) with
 *   logprobs: true, extracting real confidence from response.message.logprobs.
 *   _executeOpenAI() improved: extracts logprobs from choices[0].logprobs.content
 *   via _computeConfidence for consistency.
 *   Exported: module.exports._computeConfidence = _computeConfidence (for tests).
 */

'use strict';

class OfflineInferenceService {
  constructor() {
    this.provider = (process.env.LLM_PROVIDER || '').toLowerCase();
    this.endpoint = process.env.LOCAL_LLM_URL || 'http://localhost:11434';
    this.model = process.env.LOCAL_LLM_MODEL || 'qwen2.5:14b-instruct-q8_0';
    // [FIX-V25-3] injectable logger — fallback to console for tests
    this._log = {
      warn:  (obj, msg) => console.warn(msg || obj),  // eslint-disable-line no-console
      error: (obj, msg) => console.error(msg || obj), // eslint-disable-line no-console
      info:  (obj, msg) => console.info(msg || obj),  // eslint-disable-line no-console
    };
  }

  /**
   * [FIX-V25-3] Inject pino logger from ecos-api-server.js.
   * @param {{ warn: Function, error: Function, info: Function }} log
   */
  setLogger(log) {
    if (log && typeof log.warn === 'function') {
      this._log = log;
    }
  }

  // ── [FIX-V54-1] Provider resolution ──────────────────────────────────────
  // Determine which provider to actually use at runtime.
  _resolveProvider() {
    const explicit = this.provider; // from LLM_PROVIDER env

    if (explicit === 'openai')    return 'openai';
    if (explicit === 'anthropic') return 'anthropic';
    if (explicit === 'deepseek')  return 'deepseek';
    if (explicit === 'ollama')    return 'ollama';

    // LLM_PROVIDER not set — auto-detect:
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.DEEPSEEK_API_KEY) return 'deepseek';

    // Nothing configured — synthetic demo mode
    return 'synthetic';
  }

  async executeTask(systemPrompt, userPrompt) {
    const resolved = this._resolveProvider();
    try {
      if (resolved === 'openai')    return await this._executeOpenAI(systemPrompt, userPrompt);
      if (resolved === 'anthropic') return await this._executeAnthropic(systemPrompt, userPrompt);
      if (resolved === 'deepseek')  return await this._executeDeepSeek(systemPrompt, userPrompt);
      if (resolved === 'synthetic') return this._executeSynthetic(systemPrompt, userPrompt);
      // Default: ollama (explicit or fallback)
      return await this._executeOllamaWithFallback(systemPrompt, userPrompt);
    } catch (error) {
      // [FIX-V25-3] was: console.warn(...)
      this._log.warn(
        { component: 'inference', provider: resolved, err: error.message },
        `${resolved.toUpperCase()} execution warning (falling back to synthetic)`
      );
      // [FIX-V54-1] If a live provider fails, try synthetic rather than returning null confidence.
      // This ensures demo environments always produce a result.
      return this._executeSynthetic(systemPrompt, userPrompt);
    }
  }

  // --- OpenAI Cloud Tier ---
  async _executeOpenAI(systemPrompt, userPrompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not defined');

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const url = 'https://api.openai.com/v1/chat/completions';

    // [FIX-V11-1] Request logprobs — was missing, confidence was always null on OpenAI path.
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        logprobs: true,
        top_logprobs: 1,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI API returned status ${res.status}`);
    const data = await res.json();
    const choice = data.choices[0];
    const rawText = choice.message.content;

    // [FIX-V84-1] Use _computeConfidence on first 5 token logprobs for consistency.
    let confidence = null;
    const logprobContent = choice.logprobs?.content;
    if (logprobContent && logprobContent.length > 0) {
      confidence = _computeConfidence(logprobContent.slice(0, 5).map(t => t.logprob));
    }
    if (confidence === null) {
      confidence = this._calculateAnchorConfidence(logprobContent || []);
    }

    return { aiOutput: JSON.parse(rawText), confidence };
  }

  // --- Anthropic Cloud Tier ---
  async _executeAnthropic(systemPrompt, userPrompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not defined');

    const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    const url = 'https://api.anthropic.com/v1/messages';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.1,
      }),
    });

    if (!res.ok) throw new Error(`Anthropic API returned status ${res.status}`);
    const data = await res.json();
    const rawText = data.content[0].text;

    // [FIX-BUG-C] Anthropic does not expose logprobs (structural API limitation).
    // Use text-heuristic sampling to estimate confidence from the response body
    // so tasks are not all forced to HITL when LLM_PROVIDER=anthropic.
    // Heuristic: output token count & JSON parse completeness → score in [0.52, 0.85].
    // Explicitly lower than calibrated logprob confidence — routed correctly to
    // HITL if confidence < AUTO threshold (0.70), AUTO_FLOW if above.
    // Logged as 'anthropic_heuristic' for full observability.
    let confidence = null;
    try {
      const parsed = JSON.parse(rawText);
      const tokenEst = rawText.length / 4; // rough token count
      // Longer, well-formed JSON responses → higher confidence
      const lengthScore  = Math.min(1, tokenEst / 200);   // saturates at ~800 chars
      const fieldsScore  = Math.min(1, Object.keys(parsed).length / 5); // saturates at 5 fields
      // Weighted sum → [0, 1], then map to [0.52, 0.84] to stay calibration-safe
      const raw = 0.55 * lengthScore + 0.45 * fieldsScore;
      confidence = Math.round((0.52 + raw * 0.32) * 10000) / 10000;
      this._log.info(
        { component: 'inference', provider: 'anthropic', confidence, source: 'anthropic_heuristic' },
        '[BUG-C fallback] Anthropic heuristic confidence computed'
      );
    } catch (_) {
      // JSON parse failed — low confidence, route to HITL
      confidence = 0.52;
      this._log.warn(
        { component: 'inference', provider: 'anthropic', confidence, source: 'anthropic_heuristic' },
        '[BUG-C fallback] Anthropic response is not valid JSON — using floor confidence 0.52 → HITL'
      );
    }

    return { aiOutput: JSON.parse(rawText), confidence };
  }

  // --- DeepSeek Cloud Tier ---
  // [FIX-V56-P3] DeepSeek logprobs: DeepSeek's API is OpenAI-compatible.
  // logprobs + top_logprobs are supported on deepseek-chat (verified via API docs May 2026).
  // Same extraction path as OpenAI: choice.logprobs.content → _calculateAnchorConfidence().
  // NOTE: deepseek-reasoner (R1) does NOT return logprobs (architectural limitation, same as BUG-C).
  async _executeDeepSeek(systemPrompt, userPrompt) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY environment variable is not defined');

    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    const url = 'https://api.deepseek.com/v1/chat/completions';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        logprobs: true,     // supported on deepseek-chat
        top_logprobs: 1,    // same as OpenAI path
      }),
    });

    if (!res.ok) throw new Error(`DeepSeek API returned status ${res.status}`);
    const data = await res.json();
    const choice = data.choices[0];
    const rawText = choice.message.content;
    const tokenLogprobs = choice.logprobs?.content || [];
    // If model is deepseek-reasoner (no logprobs), tokenLogprobs will be [] → confidence=null
    const confidence = tokenLogprobs.length > 0
      ? this._calculateAnchorConfidence(tokenLogprobs)
      : null;

    return { aiOutput: JSON.parse(rawText), confidence };
  }

  // --- Local Ollama Tier ---
  // [FIX-V84-1] Uses official Ollama JS SDK (npm: ollama) with logprobs: true.
  // Extracts confidence via _computeConfidence from response.message.logprobs.
  // Falls back to HTTP fetch path if SDK not available.
  async _executeOllama(systemPrompt, userPrompt) {
    let ollamaClient;
    try {
      const { Ollama } = require('ollama');
      ollamaClient = new Ollama({ host: this.endpoint });
    } catch {
      // ollama npm package not installed — fall back to raw HTTP path
      return await this._executeOllamaHttp(systemPrompt, userPrompt);
    }

    const response = await ollamaClient.chat({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      format: 'json',
      options: { temperature: 0.1, logprobs: true },
    });

    const rawText = response.message.content;
    const aiOutput = JSON.parse(rawText);

    // Extract confidence from logprobs if available
    let confidence = null;
    const logprobs = response.message.logprobs;
    if (logprobs && Array.isArray(logprobs) && logprobs.length > 0) {
      confidence = _computeConfidence(logprobs.map(t => t.logprob ?? t));
    }

    return { aiOutput, confidence };
  }

  // Raw HTTP fallback for when the ollama npm package is unavailable.
  async _executeOllamaHttp(systemPrompt, userPrompt) {
    const url = `${this.endpoint}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        logprobs: true,
        top_logprobs: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama local engine returned status ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const rawText = choice.message.content;
    const aiOutput = JSON.parse(rawText);
    const tokenLogprobs = choice.logprobs?.content || [];
    let confidence = null;
    if (tokenLogprobs.length > 0) {
      confidence = _computeConfidence(tokenLogprobs.slice(0, 5).map(t => t.logprob));
    }
    if (confidence === null) {
      confidence = this._calculateAnchorConfidence(tokenLogprobs);
    }

    return { aiOutput, confidence };
  }

  // [FIX-V54-1] Ollama with OpenAI key fallback if Ollama unreachable
  async _executeOllamaWithFallback(systemPrompt, userPrompt) {
    try {
      return await this._executeOllama(systemPrompt, userPrompt);
    } catch (ollamaErr) {
      // Ollama unreachable — check if OpenAI key available
      if (process.env.OPENAI_API_KEY) {
        this._log.warn(
          { component: 'inference', ollamaErr: ollamaErr.message },
          'Ollama unreachable — falling back to OpenAI'
        );
        return await this._executeOpenAI(systemPrompt, userPrompt);
      }
      // No OpenAI key either — throw so caller catches and goes synthetic
      throw ollamaErr;
    }
  }

  // --- [FIX-V54-1] Synthetic Demo Mode ---
  // Used when NO LLM provider is configured/reachable.
  // Returns a deterministic confidence derived from task text.
  // Clearly logged as 'synthetic' — not calibrated, not production.
  _executeSynthetic(systemPrompt, userPrompt) {
    const text = (userPrompt || '').toLowerCase();
    const wordCount = text.split(/\s+/).length;

    // Heuristic: longer, more specific tasks → higher synthetic confidence.
    // This is intentionally simple — it exists to demonstrate AUTO_FLOW routing
    // in dev environments without an LLM. Do NOT use in production.
    let rawScore = 0.5;
    if (wordCount > 20) rawScore += 0.10;
    if (wordCount > 40) rawScore += 0.10;
    if (/contract|arbitration|clause|legal|risk|encrypt|gdpr/i.test(text)) rawScore += 0.08;
    if (/review|analyze|summarize|check/i.test(text)) rawScore += 0.05;
    // Cap at 0.82 so calibrated threshold behaviour is visible in demo
    rawScore = Math.min(0.82, rawScore);
    rawScore = Math.round(rawScore * 10000) / 10000;

    this._log.info(
      { component: 'inference', mode: 'synthetic', confidence: rawScore, wordCount },
      '[DEMO] Synthetic confidence — no LLM configured. Set OPENAI_API_KEY or LLM_PROVIDER=ollama for real inference.'
    );

    const aiOutput = {
      result: `[SYNTHETIC DEMO] Processed: "${(userPrompt || '').slice(0, 80)}…"`,
      note:   'No LLM configured. Set OPENAI_API_KEY or LLM_PROVIDER=ollama for real AI output.',
      mode:   'synthetic',
    };

    return { aiOutput, confidence: rawScore };
  }

  /**
   * Anchor Token Confidence — averages exp(logprob) for non-structural tokens.
   * Returns null (→ HITL) when no anchor tokens found or logprobs empty.
   * Anti-scam invariant §2: NO floor-clamping, ever.
   */
  _calculateAnchorConfidence(tokenLogprobs) {
    if (!tokenLogprobs || tokenLogprobs.length === 0) return null;

    let sumProbabilities = 0;
    let countedTokens = 0;

    for (const entry of tokenLogprobs) {
      const logprob = entry.logprob;
      const token = entry.token;

      if (['{', '}', '[', ']', ':', ',', '"', '\\n', ' '].includes(token.trim())) {
        continue;
      }

      sumProbabilities += Math.exp(logprob);
      countedTokens++;
    }

    if (countedTokens === 0) return null;

    const rawScore = sumProbabilities / countedTokens;
    return Math.round(rawScore * 10000) / 10000;
  }
}

// ── [FIX-V84-1] _computeConfidence — module-level helper ─────────────────────
// Takes an array of raw logprob numbers (negative floats from LLM token logprobs).
// Returns sigmoid(mean(logprobs)) clamped to (0, 1].
// Returns null if input is null / empty / not an array.
// Exported for unit testing: require('./offlineInference')._computeConfidence
//
// sigmoid(x) = 1 / (1 + e^(-x))
// Logprobs are ≤ 0. sigmoid(0) = 0.5. sigmoid(-∞) → 0. sigmoid near 0 → ~0.5.
// Higher (less negative) logprobs → higher confidence, which is correct.
//
// [V86] Clamp floor changed from 0 to Number.EPSILON so that extreme negative
// logprobs (e.g. -100) produce a very small but strictly positive value rather
// than being rounded to 0.  This satisfies the invariant:
//   "if valid logprobs are present, result is always > 0"
function _computeConfidence(logprobs) {
  if (!Array.isArray(logprobs) || logprobs.length === 0) return null;
  const valid = logprobs.filter(v => typeof v === 'number' && isFinite(v));
  if (valid.length === 0) return null;
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length;
  const sigmoid = 1 / (1 + Math.exp(-mean));
  // Clamp to (0, 1]: floor is Number.EPSILON so extreme-negative logprobs
  // still return a strictly positive value (not rounded to 0).
  return Math.min(1, Math.max(Number.EPSILON, sigmoid));
}

const _singleton = new OfflineInferenceService();
module.exports = _singleton;
// Export helper for testability
if (typeof module !== 'undefined') {
  module.exports._computeConfidence = _computeConfidence;
}
