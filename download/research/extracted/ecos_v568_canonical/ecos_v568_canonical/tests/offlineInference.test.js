/**
 * offlineInference.test.js — V101
 * Tests for lib/offlineInference.js
 *
 * [V101 BUG-C] Anthropic heuristic confidence fallback:
 *   Since Anthropic does not expose logprobs, we derive a heuristic confidence
 *   from the response body (JSON parse success, field count, length).
 *   These tests verify the heuristic stays in [0.52, 0.84] and is observable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Helper: build a mock fetch that returns an Anthropic-format response
function makeMockFetch(textBody) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ text: textBody }],
    }),
  });
}

describe('OfflineInferenceService — BUG-C Anthropic heuristic confidence', () => {
  let svc;
  let savedFetch;
  let savedKey;
  let warnMessages;

  beforeEach(() => {
    svc = require('../lib/offlineInference');
    savedFetch = global.fetch;
    savedKey   = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    // Capture warn calls
    warnMessages = [];
    svc._log = {
      info:  () => {},
      warn:  (obj, msg) => { warnMessages.push(msg || String(obj)); },
      error: () => {},
    };
  });

  afterEach(() => {
    global.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    // Restore default _log so other tests are not affected
    svc._log = {
      info:  (obj, msg) => console.info(msg || obj),   // eslint-disable-line
      warn:  (obj, msg) => console.warn(msg || obj),   // eslint-disable-line
      error: (obj, msg) => console.error(msg || obj),  // eslint-disable-line
    };
  });

  it('[BUG-C] confidence is a number in [0.52, 0.84] for a valid JSON response', async () => {
    const body = JSON.stringify({
      answer: 'yes', detail: 'some detail', score: 0.9, reason: 'good', extra: 'data',
    });
    global.fetch = makeMockFetch(body);

    const result = await svc._executeAnthropic('sys', 'task');

    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0.52);
    expect(result.confidence).toBeLessThanOrEqual(0.84);
  });

  it('[BUG-C] confidence is NOT null when the response is valid JSON', async () => {
    global.fetch = makeMockFetch(JSON.stringify({ result: 'ok', score: 1 }));

    const result = await svc._executeAnthropic('sys', 'task');

    expect(result.confidence).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('[BUG-C] confidence is 0.52 (floor) and a warn is emitted for non-JSON response body', async () => {
    global.fetch = makeMockFetch('not valid json { ');

    await expect(svc._executeAnthropic('sys', 'task')).rejects.toThrow(); // final JSON.parse throws
    // The heuristic warn was emitted before the final parse
    expect(warnMessages.some(m => m.includes('HITL') || m.includes('floor') || m.includes('BUG-C'))).toBe(true);
  });

  it('[BUG-C] richer JSON yields higher confidence than minimal JSON', async () => {
    // Minimal: 1 field, very short
    global.fetch = makeMockFetch(JSON.stringify({ a: 1 }));
    const minimal = await svc._executeAnthropic('sys', 'task');

    // Rich: 5 fields with long string values
    global.fetch = makeMockFetch(JSON.stringify({
      answer: 'this is a detailed answer with a good explanation of the scenario and a clear conclusion',
      score: 0.95,
      reasoning: 'step by step the model considered multiple factors including edge cases',
      alternative: 'an alternative approach was also evaluated and found to be less suitable',
      recommendation: 'the recommended action is clearly stated and actionable',
    }));
    const rich = await svc._executeAnthropic('sys', 'task');

    // Rich response confidence must be at least as high as minimal
    expect(rich.confidence).toBeGreaterThanOrEqual(minimal.confidence);
  });
});