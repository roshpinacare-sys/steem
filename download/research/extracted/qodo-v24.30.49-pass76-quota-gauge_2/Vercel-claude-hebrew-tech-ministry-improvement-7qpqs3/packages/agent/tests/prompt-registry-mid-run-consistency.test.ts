/**
 * Pass 64 — Task-30: Prompt-registry version-rollback mid-run consistency check.
 *
 * prompt-registry.ts stores versioned LLM prompts and supports A/B testing,
 * manual rollback, and auto-rollback triggered by low success rates.
 * A multi-phase pipeline (architect → coder → gate → reviewer …) calls
 * getActivePrompt() once per phase. This file answers the task-30 question:
 *
 *   "Does rolling back to a previous prompt version mid-run leave one phase
 *    on the new prompt while another is still on the old version, producing
 *    an internally inconsistent interpretation of the same objective?"
 *
 * Confirmed design contract: getActivePrompt() is a live file-system read
 * (calls load() → readFileSync on every invocation). There is NO in-process
 * cache. A rollback — whether manual or auto-triggered — immediately affects
 * every subsequent getActivePrompt() call, regardless of which run or phase
 * initiated it.
 *
 * Cross-consistency properties verified:
 *
 *   DB-1   Live-lookup contract: getActivePrompt() is a disk read — no cache.
 *   GAP-1  Manual rollback mid-run phase divergence (Medium): phases before
 *          rollback see vN; phases after rollback see v(N-1). No error raised.
 *   GAP-2  Auto-rollback mid-run phase divergence (Medium): 5 low-confidence
 *          results recorded in phase 1 trigger auto-rollback to v(N-1); all
 *          subsequent phases in the same run silently switch prompt versions.
 *          A phase's own recorded results can trigger the rollback that harms
 *          the next phase.
 *   DB-2   Run-start snapshot mitigation: resolving all prompts once at run
 *          start and passing the resolved template strings to each phase is
 *          the caller-level safe pattern. The registry has no built-in "run"
 *          concept and provides no per-run isolation.
 *   DB-3   Auto-rollback threshold: fires when runs >= 5 AND successRate < 0.70.
 *          Exactly 0.70 does NOT trigger. Fewer than 5 runs never trigger.
 *   DB-4   Multiple prompt keys are fully independent: rollback of one key
 *          does not affect any other key's active version or stats.
 *   DB-5   Rollback is single-step: each call reverts exactly one version back.
 *          Multiple rollbacks stack: v3 → v2 → v1.
 *   DB-6   Auto-rollback stats are persisted to disk before the rollback fires,
 *          so the triggering version's final stats are not lost.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  registerPrompt,
  getActivePrompt,
  rollbackPrompt,
  recordPromptResult,
} from '../src/services/prompt-registry.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'qodo-prompt-midrun-'));
}

/** Simulate recordPromptResult calls that produce a given number of successes. */
function recordResults(
  dir: string,
  promptKey: string,
  totalCalls: number,
  successes: number,
): void {
  let successCount = 0;
  for (let i = 0; i < totalCalls; i++) {
    const success = successCount < successes;
    if (success) successCount++;
    recordPromptResult(dir, promptKey, success, 80, 500);
  }
}

// ── 1. DB-1: Live-lookup contract confirmation ────────────────────────────────

describe('DB-1: getActivePrompt is a live disk read — no in-process cache', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('L-1: getActivePrompt returns the current active version on every call', () => {
    registerPrompt(dir, 'coder', 'v1 template');
    const first = getActivePrompt(dir, 'coder');
    expect(first?.version).toBe(1);
    // Register v2 — now v2 is active.
    registerPrompt(dir, 'coder', 'v2 template');
    const second = getActivePrompt(dir, 'coder');
    // Live read: immediately returns v2, not cached v1.
    expect(second?.version).toBe(2);
  });

  it('L-2: getActivePrompt after manual rollback immediately returns the rolled-back version', () => {
    registerPrompt(dir, 'coder', 'v1 template');
    registerPrompt(dir, 'coder', 'v2 template');
    // Confirm v2 is active.
    expect(getActivePrompt(dir, 'coder')?.version).toBe(2);
    // Rollback.
    rollbackPrompt(dir, 'coder');
    // Next live read returns v1, not the previously-seen v2.
    expect(getActivePrompt(dir, 'coder')?.version).toBe(1);
  });

  it('L-3: two sequential getActivePrompt calls before and after rollback return different versions', () => {
    registerPrompt(dir, 'arch', 'arch-v1');
    registerPrompt(dir, 'arch', 'arch-v2');

    const beforeRollback = getActivePrompt(dir, 'arch');  // live read → v2
    rollbackPrompt(dir, 'arch');
    const afterRollback = getActivePrompt(dir, 'arch');   // live read → v1

    expect(beforeRollback?.version).toBe(2);
    expect(afterRollback?.version).toBe(1);
    // No error raised — the version change is silent.
    expect(beforeRollback?.version).not.toBe(afterRollback?.version);
  });

  it('L-4: getActivePrompt returns null when no versions have been registered', () => {
    const active = getActivePrompt(dir, 'nonexistent-prompt');
    expect(active).toBeNull();
  });
});

