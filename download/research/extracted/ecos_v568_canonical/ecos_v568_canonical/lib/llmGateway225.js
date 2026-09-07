// ============================================================
// src/lib/llmGateway225.js — Unified LLM Gateway (P112)
// V225 / Stage 1. Adapter pattern for multi-provider chat with
// optional streaming (SSE) and tool-calling. No npm deps —
// uses global fetch (Node >=18). Keys are read from env only.
//
// Providers supported:
//   - 'lovable'    → Lovable AI Gateway      (env: LOVABLE_API_KEY_225)
//   - 'anthropic'  → Anthropic Messages API  (env: ANTHROPIC_API_KEY_225)
//   - 'openai'     → OpenAI Chat Completions (env: OPENAI_API_KEY_225)
//   - 'google'     → Gemini generateContent  (env: GOOGLE_API_KEY_225)
//   - 'mock'       → Deterministic in-process adapter (tests)
//
// Public API:
//   const g = createLlmGateway225({ providers, fetchImpl, now });
//   g.listProviders()                              → string[]
//   g.registerProvider(name, adapter)              → void
//   await g.chat({ provider, model, messages, tools, temperature, stream, signal, onEvent })
//      Returns { ok, provider, model, output, toolCalls, raw, events }
//      Events emitted via onEvent({ type, ... }) where type ∈
//        'delta' | 'tool_call' | 'done' | 'error'
//
// Identifiers end in 225. Sacred files untouched.
// ============================================================
'use strict';

const DEFAULT_MODELS_225 = Object.freeze({
  lovable:   'google/gemini-2.5-flash',
  anthropic: 'claude-3-5-sonnet-latest',
  openai:    'gpt-4o-mini',
  google:    'gemini-1.5-flash',
  mock:      'mock-model-225',
});

const LLM_TIMEOUT_DEFAULT_225 = 60_000;

// ─── Helpers ────────────────────────────────────────────────────────────────
function _readEnv225(name) {
  if (!process || !process.env) return null;
  const v = process.env[name];
  return (typeof v === 'string' && v.length > 0) ? v : null;
}

function _ensureFetch225(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof fetch === 'function') return fetch;
  throw new Error('LLM_GATEWAY_225: no fetch implementation available (Node >=18 required)');
}

function _validateMessages225(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('LLM_GATEWAY_225: messages must be a non-empty array');
  }
  for (const m of messages) {
    if (!m || typeof m !== 'object') throw new Error('LLM_GATEWAY_225: invalid message');
    if (typeof m.role !== 'string') throw new Error('LLM_GATEWAY_225: message.role required');
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      throw new Error('LLM_GATEWAY_225: message.content must be string or array');
    }
  }
}

function _toAnthropicMessages225(messages) {
  // Anthropic expects system separate; user/assistant in messages.
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n\n' : '') + String(m.content); continue; }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) });
  }
  return { system, msgs: out };
}

// ─── Mock adapter (deterministic; used by tests) ────────────────────────────
function _mockAdapter225() {
  return {
    name: 'mock',
    async chat({ messages, tools, onEvent }) {
      const last = String(messages[messages.length - 1].content || '');
      // If tools are present and prompt asks for a tool, emit a tool_call.
      const toolCalls = [];
      if (Array.isArray(tools) && tools.length > 0 && /\b(echo|call|tool)\b/i.test(last)) {
        const t = tools.find(x => x.name === 'echo') || tools[0];
        const tc = { id: 'call_225_1', name: t.name, arguments: { input: last } };
        toolCalls.push(tc);
        if (onEvent) onEvent({ type: 'tool_call', toolCall: tc });
      }
      const output = `mock-225: ${last}`;
      // Stream deltas word-by-word.
      const parts = output.split(/(\s+)/);
      for (const p of parts) if (p) if (onEvent) onEvent({ type: 'delta', text: p });
      if (onEvent) onEvent({ type: 'done' });
      return { output, toolCalls, raw: { mock: true } };
    },
  };
}

// ─── Lovable AI Gateway adapter (OpenAI-compatible) ─────────────────────────
function _lovableAdapter225({ fetchImpl, apiKeyEnv = 'LOVABLE_API_KEY_225', baseUrl = 'https://ai.gateway.lovable.dev/v1' }) {
  return {
    name: 'lovable',
    async chat({ model, messages, tools, temperature, stream, signal, onEvent }) {
      const key = _readEnv225(apiKeyEnv);
      if (!key) throw new Error(`LLM_GATEWAY_225: ${apiKeyEnv} not set`);
      const body = {
        model: model || DEFAULT_MODELS_225.lovable,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        stream: !!stream,
      };
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } },
        }));
      }
      const r = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}`, 'Lovable-API-Key': key },
        body: JSON.stringify(body),
        signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`LLM_GATEWAY_225: lovable HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      if (!stream) {
        const json = await r.json();
        const msg = json.choices && json.choices[0] && json.choices[0].message;
        const output = (msg && typeof msg.content === 'string') ? msg.content : '';
        const toolCalls = (msg && Array.isArray(msg.tool_calls)) ? msg.tool_calls.map(tc => ({
          id: tc.id, name: tc.function && tc.function.name,
          arguments: _safeJsonParse225(tc.function && tc.function.arguments),
        })) : [];
        if (onEvent && output) onEvent({ type: 'delta', text: output });
        if (onEvent) for (const tc of toolCalls) onEvent({ type: 'tool_call', toolCall: tc });
        if (onEvent) onEvent({ type: 'done' });
        return { output, toolCalls, raw: json };
      }
      return await _consumeOpenAiStream225(r, onEvent);
    },
  };
}

