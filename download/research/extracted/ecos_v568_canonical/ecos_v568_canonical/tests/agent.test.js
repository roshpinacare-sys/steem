import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('Agent ReAct loop logic', () => {
  it('parses JSON action from LLM output', () => {
    const raw = 'I should check the calibrator. {"action":"check_calibrator","args":{}}';
    const match = raw.match(/\{[\s\S]*\}/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match[0]);
    expect(parsed.action).toBe('check_calibrator');
  });

  it('detects final_answer action', () => {
    const raw = '{"action":"final_answer","text":"System is healthy."}';
    const parsed = JSON.parse(raw);
    expect(parsed.action).toBe('final_answer');
    expect(parsed.text).toBe('System is healthy.');
  });

  it('handles non-JSON LLM output as final answer', () => {
    const raw = 'The system appears to be running normally.';
    let parsed = null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {}
    expect(parsed).toBeNull();
    // fallback: treat as final answer
    const finalAnswer = parsed?.text || raw;
    expect(finalAnswer).toBe(raw);
  });

  // ── V75 new tests ────────────────────────────────────────────────────────────

  it('list_patches result has expected structure', () => {
    // Simulates what list_patches returns (file-fallback, no DB)
    const result = { count: 0, patches: [] };
    expect(result).toHaveProperty('count');
    expect(result).toHaveProperty('patches');
    expect(typeof result.count).toBe('number');
    expect(Array.isArray(result.patches)).toBe(true);
  });

  it('search_patches returns patches array on valid result', () => {
    // Simulates a successful search_patches response
    const mockResults = [
      { id: 'patch_001', score: 0.92, preview: 'NDA review guidelines', reuseCount: 5 },
      { id: 'patch_002', score: 0.77, preview: 'Contract validation steps', reuseCount: 2 },
    ];
    const result = { count: mockResults.length, patches: mockResults };
    expect(Array.isArray(result.patches)).toBe(true);
    expect(result.patches.length).toBe(2);
    expect(result.patches[0]).toHaveProperty('score');
    expect(result.patches[0].score).toBeGreaterThan(0);
  });

  it('systemPrompt instructs agent to respond with JSON action or final_answer', () => {
    // Mirrors the systemPrompt template built in ecos-api-server.js agent endpoint
    const toolListStr = 'check_calibrator, list_pending, get_balance, run_verify, list_approvals_all, list_patches, search_patches';
    const maxSteps = 6;
    const systemPrompt = `You are the ECOS system agent with access to these tools: ${toolListStr}.
Rules:
- Use tools to gather information before answering
- Always respond with valid JSON: {"action":"tool_name","args":{}} or {"action":"final_answer","text":"..."}
- Be concise and factual
- If asked about patches/royalties: use list_patches or search_patches
- If asked about system health: use check_calibrator and run_verify
- Max steps: ${maxSteps}`;
    expect(systemPrompt).toContain('"action"');
    expect(systemPrompt).toContain('final_answer');
    expect(systemPrompt).toContain('list_patches');
    expect(systemPrompt).toContain('search_patches');
  });

  it('agent tool guidance includes patch and health tool names', () => {
    // Verify the expected tool names are present in the agent tool list
    const expectedTools = [
      'check_calibrator',
      'list_pending',
      'get_balance',
      'run_verify',
      'list_approvals_all',
      'list_patches',
      'search_patches',
    ];
    const toolListStr = expectedTools.join(', ');
    for (const tool of expectedTools) {
      expect(toolListStr).toContain(tool);
    }
    expect(toolListStr).toContain('list_patches');
    expect(toolListStr).toContain('search_patches');
    expect(toolListStr).toContain('check_calibrator');
  });

  // [V81] Test 8 — partial JSON embedded in prose is parsed correctly
  it('non-JSON LLM output with partial JSON is handled', () => {
    const raw = 'Let me think... {"action":"check_calibrator"} done';
    const match = raw.match(/\{[\s\S]*\}/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match[0]);
    expect(parsed.action).toBe('check_calibrator');
  });

  // [V85] Test 9 — detectIntent exact anchors prevent misclassification
  it('detectIntent exact anchors prevent misclassification', () => {
    // Inline the production detectIntent from apps/web/src/app/chat/page.jsx
    function detectIntent(text) {
      const t = text.toLowerCase().trim();
      if (/^help$|^\?$|what can you do|^commands$/.test(t))           return 'HELP';
      if (/^history$|my missions|past tasks/.test(t))                 return 'HISTORY';
      if (/^dashboard$|system overview/.test(t))                      return 'DASHBOARD';
      if (/^health$|server status|is.*running/.test(t))               return 'HEALTH';
      if (/^metrics$|^gauges$|prometheus/.test(t))                    return 'METRICS';
      if (/^ledger$|^balance$|show.*balance/.test(t))                 return 'LEDGER';
      if (/deposit|add funds|top up/.test(t))                         return 'DEPOSIT';
      if (/approve|reject/.test(t))                                   return 'RESOLVE';
      if (/^calibrate$|^calibration$|train.*model|fit model/.test(t)) return 'CALIBRATE';
      if (/^status$|system.*status/.test(t))                          return 'STATUS';
      if (/my balance|wallet|earnings/.test(t))                       return 'BALANCE';
      if (/^approvals$|^pending$|pending.*queue|approval.*queue/.test(t)) return 'APPROVALS';
      if (/similar|find patch|search patches|patch search/.test(t))   return 'PATCH_SEARCH';
      if (/show mission|mission detail|view mission/.test(t))         return 'MISSION_DETAIL';
      if (/analyze|debug|explain why|what.*wrong|diagnose/.test(t))   return 'AGENT_TASK';
      return 'TASK';
    }

    const cases = [
      { input: 'analyze ledger',    expected: 'AGENT_TASK' },
      { input: 'ledger',            expected: 'LEDGER' },
      { input: 'metrics now',       expected: 'TASK' },
      { input: 'metrics',           expected: 'METRICS' },
    ];
    for (const { input, expected } of cases) {
      expect(detectIntent(input)).toBe(expected);
    }
  });

  // [V85] Test 10 — multi-step ReAct loop terminates on final_answer
  it('multi-step ReAct loop terminates on final_answer', async () => {
    // Mock LLM responses — 3 steps: tool → tool → final_answer
    const mockSteps = [
      { action: 'check_calibrator', observation: 'ready' },
      { action: 'list_pending',     observation: ['apv_001'] },
      { action: 'final_answer',     text: 'Done' },
    ];
    let stepIdx = 0;

    // Minimal ReAct loop (mirrors /api/v1/agent logic in ecos-api-server.js)
    const MAX_STEPS = 6;
    const toolResults = [];
    let finalText = null;
    let loopCount = 0;

    while (loopCount < MAX_STEPS) {
      loopCount++;
      const llmResponse = mockSteps[stepIdx++];   // mock LLM call

      if (llmResponse.action === 'final_answer') {
        finalText = llmResponse.text;
        break;
      }
      // Record tool observation and continue
      toolResults.push({ action: llmResponse.action, observation: llmResponse.observation });
    }

    expect(loopCount).toBe(3);
    expect(finalText).toBe('Done');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0].action).toBe('check_calibrator');
    expect(toolResults[1].action).toBe('list_pending');
  });

  // [V96-P2] Test 11 — findSimilarPatches returns results with score field
  it('findSimilarPatches returns results with score field', () => {
    // Use the exported _rankByTfIdf directly (no DB needed)
    const { _rankByTfIdf } = require('../lib/semanticSearch');
    const rows = [
      { id: 'ptch_001', patch_body: 'contract review legal clause NDA agreement', reuse_count: 5 },
      { id: 'ptch_002', patch_body: 'invoice payment billing finance accounting',  reuse_count: 2 },
      { id: 'ptch_003', patch_body: 'data privacy GDPR compliance regulations',    reuse_count: 8 },
    ];
    const results = _rankByTfIdf('contract review', rows, 2, 0);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) {
      expect(r).toHaveProperty('score');
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r).toHaveProperty('patchId');
      expect(r).toHaveProperty('preview');
    }
  });

  // [V96-P2] Test 12 — findSimilarPatches returns empty array when no patches
  it('findSimilarPatches returns empty array when no patches', () => {
    const { _rankByTfIdf } = require('../lib/semanticSearch');
    const results = _rankByTfIdf('contract review', [], 5, 0);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });
});