// ── 2. GAP-1: Manual rollback mid-run phase divergence ───────────────────────

describe('GAP-1: manual rollback mid-run causes silent phase divergence', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('G-1a: phase 1 (architect) sees v2; rollback fires; phase 2 (reviewer) sees v1', () => {
    registerPrompt(dir, 'task-prompt', 'v1: be conservative');
    registerPrompt(dir, 'task-prompt', 'v2: be aggressive');

    // Simulate a multi-phase pipeline.
    // Phase 1 (architect): resolves the prompt at its start.
    const architectPrompt = getActivePrompt(dir, 'task-prompt');
    expect(architectPrompt?.version).toBe(2);
    expect(architectPrompt?.template).toBe('v2: be aggressive');

    // Mid-run: external operator triggers a rollback (e.g. safety concern).
    rollbackPrompt(dir, 'task-prompt');

    // Phase 2 (reviewer): resolves the prompt at its start.
    const reviewerPrompt = getActivePrompt(dir, 'task-prompt');
    expect(reviewerPrompt?.version).toBe(1);
    expect(reviewerPrompt?.template).toBe('v1: be conservative');

    // GAP-1 confirmed: same run, different phases, different prompt versions.
    // No error was raised by either getActivePrompt call.
    expect(architectPrompt?.version).not.toBe(reviewerPrompt?.version);
  });

  it('G-1b: divergence is silent — no exception raised; only observable via version numbers', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    registerPrompt(dir, 'task-prompt', 'v2 template');

    // Both calls succeed without throwing.
    const phase1 = getActivePrompt(dir, 'task-prompt');
    rollbackPrompt(dir, 'task-prompt');
    const phase2 = getActivePrompt(dir, 'task-prompt');

    // No null, no error — both return valid versions.
    expect(phase1).not.toBeNull();
    expect(phase2).not.toBeNull();
    // The divergence is only visible by comparing the version numbers.
    expect(phase1?.version).toBe(2);
    expect(phase2?.version).toBe(1);
  });

  it('G-1c: three-phase run with mid-run rollback — phase 1 and 3 diverge; phase 2 and 3 agree', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    registerPrompt(dir, 'task-prompt', 'v2 template');

    const phase1 = getActivePrompt(dir, 'task-prompt'); // v2
    rollbackPrompt(dir, 'task-prompt');                  // → v1 active
    const phase2 = getActivePrompt(dir, 'task-prompt'); // v1
    const phase3 = getActivePrompt(dir, 'task-prompt'); // v1 (same as phase 2)

    expect(phase1?.version).toBe(2);  // diverges from 2 and 3
    expect(phase2?.version).toBe(1);  // agrees with 3
    expect(phase3?.version).toBe(1);  // agrees with 2
  });

  it('G-1d: rollback of a different prompt key does not cause divergence on the original key', () => {
    registerPrompt(dir, 'arch-prompt', 'arch-v1');
    registerPrompt(dir, 'arch-prompt', 'arch-v2');
    registerPrompt(dir, 'coder-prompt', 'coder-v1');
    registerPrompt(dir, 'coder-prompt', 'coder-v2');

    const phase1Arch = getActivePrompt(dir, 'arch-prompt'); // arch-v2
    // Rollback only the coder prompt.
    rollbackPrompt(dir, 'coder-prompt');
    const phase2Arch = getActivePrompt(dir, 'arch-prompt'); // still arch-v2

    // arch-prompt is unaffected by coder-prompt rollback.
    expect(phase1Arch?.version).toBe(2);
    expect(phase2Arch?.version).toBe(2);
  });
});

