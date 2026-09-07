/**
 * Unit tests for AI strategy services:
 * prompt-registry, confidence-scorer, hot-reload-config, slo-tracker.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Prompt Registry ────────────────────────────────────────────────────────
import {
  registerPrompt,
  getActivePrompt,
  rollbackPrompt,
  recordPromptResult,
} from '../src/services/prompt-registry.js';

describe('prompt-registry', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qodo-prompt-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('registers a prompt and marks it active', () => {
    const v1 = registerPrompt(dir, 'coder', 'You are a coder. Task: {{task}}');
    expect(v1.version).toBe(1);
    expect(v1.isActive).toBe(true);
    const active = getActivePrompt(dir, 'coder');
    expect(active?.id).toBe(v1.id);
  });

  it('new version deactivates previous', () => {
    registerPrompt(dir, 'coder', 'v1 template');
    const v2 = registerPrompt(dir, 'coder', 'v2 template');
    expect(v2.isActive).toBe(true);
    const active = getActivePrompt(dir, 'coder');
    expect(active?.version).toBe(2);
  });

  it('rollback restores previous version', () => {
    registerPrompt(dir, 'coder', 'v1 template');
    registerPrompt(dir, 'coder', 'v2 template');
    const rolled = rollbackPrompt(dir, 'coder');
    expect(rolled?.version).toBe(1);
    const active = getActivePrompt(dir, 'coder');
    expect(active?.version).toBe(1);
  });

  it('stats are updated after recording results', () => {
    registerPrompt(dir, 'reviewer', 'Review: {{code}}');
    recordPromptResult(dir, 'reviewer', true, 85, 1200);
    recordPromptResult(dir, 'reviewer', true, 90, 800);
    const active = getActivePrompt(dir, 'reviewer');
    expect(active?.stats.runs).toBe(2);
    expect(active?.stats.avgConfidence).toBeGreaterThan(0);
  });
});

// ── Confidence Scorer ──────────────────────────────────────────────────────
import { computeConfidence } from '../src/services/confidence-scorer.js';

describe('confidence-scorer', () => {
  it('perfect input scores 100', () => {
    const { score } = computeConfidence({
      syntaxValid: true,
      testCoverageRatio: 1.0,
      filesChanged: 1,
      linesChanged: 10,
      modelCertainty: 1.0,
      validatorsPassed: 5,
      validatorsTotal: 5,
    });
    expect(score).toBe(100);
  });

  it('zero input scores 0', () => {
    const { score } = computeConfidence({
      syntaxValid: false,
      testCoverageRatio: 0,
      filesChanged: 30,
      linesChanged: 0,
      modelCertainty: 0,
      validatorsPassed: 0,
      validatorsTotal: 5,
    });
    expect(score).toBe(0);
  });
});

// ── Hot Reload Config ──────────────────────────────────────────────────────
import { startHotReload } from '../src/services/hot-reload-config.js';

describe('hot-reload-config', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qodo-hr-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads env vars from file on init', () => {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'MY_TEST_VAR=hello123\nANOTHER=world\n');
    const watcher = startHotReload(envFile);
    expect(process.env.MY_TEST_VAR).toBe('hello123');
    expect(process.env.ANOTHER).toBe('world');
    watcher?.close();
  });

  it('returns null for non-existent file', () => {
    const watcher = startHotReload(join(dir, 'nonexistent.env'));
    expect(watcher).toBeNull();
  });
});
