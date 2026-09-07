/**
 * Unit tests for new security services: sbom-generator, license-checker,
 * cve-scanner (offline mocked), audit-log, dry-run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Test helpers ───────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'qodo-test-'));
}

function writeFakeLock(dir: string, packages: Record<string, { version: string; license?: string | { type: string; url?: string } }>): void {
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
}

// ── SBOM Generator ─────────────────────────────────────────────────────────
import { generateSbom } from '../src/services/sbom-generator.js';

describe('sbom-generator', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('produces a CycloneDX 1.4 SBOM', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
      'node_modules/express': { version: '4.18.0', license: 'MIT' },
    });
    const sbom = generateSbom(dir);
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.4');
    expect(sbom.components.length).toBe(2);
    expect(sbom.components[0].type).toBe('library');
    expect(sbom.components[0].purl).toMatch(/^pkg:npm\//);
  });

  it('assigns SHA-256 hash to every component', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/chalk': { version: '5.0.0', license: 'MIT' },
    });
    const sbom = generateSbom(dir);
    expect(sbom.components[0].hashes[0].alg).toBe('SHA-256');
    expect(sbom.components[0].hashes[0].content).toHaveLength(64);
  });

  it('normalizes object-style license to a string id (Bug 18-B regression)', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/dual-license-pkg': { version: '2.0.0', license: { type: 'Apache-2.0', url: 'https://example.com' } },
    });
    const sbom = generateSbom(dir);
    expect(sbom.components[0].licenses?.[0].license.id).toBe('Apache-2.0');
  });
});

// ── License Checker ────────────────────────────────────────────────────────
import { checkLicenses } from '../src/services/license-checker.js';

describe('license-checker', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('passes when all licenses are allowed', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/b': { version: '1.0.0', license: 'Apache-2.0' },
    });
    const report = checkLicenses(dir);
    expect(report.passed).toBe(true);
    expect(report.violations.filter((v) => v.reason === 'denied')).toHaveLength(0);
  });

  it('flags denied GPL licenses', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-pkg': { version: '1.0.0', license: 'GPL-3.0' },
    });
    const report = checkLicenses(dir);
    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.reason === 'denied')).toBe(true);
  });

  it('handles npm object-style license without throwing (Bug 18-B regression)', () => {
    // package-lock v3 sometimes stores license as { type: 'MIT', url: '...' }
    // rather than a plain string. Previously license.trim() threw TypeError.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/dual-license-pkg': { version: '2.0.0', license: { type: 'MIT', url: 'https://opensource.org/licenses/MIT' } },
    });
    const report = checkLicenses(dir);
    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

// ── Audit Log ──────────────────────────────────────────────────────────────
import { appendAuditEntry, verifyAuditChain } from '../src/services/audit-log.js';

describe('audit-log', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates valid chain with multiple entries', () => {
    appendAuditEntry(dir, 'run.start', 'ci', { runId: 'abc' });
    appendAuditEntry(dir, 'patch.applied', 'agent', { file: 'src/index.ts' });
    appendAuditEntry(dir, 'run.end', 'ci', { status: 'success' });
    expect(verifyAuditChain(dir).valid).toBe(true);
  });

  it('returns valid=true for empty log', () => {
    expect(verifyAuditChain(dir).valid).toBe(true);
  });

  it('recovers from corrupt last line without crashing (Bug 14-C regression)', () => {
    // Write two valid entries then append a truncated/corrupt line.
    appendAuditEntry(dir, 'run.start', 'ci', { runId: 'x1' });
    appendAuditEntry(dir, 'patch.applied', 'agent', { file: 'foo.ts' });
    // Simulate an abrupt-termination partial write — corrupt final line.
    appendFileSync(join(dir, '.audit-log.ndjson'), '{"seq":2,"timestamp":"2026-07-06T00:00\n');
    // appendAuditEntry must not throw; it treats the corrupt tail as missing.
    expect(() => appendAuditEntry(dir, 'run.end', 'ci', { status: 'success' })).not.toThrow();
  });
});

// ── Darwin Engine — fitness evaluation (Bug 15-E regression) ───────────────
import { evaluateMutationFitness } from '../src/agents/darwin-engine.js';
import type { RedisState } from '../src/services/redis-state.js';
import type { MutationBaseline } from '../src/agents/darwin-engine.js';

describe('darwin-engine — fitness evaluation division-by-zero guard', () => {
  it('returns false without opening a revert PR when baselineLatencyMs is 0 (Bug 15-E)', async () => {
    // Previously: delta = (current - 0) / 0 = Infinity; Infinity <= 0.2 is
    // false, so the regression branch fired and opened a spurious revert PR.
    const fakeBaseline: MutationBaseline = {
      mutationId: 'mut-test',
      mergedAt: new Date().toISOString(),
      baselineLatencyMs: 0, // invalid — triggers the division-by-zero
    };

    const fakeState = {
      getJSON: async () => fakeBaseline,
      setJSON: async () => {},
    } as unknown as RedisState;

    const fakeGh = {
      createBranchAndPR: vi.fn(),
      commitViaGitDB: vi.fn(),
    } as unknown as import('../src/services/github-client.js').GitHubClient;

    const opened = await evaluateMutationFitness(
      500,          // currentLatencyMs — anything positive
      'test-owner',
      'test-repo',
      fakeGh,
      fakeState,
    );

    // Must not open a revert PR and must return false cleanly.
    expect(opened).toBe(false);
    expect(fakeGh.createBranchAndPR).not.toHaveBeenCalled();
  });
});

// ── SRE Feedback Loop — no-provider guard (Bug 16-C regression) ────────────
import { runSreFeedbackLoop } from '../src/services/sre-feedback.js';

describe('sre-feedback — empty logs must not be reported as healthy (Bug 16-C regression)', () => {
  it('returns skipped:true when no log provider is configured instead of reverted:false', async () => {
    // Previously: fetchProductionLogs() returned [] when neither Axiom nor
    // Vercel credentials were present. An empty array passed the
    // fiveXx.length === 0 && slow.length === 0 check and returned
    // { reverted: false } — indistinguishable from a genuinely healthy
    // deployment, silently bypassing the SRE gate.
    const fakeGh = {
      revertMergeCommitWithNewCommit: vi.fn(),
    } as unknown as import('../src/services/github-client.js').GitHubClient;

    const result = await runSreFeedbackLoop(
      fakeGh,
      {
        prNumber: 1,
        objective: 'test',
        owner: 'owner',
        repo: 'repo',
        githubToken: 'tok',
      },
      undefined,
      // No AXIOM_TOKEN and no VERCEL_TOKEN → no log provider.
      {},
    );

    expect(result.skipped).toBe(true);
    expect(result.reverted).toBe(false);
    expect(result.reason).toMatch(/no log provider/i);
    // Must NOT have attempted a revert.
    expect(fakeGh.revertMergeCommitWithNewCommit).not.toHaveBeenCalled();
  });
});

// ── Edge Fragment — no stray clearTimeout (Bug 16-D regression) ─────────────
import { parseViaEdgeSwarm, chunkSource } from '../src/services/edge-fragment.js';

describe('edge-fragment — dispatchChunk must not throw ReferenceError (Bug 16-D regression)', () => {
  it('gracefully falls back to in-process parsing without ReferenceError when worker URL is invalid', async () => {
    // Before the fix, the finally { clearTimeout(timeout) } block in
    // dispatchChunk referenced an undeclared `timeout` variable.  In strict
    // mode this is a ReferenceError.  With a non-existent workerUrl the catch
    // branch fires, which previously also triggered the finally block.
    const chunks = chunkSource('export function foo(x: string) { return x; }');
    await expect(
      parseViaEdgeSwarm(chunks, 'http://127.0.0.1:1/non-existent-worker'),
    ).resolves.toBeDefined();
  });
});

// ── Dry Run ────────────────────────────────────────────────────────────────
import { initDryRun, isDryRun, dryRunSkip, getDryRunReport } from '../src/services/dry-run.js';
import { loadCveShelf } from '../src/services/cve-scanner.js';

describe('dry-run', () => {
  it('activates via --dry-run arg', () => {
    initDryRun(['--dry-run']);
    expect(isDryRun()).toBe(true);
  });

  it('skips actions and records them in report', () => {
    initDryRun(['--dry-run']);
    const skipped = dryRunSkip('git-commit', 'main');
    expect(skipped).toBe(true);
    const report = getDryRunReport();
    expect(report.mode).toBe('dry-run');
    expect(report.wouldCommit).toBe(true);
    expect(report.simulatedActions).toHaveLength(1);
  });
});

// ── CVE Shelf ─────────────────────────────────────────────────────────────
describe('cve-scanner — shelf corruption guard (Bug 18-E regression)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns empty array when the CVE shelf is corrupt JSON', () => {
    writeFileSync(join(dir, '.cve-shelf.json'), '{"broken": ');
    const entries = loadCveShelf(dir);
    expect(entries).toEqual([]);
  });

  it('returns empty array when the CVE shelf is not an array', () => {
    writeFileSync(join(dir, '.cve-shelf.json'), JSON.stringify({ count: 3 }));
    const entries = loadCveShelf(dir);
    expect(entries).toEqual([]);
  });
});