// ── 3. GAP-2: Auto-rollback mid-run phase divergence ─────────────────────────

describe('GAP-2: auto-rollback mid-run causes silent phase divergence', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('G-2a: 5 consecutive failures trigger auto-rollback to v1', () => {
    registerPrompt(dir, 'task-prompt', 'v1 stable');
    registerPrompt(dir, 'task-prompt', 'v2 experimental');

    // Phase 1 (architect): uses v2.
    const phase1Prompt = getActivePrompt(dir, 'task-prompt');
    expect(phase1Prompt?.version).toBe(2);

    // Phase 1 records 5 consecutive failures → auto-rollback fires.
    for (let i = 0; i < 5; i++) {
      recordPromptResult(dir, 'task-prompt', false, 20, 1000);
    }

    // Phase 2 (reviewer): live read now returns v1 (rolled back).
    const phase2Prompt = getActivePrompt(dir, 'task-prompt');
    expect(phase2Prompt?.version).toBe(1);

    // GAP-2 confirmed: architect used v2; reviewer got v1 due to auto-rollback.
    expect(phase1Prompt?.version).not.toBe(phase2Prompt?.version);
  });

  it('G-2b: phase 1 own results trigger the rollback that silently harms phase 2', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    registerPrompt(dir, 'task-prompt', 'v2 template');

    const phase1Version = getActivePrompt(dir, 'task-prompt')?.version;

    // Phase 1 records poor results — its own data triggers auto-rollback.
    // 3 successes out of 5 runs = 60% success rate → below 70% threshold.
    recordResults(dir, 'task-prompt', 5, 3);

    const phase2Version = getActivePrompt(dir, 'task-prompt')?.version;

    // Phase 1 was on v2; auto-rollback moved active to v1.
    expect(phase1Version).toBe(2);
    expect(phase2Version).toBe(1);
  });

  it('G-2c: auto-rollback is immediate — active version changes as soon as recordPromptResult returns', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    registerPrompt(dir, 'task-prompt', 'v2 template');

    // Record 4 failures — not yet triggered (< 5 runs).
    for (let i = 0; i < 4; i++) {
      recordPromptResult(dir, 'task-prompt', false, 10, 500);
    }
    // Still v2 active after 4 runs.
    expect(getActivePrompt(dir, 'task-prompt')?.version).toBe(2);

    // 5th failure crosses the threshold — auto-rollback fires synchronously.
    recordPromptResult(dir, 'task-prompt', false, 10, 500);

    // Immediately after the 5th call, v1 is active.
    expect(getActivePrompt(dir, 'task-prompt')?.version).toBe(1);
  });

  it('G-2d: auto-rollback only fires at run 5+; 4 failures do not trigger it', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    registerPrompt(dir, 'task-prompt', 'v2 template');

    // 4 pure failures — auto-rollback must NOT fire (< 5 runs).
    for (let i = 0; i < 4; i++) {
      recordPromptResult(dir, 'task-prompt', false, 10, 500);
    }

    // v2 should still be active.
    expect(getActivePrompt(dir, 'task-prompt')?.version).toBe(2);
  });
});

// ── 4. DB-2: Run-start snapshot mitigation ───────────────────────────────────

