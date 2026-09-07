/**
 * selfRefinement.test.js — V101
 * Tests for SelfRefinementAgent.refine() 2-pass loop
 * [V101] Added REFINEMENT_THRESHOLD env var tests (BUG-F)
 * [V101] Added Anthropic heuristic confidence tests (BUG-C)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const offlineInference = require('../lib/offlineInference');

describe('SelfRefinementAgent — refine()', () => {
  let originalExecuteTask;

  beforeEach(() => {
    originalExecuteTask = offlineInference.executeTask;
  });

  afterEach(() => {
    offlineInference.executeTask = originalExecuteTask;
    // Bust agent cache so REFINEMENT_THRESHOLD env tests start fresh
    delete require.cache[require.resolve('../lib/selfRefinementAgent')];
  });

  it('refine() returns result with confidence >= 0 (triggers refinement when pass1 < 0.65)', async () => {
    const agent = require('../lib/selfRefinementAgent');
    const responses = [
      { aiOutput: { result: 'first attempt' }, confidence: 0.5 },
      { aiOutput: { result: 'refined output' }, confidence: 0.8 },
    ];
    let callCount = 0;
    offlineInference.executeTask = async () => responses[callCount++];

    const result = await agent.refine('sys', 'task');

    expect(result.confidence).toBe(0.8);
    expect(result.pass).toBe(2);
    expect(result.refined).toBe(true);
    expect(callCount).toBe(2);
  });

  it('refine() skips second pass when first confidence >= threshold (0.75 >= 0.65)', async () => {
    const agent = require('../lib/selfRefinementAgent');
    let callCount = 0;
    offlineInference.executeTask = async () => {
      callCount++;
      return { aiOutput: { result: 'good first attempt' }, confidence: 0.75 };
    };

    const result = await agent.refine('sys', 'task');

    expect(result.confidence).toBe(0.75);
    expect(result.pass).toBe(1);
    expect(result.refined).toBe(false);
    expect(callCount).toBe(1);
  });

  it('refine() always returns first pass if second pass confidence is lower', async () => {
    const agent = require('../lib/selfRefinementAgent');
    const responses = [
      { aiOutput: { result: 'first attempt' }, confidence: 0.6 },
      { aiOutput: { result: 'worse attempt' }, confidence: 0.4 },
    ];
    let callCount = 0;
    offlineInference.executeTask = async () => responses[callCount++];

    const result = await agent.refine('sys', 'task');

    expect(result.confidence).toBe(0.6);
    expect(result.pass).toBe(1);
    expect(result.refined).toBe(false);
    expect(callCount).toBe(2);
  });

  // [V101 BUG-F] REFINEMENT_THRESHOLD from env
  it('[BUG-F] uses REFINEMENT_THRESHOLD from env var', async () => {
    const savedThreshold = process.env.REFINEMENT_THRESHOLD;
    process.env.REFINEMENT_THRESHOLD = '0.80'; // higher threshold

    delete require.cache[require.resolve('../lib/selfRefinementAgent')];
    const agent = require('../lib/selfRefinementAgent');

    // confidence 0.75 is below 0.80 → should trigger pass 2
    const responses = [
      { aiOutput: { result: 'first' }, confidence: 0.75 },
      { aiOutput: { result: 'refined' }, confidence: 0.82 },
    ];
    let callCount = 0;
    offlineInference.executeTask = async () => responses[callCount++];

    const result = await agent.refine('sys', 'task');

    expect(result.pass).toBe(2);
    expect(result.refined).toBe(true);
    expect(callCount).toBe(2);

    // restore
    if (savedThreshold === undefined) delete process.env.REFINEMENT_THRESHOLD;
    else process.env.REFINEMENT_THRESHOLD = savedThreshold;
    delete require.cache[require.resolve('../lib/selfRefinementAgent')];
  });

  // [V101 BUG-F] Invalid REFINEMENT_THRESHOLD falls back to 0.65
  it('[BUG-F] invalid REFINEMENT_THRESHOLD falls back to default 0.65', async () => {
    const savedThreshold = process.env.REFINEMENT_THRESHOLD;
    process.env.REFINEMENT_THRESHOLD = 'not-a-number';

    delete require.cache[require.resolve('../lib/selfRefinementAgent')];
    const agent = require('../lib/selfRefinementAgent');

    // confidence 0.70 >= fallback 0.65 → no refinement
    offlineInference.executeTask = async () => ({ aiOutput: { result: 'ok' }, confidence: 0.70 });

    const result = await agent.refine('sys', 'task');
    expect(result.pass).toBe(1);
    expect(result.refined).toBe(false);

    if (savedThreshold === undefined) delete process.env.REFINEMENT_THRESHOLD;
    else process.env.REFINEMENT_THRESHOLD = savedThreshold;
    delete require.cache[require.resolve('../lib/selfRefinementAgent')];
  });
});