function _openAiAdapter225({ fetchImpl, apiKeyEnv = 'OPENAI_API_KEY_225', baseUrl = 'https://api.openai.com/v1' }) {
  return {
    name: 'openai',
    async chat(args) { return _lovableAdapter225({ fetchImpl, apiKeyEnv, baseUrl }).chat({ ...args, model: args.model || DEFAULT_MODELS_225.openai }); },
  };
}

function _anthropicAdapter225({ fetchImpl, apiKeyEnv = 'ANTHROPIC_API_KEY_225', baseUrl = 'https://api.anthropic.com/v1' }) {
  return {
    name: 'anthropic',
    async chat({ model, messages, tools, temperature, stream, signal, onEvent }) {
      const key = _readEnv225(apiKeyEnv);
      if (!key) throw new Error(`LLM_GATEWAY_225: ${apiKeyEnv} not set`);
      const { system, msgs } = _toAnthropicMessages225(messages);
      const body = {
        model: model || DEFAULT_MODELS_225.anthropic,
        max_tokens: 4096,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        system,
        messages: msgs,
        stream: !!stream,
      };
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools.map(t => ({ name: t.name, description: t.description || '', input_schema: t.parameters || { type: 'object', properties: {} } }));
      }
      const r = await fetchImpl(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`LLM_GATEWAY_225: anthropic HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      if (!stream) {
        const json = await r.json();
        let output = '';
        const toolCalls = [];
        if (Array.isArray(json.content)) {
          for (const block of json.content) {
            if (block.type === 'text' && typeof block.text === 'string') output += block.text;
            if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: block.input || {} });
          }
        }
        if (onEvent && output) onEvent({ type: 'delta', text: output });
        if (onEvent) for (const tc of toolCalls) onEvent({ type: 'tool_call', toolCall: tc });
        if (onEvent) onEvent({ type: 'done' });
        return { output, toolCalls, raw: json };
      }
      return await _consumeAnthropicStream225(r, onEvent);
    },
  };
}

function _googleAdapter225({ fetchImpl, apiKeyEnv = 'GOOGLE_API_KEY_225', baseUrl = 'https://generativelanguage.googleapis.com/v1beta' }) {
  return {
    name: 'google',
    async chat({ model, messages, tools, temperature, stream, signal, onEvent }) {
      const key = _readEnv225(apiKeyEnv);
      if (!key) throw new Error(`LLM_GATEWAY_225: ${apiKeyEnv} not set`);
      const mdl = model || DEFAULT_MODELS_225.google;
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content) }],
      }));
      const systemInstruction = messages.filter(m => m.role === 'system').map(m => String(m.content)).join('\n\n') || undefined;
      const body = { contents, generationConfig: { temperature: typeof temperature === 'number' ? temperature : 0.7 } };
      if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } })) }];
      }
      const url = `${baseUrl}/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`LLM_GATEWAY_225: google HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      const json = await r.json();
      let output = '';
      const toolCalls = [];
      const cand = json.candidates && json.candidates[0];
      if (cand && cand.content && Array.isArray(cand.content.parts)) {
        for (const p of cand.content.parts) {
          if (typeof p.text === 'string') output += p.text;
          if (p.functionCall) toolCalls.push({ id: `gcall_225_${toolCalls.length}`, name: p.functionCall.name, arguments: p.functionCall.args || {} });
        }
      }
      if (onEvent && output) onEvent({ type: 'delta', text: output });
      if (onEvent) for (const tc of toolCalls) onEvent({ type: 'tool_call', toolCall: tc });
      if (onEvent) onEvent({ type: 'done' });
      return { output, toolCalls, raw: json };
    },
  };
}

// ─── SSE consumers ──────────────────────────────────────────────────────────
function _safeJsonParse225(s) { try { return JSON.parse(s); } catch { return {}; } }

async function _consumeOpenAiStream225(response, onEvent) {
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  if (!reader) throw new Error('LLM_GATEWAY_225: streaming unsupported by fetch impl');
  const dec = new TextDecoder();
  let buf = '';
  let output = '';
  const toolCalls = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { if (onEvent) onEvent({ type: 'done' }); continue; }
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices && json.choices[0] && json.choices[0].delta;
      if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
        output += delta.content;
        if (onEvent) onEvent({ type: 'delta', text: delta.content });
      }
      if (delta && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const id = tc.id || `call_${toolCalls.length}`;
          let found = toolCalls.find(x => x.id === id);
          if (!found) { found = { id, name: tc.function && tc.function.name || '', arguments: '' }; toolCalls.push(found); }
          if (tc.function && tc.function.arguments) found.arguments += tc.function.arguments;
        }
      }
    }
  }
  const parsedCalls = toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: typeof tc.arguments === 'string' ? _safeJsonParse225(tc.arguments) : tc.arguments }));
  for (const tc of parsedCalls) if (onEvent) onEvent({ type: 'tool_call', toolCall: tc });
  return { output, toolCalls: parsedCalls, raw: null };
}

async function _consumeAnthropicStream225(response, onEvent) {
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  if (!reader) throw new Error('LLM_GATEWAY_225: streaming unsupported by fetch impl');
  const dec = new TextDecoder();
  let buf = '';
  let output = '';
  const toolCalls = [];
  let currentTool = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      let json; try { json = JSON.parse(payload); } catch { continue; }
      if (json.type === 'content_block_start' && json.content_block && json.content_block.type === 'tool_use') {
        currentTool = { id: json.content_block.id, name: json.content_block.name, arguments: '' };
        toolCalls.push(currentTool);
      } else if (json.type === 'content_block_delta' && json.delta) {
        if (json.delta.type === 'text_delta' && typeof json.delta.text === 'string') {
          output += json.delta.text;
          if (onEvent) onEvent({ type: 'delta', text: json.delta.text });
        } else if (json.delta.type === 'input_json_delta' && currentTool) {
          currentTool.arguments += json.delta.partial_json || '';
        }
      } else if (json.type === 'message_stop') {
        if (onEvent) onEvent({ type: 'done' });
      }
    }
  }
  const parsed = toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: typeof tc.arguments === 'string' ? _safeJsonParse225(tc.arguments) : tc.arguments }));
  for (const tc of parsed) if (onEvent) onEvent({ type: 'tool_call', toolCall: tc });
  return { output, toolCalls: parsed, raw: null };
}

// ─── Gateway factory ────────────────────────────────────────────────────────
function createLlmGateway225(opts) {
  const o = opts || {};
  const fetchImpl = _ensureFetch225(o.fetchImpl);
  const providers = new Map();

  if (o.providers && typeof o.providers === 'object') {
    for (const [k, v] of Object.entries(o.providers)) providers.set(k, v);
  } else {
    providers.set('lovable',   _lovableAdapter225({ fetchImpl }));
    providers.set('openai',    _openAiAdapter225({ fetchImpl }));
    providers.set('anthropic', _anthropicAdapter225({ fetchImpl }));
    providers.set('google',    _googleAdapter225({ fetchImpl }));
    providers.set('mock',      _mockAdapter225());
  }

  function registerProvider(name, adapter) {
    if (!name || typeof adapter !== 'object' || typeof adapter.chat !== 'function') {
      throw new Error('LLM_GATEWAY_225: registerProvider requires {name, adapter:{chat}}');
    }
    providers.set(name, adapter);
  }

  function listProviders() { return Array.from(providers.keys()).sort(); }

  async function chat(req) {
    if (!req || typeof req !== 'object') return { ok: false, error: 'request required', code: 'LLM_ERROR_225', events: [], ecosVersion: 'V225' };
    const providerName = req.provider || 'mock';
    const adapter = providers.get(providerName);
    if (!adapter) return { ok: false, provider: providerName, error: `unknown provider "${providerName}"`, code: 'LLM_ERROR_225', events: [], ecosVersion: 'V225' };
    try { _validateMessages225(req.messages); }
    catch (e) { return { ok: false, provider: providerName, error: e.message, code: 'LLM_ERROR_225', events: [], ecosVersion: 'V225' }; }
    const events = [];
    const onEvent = (e) => {
      events.push(e);
      if (typeof req.onEvent === 'function') {
        try { req.onEvent(e); } catch { /* swallow */ }
      }
    };
    const timeout = typeof req.timeout === 'number' ? req.timeout : LLM_TIMEOUT_DEFAULT_225;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await adapter.chat({
        model: req.model,
        messages: req.messages,
        tools: req.tools,
        temperature: req.temperature,
        stream: !!req.stream,
        signal: req.signal || controller.signal,
        onEvent,
      });
      return {
        ok: true,
        provider: providerName,
        model: req.model || DEFAULT_MODELS_225[providerName] || null,
        output: r.output,
        toolCalls: r.toolCalls || [],
        raw: r.raw || null,
        events,
        ecosVersion: 'V225',
      };
    } catch (e) {
      onEvent({ type: 'error', error: e.message });
      return { ok: false, provider: providerName, error: e.message, code: 'LLM_ERROR_225', events, ecosVersion: 'V225' };
    } finally {
      clearTimeout(t);
    }
  }

  return { chat, registerProvider, listProviders, _providers: providers };
}

module.exports = {
  DEFAULT_MODELS_225,
  LLM_TIMEOUT_DEFAULT_225,
  createLlmGateway225,
  _mockAdapter225,
  _lovableAdapter225,
  _openAiAdapter225,
  _anthropicAdapter225,
  _googleAdapter225,
  _toAnthropicMessages225,
  _validateMessages225,
};
