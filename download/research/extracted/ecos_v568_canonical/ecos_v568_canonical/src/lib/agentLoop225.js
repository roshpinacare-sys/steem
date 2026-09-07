// ============================================================
// src/lib/agentLoop225.js — Tool-Calling Agent Loop (P115)
// V225 / Stage 4. The orchestration that turns the LLM Gateway
// (Stage 1) + File Tools (Stage 2) + Sandbox Exec (Stage 3) into
// an autonomous "do this" loop, capped at `maxSteps` (default 10).
//
// Tool contract:
//   tools = [{ name, description, parameters, run: async ({args, ctx}) => result }]
// The loop:
//   1. Send messages + tool schemas to gateway.chat (non-stream).
//   2. If the response has toolCalls, run each tool and append a
//      'tool' message with the JSON result; loop.
//   3. Otherwise return the final assistant text.
//
// Defaults to `provider: 'mock'` so tests can run with no keys.
// Identifiers end in 225. Sacred files untouched.
// ============================================================
'use strict';

const MAX_AGENT_STEPS_225 = 10;

function _stringifyResult225(r) {
  try { return JSON.stringify(r); } catch { return String(r); }
}

async function runAgentLoop225(opts) {
  const o = opts || {};
  if (!o.gateway || typeof o.gateway.chat !== 'function') {
    throw new Error('AGENT_LOOP_225: gateway with .chat required');
  }
  const tools = Array.isArray(o.tools) ? o.tools : [];
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || typeof t.run !== 'function') {
      throw new Error('AGENT_LOOP_225: each tool must have {name, run}');
    }
  }
  const maxSteps = Math.min(typeof o.maxSteps === 'number' ? o.maxSteps : MAX_AGENT_STEPS_225, 50);
  const provider = o.provider || 'mock';
  const model    = o.model || null;
  const ctx      = o.ctx || {};
  const onStep   = typeof o.onStep === 'function' ? o.onStep : () => {};

  let messages = (Array.isArray(o.messages) ? o.messages : []).slice();
  if (o.system) messages.unshift({ role: 'system', content: String(o.system) });
  if (o.userMessage) messages.push({ role: 'user', content: String(o.userMessage) });
  if (messages.length === 0) throw new Error('AGENT_LOOP_225: messages or userMessage required');

  const toolSchemas = tools.map(t => ({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }));
  const trace = [];
  let steps = 0;
  let lastOutput = '';
  let stopReason = 'max_steps';

  while (steps < maxSteps) {
    steps += 1;
    const r = await o.gateway.chat({ provider, model, messages, tools: toolSchemas });
    if (!r.ok) {
      trace.push({ step: steps, type: 'error', error: r.error });
      onStep({ step: steps, type: 'error', error: r.error });
      return { ok: false, error: r.error, steps, trace, messages, ecosVersion: 'V225' };
    }
    lastOutput = r.output || '';
    trace.push({ step: steps, type: 'assistant', output: lastOutput, toolCalls: r.toolCalls });
    onStep({ step: steps, type: 'assistant', output: lastOutput, toolCalls: r.toolCalls });

    if (!Array.isArray(r.toolCalls) || r.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: lastOutput });
      stopReason = 'final';
      break;
    }

    messages.push({ role: 'assistant', content: lastOutput || '' });
    for (const tc of r.toolCalls) {
      const tool = tools.find(t => t.name === tc.name);
      if (!tool) {
        const errMsg = `tool "${tc.name}" not found`;
        messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: JSON.stringify({ error: errMsg }) });
        trace.push({ step: steps, type: 'tool', name: tc.name, ok: false, error: errMsg });
        onStep({ step: steps, type: 'tool', name: tc.name, ok: false, error: errMsg });
        continue;
      }
      let result;
      try { result = await tool.run({ args: tc.arguments || {}, ctx }); }
      catch (e) { result = { ok: false, error: e.message }; }
      const payload = _stringifyResult225(result);
      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: payload });
      trace.push({ step: steps, type: 'tool', name: tc.name, ok: !!(result && result.ok !== false), result });
      onStep({ step: steps, type: 'tool', name: tc.name, ok: !!(result && result.ok !== false), result });
    }
  }

  return { ok: true, steps, stopReason, output: lastOutput, trace, messages, ecosVersion: 'V225' };
}

module.exports = {
  MAX_AGENT_STEPS_225,
  runAgentLoop225,
};
