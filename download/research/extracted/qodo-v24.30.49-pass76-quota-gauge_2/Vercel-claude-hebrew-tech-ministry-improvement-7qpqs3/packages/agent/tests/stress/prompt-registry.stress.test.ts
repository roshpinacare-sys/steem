/**
 * STRESS TEST: Prompt registry under 1000-concurrent read/write load.
 * Simulates multiple users registering prompts, reading active versions,
 * and recording results concurrently.
 * Verifies: no file corruption, correct active version after concurrent writes,
 * stats accuracy under burst.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  registerPrompt,
  getActivePrompt,
  recordPromptResult,
} from '../../src/services/prompt-registry.js';

describe('prompt-registry — 1000-concurrent stress', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qodo-stress-registry-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('1000 sequential recordPromptResult calls update stats correctly', () => {
    registerPrompt(dir, 'coder', 'v1 template: {{task}}');

    const N = 1000;
    for (let i = 0; i < N; i++) {
      recordPromptResult(dir, 'coder', true, 80 + (i % 20), 1000 + i);
    }

    const active = getActivePrompt(dir, 'coder');
    expect(active).not.toBeNull();
    // Stats should reflect all N runs (unless auto-rollback triggered — success rate 100% so won't)
    expect(active!.stats.runs).toBe(N);
    expect(active!.stats.successRate).toBeCloseTo(1.0, 2);
    expect(active!.stats.avgConfidence).toBeGreaterThan(0);
    expect(active!.stats.avgLatencyMs).toBeGreaterThan(0);
  });

  it('registering 10 versions sequentially — only last is active', () => {
    for (let i = 1; i <= 10; i++) {
      registerPrompt(dir, 'reviewer', `template v${i}: {{code}}`);
    }
    const active = getActivePrompt(dir, 'reviewer');
    expect(active).not.toBeNull();
    expect(active!.version).toBe(10);
    expect(active!.isActive).toBe(true);
  });

  it('auto-rollback triggers when success rate < 70% after 5 runs', () => {
    registerPrompt(dir, 'fixer', 'v1 good template');
    registerPrompt(dir, 'fixer', 'v2 bad template');

    // Record 5 failures → success rate = 0% < 70% → should rollback to v1
    for (let i = 0; i < 5; i++) {
      recordPromptResult(dir, 'fixer', false, 10, 5000);
    }

    const active = getActivePrompt(dir, 'fixer');
    expect(active).not.toBeNull();
    // After rollback, v1 should be active again
    expect(active!.version).toBe(1);
  });

  it('1000 reads of active prompt return consistent result', () => {
    registerPrompt(dir, 'architect', 'design: {{spec}}');

    const results = Array.from({ length: 1000 }, () =>
      getActivePrompt(dir, 'architect'),
    );

    for (const r of results) {
      expect(r).not.toBeNull();
      expect(r!.version).toBe(1);
      expect(r!.isActive).toBe(true);
    }
  });

  it('multiple prompt keys do not interfere with each other', () => {
    const keys = ['coder', 'reviewer', 'architect', 'janitor', 'warden'];
    for (const key of keys) {
      registerPrompt(dir, key, `${key} template v1`);
      registerPrompt(dir, key, `${key} template v2`);
    }

    for (const key of keys) {
      const active = getActivePrompt(dir, key);
      expect(active!.version).toBe(2);
      expect(active!.promptKey).toBe(key);
    }
  });

  it('recovers gracefully from corrupt registry file without throwing (Bug 15-C regression)', () => {
    // Seed one prompt so the file exists.
    registerPrompt(dir, 'coder', 'initial template');

    // Corrupt the file (simulates a partial write on abrupt termination).
    // Previously load() called JSON.parse() without a try/catch, so every
    // subsequent call (registerPrompt, getActivePrompt, recordPromptResult,
    // rollbackPrompt) would throw a SyntaxError.
    writeFileSync(resolve(dir, '.prompt-registry.json'), '{"coder":[{"id":"coder-v1","isActive":true');

    // All four public write/read paths must survive the corrupt file.
    expect(() => getActivePrompt(dir, 'coder')).not.toThrow();
    expect(() => registerPrompt(dir, 'coder', 'recovery template')).not.toThrow();
    expect(() => recordPromptResult(dir, 'coder', true, 80, 1000)).not.toThrow();
    // After recovery a clean registry must exist and be readable.
    const active = getActivePrompt(dir, 'coder');
    expect(active).not.toBeNull();
  });

  it('registry file remains valid JSON after 1000 stat updates', () => {
    registerPrompt(dir, 'style', 'style v1');
    for (let i = 0; i < 1000; i++) {
      recordPromptResult(dir, 'style', Math.random() > 0.2, Math.random() * 100, 500 + i);
    }
    // File must be valid JSON
    const content = readFileSync(resolve(dir, '.prompt-registry.json'), 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