describe('DB-2: run-start snapshot is the caller-level mitigation for mid-run divergence', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('S-1: resolving all prompts at run start prevents divergence after manual rollback', () => {
    registerPrompt(dir, 'arch', 'arch-v1');
    registerPrompt(dir, 'arch', 'arch-v2');
    registerPrompt(dir, 'reviewer', 'reviewer-v1');
    registerPrompt(dir, 'reviewer', 'reviewer-v2');

    // Caller snapshots all prompts at run start.
    const runSnapshot = {
      arch: getActivePrompt(dir, 'arch')!,
      reviewer: getActivePrompt(dir, 'reviewer')!,
    };

    // Mid-run rollback.
    rollbackPrompt(dir, 'arch');
    rollbackPrompt(dir, 'reviewer');

    // Each phase uses the snapshotted template, not a live lookup.
    // This simulates the safe pattern: pass template strings, not re-resolve each phase.
    expect(runSnapshot.arch.version).toBe(2);
    expect(runSnapshot.reviewer.version).toBe(2);
    // The snapshot is unaffected by the rollback.
    expect(runSnapshot.arch.template).toBe('arch-v2');
    expect(runSnapshot.reviewer.template).toBe('reviewer-v2');
  });

  it('S-2: snapshot is the caller responsibility — the registry has no built-in run concept', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    registerPrompt(dir, 'task-prompt', 'v2 template');

    // The registry exposes no "begin run / end run" API.
    // A caller doing live lookups each phase cannot avoid mid-run divergence.
    // A caller doing a single snapshot at run start is immune.
    const snapshot = getActivePrompt(dir, 'task-prompt')?.version;

    // Simulate many state changes mid-run.
    rollbackPrompt(dir, 'task-prompt');
    registerPrompt(dir, 'task-prompt', 'v3 template');

    // Live lookup now returns v3, but the snapshot still reflects run-start state.
    const liveNow = getActivePrompt(dir, 'task-prompt')?.version;
    expect(snapshot).toBe(2);   // run-start snapshot
    expect(liveNow).toBe(3);    // current live state
    expect(snapshot).not.toBe(liveNow);
  });

  it('S-3: new registerPrompt after snapshot only affects future live lookups', () => {
    registerPrompt(dir, 'task-prompt', 'v1 template');
    const snapshot = getActivePrompt(dir, 'task-prompt')!;

    // Register v2 after snapshot was taken.
    registerPrompt(dir, 'task-prompt', 'v2 template');

    // Snapshot still holds the v1 object (immutable JS object in memory).
    expect(snapshot.version).toBe(1);
    expect(snapshot.template).toBe('v1 template');

    // Live lookup now returns v2.
    expect(getActivePrompt(dir, 'task-prompt')?.version).toBe(2);
  });
});

// ── 5. DB-3: Auto-rollback threshold correctness ─────────────────────────────

describe('DB-3: auto-rollback threshold — runs >= 5 AND successRate < 0.70', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('T-1: 0 successes out of 5 (0%) → triggers auto-rollback', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2');
    recordResults(dir, 'p', 5, 0); // 0% success rate
    expect(getActivePrompt(dir, 'p')?.version).toBe(1); // rolled back
  });

  it('T-2: 3 successes out of 5 (60%) → triggers auto-rollback', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2');
    recordResults(dir, 'p', 5, 3); // 60% → < 70% → triggers
    expect(getActivePrompt(dir, 'p')?.version).toBe(1);
  });

  it('T-3: 4 successes out of 5 (80%) → does NOT trigger auto-rollback', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2');
    recordResults(dir, 'p', 5, 4); // 80% → >= 70% → no rollback
    expect(getActivePrompt(dir, 'p')?.version).toBe(2); // still v2
  });

  it('T-4: 4 runs, all failures → does NOT trigger (fewer than 5 runs required)', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2');
    recordResults(dir, 'p', 4, 0); // 0% but only 4 runs → no trigger
    expect(getActivePrompt(dir, 'p')?.version).toBe(2); // still v2
  });

  it('T-5: exactly 0.70 success rate (e.g. 7/10) → does NOT trigger (< 0.70, not <=)', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2');
    // 7 successes out of 10 = exactly 70.0% — threshold is strict < 0.70, so no trigger.
    recordResults(dir, 'p', 10, 7);
    expect(getActivePrompt(dir, 'p')?.version).toBe(2);
  });

  it('T-6: auto-rollback when only one version exists → returns null; active version unchanged', () => {
    registerPrompt(dir, 'p', 'v1-only');
    // v1 is the only version — rollback has no prior to restore.
    recordResults(dir, 'p', 5, 0); // would trigger, but there's no v0
    // v1 should still be active (rollback returned null and left state unchanged).
    expect(getActivePrompt(dir, 'p')?.version).toBe(1);
  });
});

// ── 6. DB-4: Multiple prompt keys are independent ────────────────────────────

describe('DB-4: multiple prompt keys are fully independent', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('K-1: rollback of key A does not affect key B', () => {
    registerPrompt(dir, 'arch', 'arch-v1');
    registerPrompt(dir, 'arch', 'arch-v2');
    registerPrompt(dir, 'coder', 'coder-v1');
    registerPrompt(dir, 'coder', 'coder-v2');

    rollbackPrompt(dir, 'arch');

    expect(getActivePrompt(dir, 'arch')?.version).toBe(1);   // rolled back
    expect(getActivePrompt(dir, 'coder')?.version).toBe(2);  // unaffected
  });

  it('K-2: auto-rollback on key A does not affect key B', () => {
    registerPrompt(dir, 'arch', 'arch-v1');
    registerPrompt(dir, 'arch', 'arch-v2');
    registerPrompt(dir, 'coder', 'coder-v1');
    registerPrompt(dir, 'coder', 'coder-v2');

    // Trigger auto-rollback on 'arch'.
    recordResults(dir, 'arch', 5, 0);

    expect(getActivePrompt(dir, 'arch')?.version).toBe(1);   // auto-rolled back
    expect(getActivePrompt(dir, 'coder')?.version).toBe(2);  // unaffected
  });

  it('K-3: stats are per-key — recording on A does not affect B stats', () => {
    registerPrompt(dir, 'arch', 'arch-v1');
    registerPrompt(dir, 'coder', 'coder-v1');

    recordPromptResult(dir, 'arch', true, 90, 500);
    recordPromptResult(dir, 'arch', true, 85, 600);

    const archActive = getActivePrompt(dir, 'arch');
    const coderActive = getActivePrompt(dir, 'coder');

    expect(archActive?.stats.runs).toBe(2);
    expect(coderActive?.stats.runs).toBe(0); // unaffected
  });

  it('K-4: different keys can be at different version numbers independently', () => {
    registerPrompt(dir, 'arch', 'arch-v1');
    registerPrompt(dir, 'arch', 'arch-v2');
    registerPrompt(dir, 'arch', 'arch-v3');
    registerPrompt(dir, 'coder', 'coder-v1');

    expect(getActivePrompt(dir, 'arch')?.version).toBe(3);
    expect(getActivePrompt(dir, 'coder')?.version).toBe(1);
  });
});

// ── 7. DB-5: Rollback is single-step; multiple rollbacks stack ───────────────

describe('DB-5: rollback reverts exactly one version; multiple rollbacks stack', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('R-1: single rollback from v3 → v2 (not v1)', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2'); registerPrompt(dir, 'p', 'v3');
    rollbackPrompt(dir, 'p');
    expect(getActivePrompt(dir, 'p')?.version).toBe(2);
  });

  it('R-2: double rollback v3 → v2 → v1', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2'); registerPrompt(dir, 'p', 'v3');
    rollbackPrompt(dir, 'p'); // → v2
    rollbackPrompt(dir, 'p'); // → v1
    expect(getActivePrompt(dir, 'p')?.version).toBe(1);
  });

  it('R-3: rollback with only one version → returns null, v1 stays active', () => {
    registerPrompt(dir, 'p', 'v1-only');
    const result = rollbackPrompt(dir, 'p');
    expect(result).toBeNull();
    expect(getActivePrompt(dir, 'p')?.version).toBe(1);
  });

  it('R-4: new registerPrompt after rollback creates next sequential version', () => {
    registerPrompt(dir, 'p', 'v1'); registerPrompt(dir, 'p', 'v2');
    rollbackPrompt(dir, 'p'); // → v1 active
    registerPrompt(dir, 'p', 'v3-new'); // next version is 3, not 2
    expect(getActivePrompt(dir, 'p')?.version).toBe(3);
  });

  it('R-5: rollback returns the restored version object', () => {
    registerPrompt(dir, 'p', 'v1 template'); registerPrompt(dir, 'p', 'v2 template');
    const restored = rollbackPrompt(dir, 'p');
    expect(restored?.version).toBe(1);
    expect(restored?.template).toBe('v1 template');
    expect(restored?.isActive).toBe(true);
  });
});

// ── 8. DB-6: Stats persistence before auto-rollback ──────────────────────────

describe('DB-6: auto-rollback stats are persisted before the rollback fires', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('P-1: stats survive reload from disk after manual recording', () => {
    registerPrompt(dir, 'p', 'v1 template');
    recordPromptResult(dir, 'p', true, 90, 400);
    recordPromptResult(dir, 'p', true, 85, 600);

    // Load fresh — simulates a new process reading the persisted data.
    const active = getActivePrompt(dir, 'p');
    expect(active?.stats.runs).toBe(2);
    expect(active?.stats.successRate).toBe(1.0);
    expect(active?.stats.avgConfidence).toBeCloseTo(87.5, 1);
  });

  it('P-2: auto-rollback persists the triggering version stats before switching', () => {
    registerPrompt(dir, 'p', 'v1 stable');
    registerPrompt(dir, 'p', 'v2 experimental');

    // Record 5 failures → auto-rollback to v1.
    // auto-rollback code: registry[key]=versions; save(); rollbackPrompt() — stats saved first.
    for (let i = 0; i < 5; i++) {
      recordPromptResult(dir, 'p', false, 10, 500);
    }

    // v1 is now active.
    const nowActive = getActivePrompt(dir, 'p');
    expect(nowActive?.version).toBe(1);
    expect(nowActive?.stats.runs).toBe(0); // v1 had no recorded results

    // Directly inspect the persisted registry file to verify v2's stats were written
    // to disk before the rollback fired (not lost or reverted by the rollback).
    const registry = JSON.parse(
      readFileSync(require('path').join(dir, '.prompt-registry.json'), 'utf8'),
    ) as Record<string, Array<{ version: number; isActive: boolean; stats: { runs: number; successRate: number; avgConfidence: number; avgLatencyMs: number } }>>;
    const v2Entry = registry['p'].find((v) => v.version === 2);
    expect(v2Entry).toBeDefined();
    expect(v2Entry!.isActive).toBe(false);         // rolled back
    expect(v2Entry!.stats.runs).toBe(5);            // 5 results were recorded against v2
    expect(v2Entry!.stats.successRate).toBeCloseTo(0.0, 5); // all failures
    expect(v2Entry!.stats.avgConfidence).toBeCloseTo(10, 1);
    expect(v2Entry!.stats.avgLatencyMs).toBeCloseTo(500, 1);
  });

  it('P-3: recording a mix of results computes rolling averages correctly', () => {
    registerPrompt(dir, 'p', 'v1 template');
    recordPromptResult(dir, 'p', true, 100, 1000);  // run 1: success, 100 conf, 1000ms
    recordPromptResult(dir, 'p', false, 60, 2000);  // run 2: failure, 60 conf, 2000ms
    recordPromptResult(dir, 'p', true, 80, 500);    // run 3: success, 80 conf, 500ms

    const active = getActivePrompt(dir, 'p');
    expect(active?.stats.runs).toBe(3);
    // successRate = (0+1+0+1+1)/3... let's compute:
    // After run 1: successRate = (0*0 + 1)/1 = 1.0
    // After run 2: successRate = (1.0*1 + 0)/2 = 0.5
    // After run 3: successRate = (0.5*2 + 1)/3 = 2/3 ≈ 0.667
    expect(active?.stats.successRate).toBeCloseTo(2 / 3, 5);
    // avgConfidence = (100+60+80)/3 via rolling average:
    // After run 1: 100/1 = 100
    // After run 2: (100*1+60)/2 = 80
    // After run 3: (80*2+80)/3 = 240/3 = 80
    expect(active?.stats.avgConfidence).toBeCloseTo(80, 1);
    // avgLatencyMs = (1000+2000+500)/3 via rolling average:
    // After run 1: 1000
    // After run 2: (1000+2000)/2 = 1500
    // After run 3: (1500*2+500)/3 = 3500/3 ≈ 1166.7
    expect(active?.stats.avgLatencyMs).toBeCloseTo(1166.7, 0);
  });

  it('P-4: stats are not reset when a new version is registered', () => {
    registerPrompt(dir, 'p', 'v1 template');
    recordPromptResult(dir, 'p', true, 90, 400);
    expect(getActivePrompt(dir, 'p')?.stats.runs).toBe(1);

    // Register v2 — v1 is deactivated but its stats should still be persisted.
    registerPrompt(dir, 'p', 'v2 template');
    const v2Active = getActivePrompt(dir, 'p');
    expect(v2Active?.version).toBe(2);
    expect(v2Active?.stats.runs).toBe(0); // v2 has no results yet

    // Rollback to v1 — its stats should still be there.
    rollbackPrompt(dir, 'p');
    const v1Restored = getActivePrompt(dir, 'p');
    expect(v1Restored?.version).toBe(1);
    expect(v1Restored?.stats.runs).toBe(1); // v1 stats persisted across version changes
  });
});
