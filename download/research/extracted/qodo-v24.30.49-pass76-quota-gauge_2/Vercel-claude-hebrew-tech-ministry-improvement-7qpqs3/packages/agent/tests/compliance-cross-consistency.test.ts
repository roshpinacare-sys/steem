/**
 * Pass 63 — Task-27: Compliance-oracle / SBOM / license-checker cross-consistency check.
 *
 * Three subsystems independently enumerate the repository's dependency tree and
 * compliance landscape from the same source files. This file verifies that their
 * outputs are mutually consistent and documents cases where they diverge.
 *
 * Subsystems under test:
 *   sbom-generator.ts  — CycloneDX 1.4 SBOM from package-lock.json
 *   license-checker.ts — allow/deny policy from package-lock.json
 *   compliance-oracle.ts — PR-generating infrastructure scanner (Dockerfile / CI / K8s)
 *
 * Cross-consistency properties verified:
 *
 *   C-1..C-5  Package enumeration: SBOM and license-checker read the same
 *             package set from the same lockfile (count, names, versions).
 *   C-6..C-9  License agreement: for packages with non-empty license strings,
 *             both subsystems extract the same value.
 *   GAP-1     Missing license normalization divergence (Medium): undefined/null license →
 *             SBOM omits the 'licenses' array; license-checker reports reason:'unknown'
 *             with the sentinel string 'UNKNOWN'. A cross-consumer sees inconsistent
 *             signals from the two subsystems for the same package.
 *   GAP-2     Empty string license divergence (Low): license:'' → same divergence
 *             as GAP-1 (trim() collapses to '' → falsy in SBOM; 'UNKNOWN' in checker).
 *   DB-1      Object-style license ({ type: 'X' }) is normalized consistently by both.
 *   DB-2      Compliance-oracle scope (infrastructure files) is orthogonal to
 *             SBOM/license-checker scope (dependency tree) — no cross-interference.
 *   DB-3      Root package (empty lockfile key '') is skipped consistently by both.
 *   DB-4      Package name normalization (node_modules/ prefix stripping) is identical.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { generateSbom } from '../src/services/sbom-generator.js';
import { checkLicenses } from '../src/services/license-checker.js';
import { runComplianceScan } from '../src/agents/compliance-oracle.js';
import type { GitHubClient } from '../src/services/github-client.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'qodo-cross-'));
}

function writeFakeLock(
  dir: string,
  packages: Record<string, { version: string; license?: unknown }>,
  useDependenciesKey = false,
): void {
  const lockfileVersion = useDependenciesKey ? 2 : 3;
  const payload = useDependenciesKey
    ? { lockfileVersion, dependencies: packages }
    : { lockfileVersion, packages };
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(payload));
}

/** Build a minimal GitHubClient mock suitable for runComplianceScan. */
function makeGhMock(
  allFiles: string[],
  fileMap: Record<string, string>,
): GitHubClient {
  return {
    listFilesAtRef: vi.fn().mockResolvedValue(allFiles),
    getFileAtRef: vi.fn().mockImplementation(async (path: string) => fileMap[path] ?? null),
  } as unknown as GitHubClient;
}

// Shared fixture lockfiles used across describe blocks.
const CLEAN_LOCK = {
  '': { version: '0.0.0' },
  'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
  'node_modules/express': { version: '4.18.0', license: 'MIT' },
  'node_modules/@scope/util': { version: '2.0.0', license: 'Apache-2.0' },
} as Record<string, { version: string; license?: unknown }>;

const MIXED_LOCK = {
  '': { version: '0.0.0' },
  'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
  'node_modules/bad-lib': { version: '1.0.0', license: 'GPL-3.0' },
  'node_modules/unknown-lib': { version: '0.5.0' }, // no license field
} as Record<string, { version: string; license?: unknown }>;

// Infrastructure fixture strings for compliance-oracle tests.
const DOCKERFILE_NO_USER =
  'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.js"]\n';
const DOCKERFILE_WITH_USER =
  'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nUSER 10001\nCMD ["node", "server.js"]\n';
const WORKFLOW_NO_TIMEOUT =
  'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n';
const WORKFLOW_WITH_TIMEOUT =
  'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - uses: actions/checkout@v4\n';
const K8S_NO_RESOURCES =
  'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: myapp:latest\n';
const K8S_WITH_RESOURCES =
  'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: myapp:latest\n          resources:\n            requests:\n              cpu: "100m"\n';

// ── 1. Package enumeration cross-consistency ──────────────────────────────────

describe('package enumeration cross-consistency (SBOM ↔ license-checker)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('C-1: both report the same non-root package count from a clean lockfile', () => {
    writeFakeLock(dir, CLEAN_LOCK);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    // SBOM skips the root ('') entry; license-checker does too.
    // report.checked counts all non-root entries; sbom.components.length should match.
    expect(sbom.components.length).toBe(report.checked);
  });

  it('C-2: SBOM component names match the expected normalized names (same regex as checker)', () => {
    writeFakeLock(dir, CLEAN_LOCK);
    const sbom = generateSbom(dir);
    // Both services normalize via: key.replace(/^node_modules\//, '').replace(/node_modules\//g, '/')
    const expectedNames = Object.keys(CLEAN_LOCK)
      .filter((k) => k !== '')
      .map((k) => k.replace(/^node_modules\//, '').replace(/node_modules\//g, '/'));
    const sbomNameSet = new Set(sbom.components.map((c) => c.name));
    for (const name of expectedNames) {
      expect(sbomNameSet).toContain(name);
    }
    expect(sbomNameSet.size).toBe(expectedNames.length);
  });

  it('C-3: SBOM component versions match lockfile entries (checker uses the same source)', () => {
    writeFakeLock(dir, CLEAN_LOCK);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    // No violations expected from a clean lockfile.
    expect(report.passed).toBe(true);
    for (const component of sbom.components) {
      const lockKey = `node_modules/${component.name}`;
      const lockEntry = (CLEAN_LOCK as Record<string, { version: string }>)[lockKey];
      if (lockEntry) {
        expect(component.version).toBe(lockEntry.version);
      }
    }
  });

  it('C-4: scoped packages (@scope/pkg) are enumerated consistently by both subsystems', () => {
    const scopedLock = {
      '': { version: '0.0.0' },
      'node_modules/@scope/util': { version: '1.2.3', license: 'MIT' },
      'node_modules/@scope/deep/node_modules/nested': { version: '0.1.0', license: 'ISC' },
    } as Record<string, { version: string; license?: unknown }>;
    writeFakeLock(dir, scopedLock);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    expect(sbom.components.length).toBe(report.checked);
    expect(sbom.components.length).toBe(2);
  });

  it('C-5: lockfileVersion 2 (dependencies key) — both enumerate the same count', () => {
    const pkgs = {
      '': { version: '0.0.0' },
      'node_modules/chalk': { version: '5.0.0', license: 'MIT' },
      'node_modules/semver': { version: '7.0.0', license: 'ISC' },
    } as Record<string, { version: string; license?: unknown }>;
    writeFakeLock(dir, pkgs, /* useDependenciesKey= */ true);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    expect(sbom.components.length).toBe(report.checked);
    expect(sbom.components.length).toBe(2);
  });
});

// ── 2. License data cross-consistency (non-empty license strings) ─────────────

describe('license data cross-consistency (non-empty license strings)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('C-6: MIT package — SBOM stores "MIT"; license-checker reports no violation', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/chalk': { version: '5.0.0', license: 'MIT' },
    });
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'chalk');
    expect(comp?.licenses?.[0].license.id).toBe('MIT');
    expect(report.violations.some((v) => v.packageName === 'chalk')).toBe(false);
  });

  it('C-7: GPL-3.0 package — SBOM stores "GPL-3.0"; license-checker flags denied; both agree on the string', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/copyleft': { version: '1.0.0', license: 'GPL-3.0' },
    });
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'copyleft');
    const violation = report.violations.find((v) => v.packageName === 'copyleft');
    expect(comp?.licenses?.[0].license.id).toBe('GPL-3.0');
    expect(violation?.reason).toBe('denied');
    // Both subsystems must agree on the license string value.
    expect(comp?.licenses?.[0].license.id).toBe(violation?.license);
  });

  it('C-8: Apache-2.0 package — both agree, no violation', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/aws-sdk': { version: '3.0.0', license: 'Apache-2.0' },
    });
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'aws-sdk');
    expect(comp?.licenses?.[0].license.id).toBe('Apache-2.0');
    expect(report.violations.some((v) => v.packageName === 'aws-sdk')).toBe(false);
    expect(report.passed).toBe(true);
  });

  it('C-9: mixed lockfile — SBOM and license-checker agree on license strings for denied packages', () => {
    writeFakeLock(dir, MIXED_LOCK);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const deniedViolations = report.violations.filter((v) => v.reason === 'denied');
    for (const violation of deniedViolations) {
      const comp = sbom.components.find((c) => c.name === violation.packageName);
      expect(comp).toBeDefined();
      // The license string in the SBOM must match what the checker flagged.
      expect(comp?.licenses?.[0].license.id).toBe(violation.license);
    }
  });
});

// ── 3. GAP-1: Missing license normalization divergence ───────────────────────

describe('GAP-1: missing license field normalization divergence', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('G-1a: package with no license field — SBOM omits the licenses array', () => {
    // sbom-generator.ts normalizeLicense: undefined → '' (empty string → falsy)
    // → the `if (licenseId)` guard prevents adding the licenses field.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/no-license-pkg': { version: '1.0.0' },
    });
    const sbom = generateSbom(dir);
    const comp = sbom.components.find((c) => c.name === 'no-license-pkg');
    expect(comp).toBeDefined();
    expect(comp?.licenses).toBeUndefined();
  });

  it('G-1b: package with no license field — license-checker reports reason:"unknown"', () => {
    // license-checker.ts normalizeLicense: undefined → 'UNKNOWN'
    // → 'UNKNOWN' not in allowed list → reason:'unknown' violation.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/no-license-pkg': { version: '1.0.0' },
    });
    const report = checkLicenses(dir);
    const violation = report.violations.find((v) => v.packageName === 'no-license-pkg');
    expect(violation).toBeDefined();
    expect(violation?.reason).toBe('unknown');
    expect(violation?.license).toBe('UNKNOWN');
  });

  it('G-1c (GAP-1 confirmed): SBOM and license-checker diverge on missing-license packages', () => {
    // A cross-consumer comparing both for the same package sees:
    //   SBOM: no licenses array (treats as "no info available")
    //   license-checker: explicit 'UNKNOWN' violation (treats as "flagged problematic")
    // There is no common license value to reconcile — the subsystems signal different
    // things to different consumers without a reconciliation layer.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/no-license-pkg': { version: '1.0.0' },
    });
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'no-license-pkg');
    const violation = report.violations.find((v) => v.packageName === 'no-license-pkg');
    // SBOM: silent — no license data recorded.
    expect(comp?.licenses).toBeUndefined();
    // license-checker: vocal — explicit 'UNKNOWN' string.
    expect(violation?.license).toBe('UNKNOWN');
    // The divergence: there is no common value to compare between them.
    expect(comp?.licenses?.[0]?.license?.id).toBeUndefined();
    expect(violation?.license).not.toBeUndefined();
  });

  it('G-1d: null license value — same divergence pattern as missing field', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/null-license': { version: '2.0.0', license: null },
    } as Record<string, { version: string; license?: unknown }>);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'null-license');
    const violation = report.violations.find((v) => v.packageName === 'null-license');
    expect(comp?.licenses).toBeUndefined();
    expect(violation?.reason).toBe('unknown');
    expect(violation?.license).toBe('UNKNOWN');
  });
});

// ── 4. GAP-2: Empty string license divergence ────────────────────────────────

describe('GAP-2: empty string license divergence', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('G-2a: license:"" — SBOM omits the licenses array', () => {
    // normalizeLicense('') → ''.trim() = '' → falsy → no licenses field added.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/empty-license': { version: '1.0.0', license: '' },
    });
    const sbom = generateSbom(dir);
    const comp = sbom.components.find((c) => c.name === 'empty-license');
    expect(comp?.licenses).toBeUndefined();
  });

  it('G-2b: license:"" — license-checker flags reason:"unknown" with license:""', () => {
    // license-checker normalizeLicense('') → ''.trim() = '' (empty string is returned as-is,
    // not replaced by 'UNKNOWN' — that sentinel only comes from the else clause for
    // undefined/null/non-type-object inputs). '' is not in denied or allowed lists → reason:'unknown'.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/empty-license': { version: '1.0.0', license: '' },
    });
    const report = checkLicenses(dir);
    const violation = report.violations.find((v) => v.packageName === 'empty-license');
    expect(violation).toBeDefined();
    expect(violation?.reason).toBe('unknown');
    // Key distinction from GAP-1: the license field is '' (empty string), NOT 'UNKNOWN'.
    // 'UNKNOWN' is only produced by the else clause for non-string/non-type-object inputs.
    expect(violation?.license).toBe('');
  });

  it('G-2c (GAP-2 confirmed): whitespace-only license — trimmed to "" → same divergence as empty string', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/ws-license': { version: '0.1.0', license: '   ' },
    });
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'ws-license');
    const violation = report.violations.find((v) => v.packageName === 'ws-license');
    // After trim(): '   ' → '' (falsy) → SBOM: no licenses field.
    expect(comp?.licenses).toBeUndefined();
    // license-checker: normalizeLicense('   ') → '' → reason:'unknown', license:''.
    expect(violation?.reason).toBe('unknown');
    expect(violation?.license).toBe('');
  });

  it('G-2d: package count agrees but license semantics diverge for empty-string licenses', () => {
    const pkgs = {
      '': { version: '0.0.0' },
      'node_modules/ok-pkg': { version: '1.0.0', license: 'MIT' },
      'node_modules/empty-license': { version: '1.0.0', license: '' },
    } as Record<string, { version: string; license?: unknown }>;
    writeFakeLock(dir, pkgs);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    // Package count is consistent (both enumerate 2 non-root packages).
    expect(sbom.components.length).toBe(report.checked);
    // license-checker flags one 'unknown' with license:''; SBOM records no licenses field for it.
    const unknownViolations = report.violations.filter((v) => v.reason === 'unknown');
    expect(unknownViolations).toHaveLength(1);
    // For GAP-2 specifically: the violation license is '' (empty string), not 'UNKNOWN'.
    expect(unknownViolations[0].license).toBe('');
    const emptyComp = sbom.components.find((c) => c.name === 'empty-license');
    expect(emptyComp?.licenses).toBeUndefined(); // SBOM: silent; license-checker: vocal
  });
});

// ── 5. DB-1: Object-style license normalized consistently ────────────────────

describe('DB-1: object-style license ({ type: "X" }) is normalized consistently', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('DB-1a: { type: "MIT" } — SBOM stores "MIT"; license-checker passes', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/dual-license': {
        version: '2.0.0',
        license: { type: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      },
    } as Record<string, { version: string; license?: unknown }>);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'dual-license');
    expect(comp?.licenses?.[0].license.id).toBe('MIT');
    expect(report.violations.some((v) => v.packageName === 'dual-license')).toBe(false);
    expect(report.passed).toBe(true);
  });

  it('DB-1b: { type: "GPL-3.0" } — both extract "GPL-3.0"; license-checker denies', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-obj': { version: '1.0.0', license: { type: 'GPL-3.0' } },
    } as Record<string, { version: string; license?: unknown }>);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'gpl-obj');
    const violation = report.violations.find((v) => v.packageName === 'gpl-obj');
    // Both agree on the license string value — this is the expected consistent case.
    expect(comp?.licenses?.[0].license.id).toBe('GPL-3.0');
    expect(violation?.license).toBe('GPL-3.0');
    expect(violation?.reason).toBe('denied');
  });

  it('DB-1c: object without "type" property — falls through to else → GAP-1 divergence applies', () => {
    // An object-style license without a 'type' key hits the else clause in both
    // normalizeLicense functions, but they return different things:
    //   SBOM: '' (falsy) → no licenses field
    //   license-checker: 'UNKNOWN' → unknown violation
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/weird-license': { version: '1.0.0', license: { name: 'Proprietary' } },
    } as Record<string, { version: string; license?: unknown }>);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const comp = sbom.components.find((c) => c.name === 'weird-license');
    const violation = report.violations.find((v) => v.packageName === 'weird-license');
    expect(comp?.licenses).toBeUndefined();
    expect(violation?.reason).toBe('unknown');
  });
});

// ── 6. Compliance-oracle internal consistency ─────────────────────────────────

describe('compliance-oracle internal consistency (deterministic, idempotent)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('O-1: Dockerfile without USER — one high-severity finding; deterministic across calls', async () => {
    const gh = makeGhMock(['Dockerfile'], { Dockerfile: DOCKERFILE_NO_USER });
    const findings1 = await runComplianceScan(gh);
    const findings2 = await runComplianceScan(gh);
    expect(findings1).toHaveLength(1);
    expect(findings1[0].rule).toBe('dockerfile-no-root');
    expect(findings1[0].severity).toBe('high');
    // Second call produces identical result (determinism).
    expect(findings2).toHaveLength(1);
    expect(findings2[0].rule).toBe(findings1[0].rule);
    expect(findings2[0].severity).toBe(findings1[0].severity);
  });

  it('O-2: Dockerfile with USER — no findings', async () => {
    const gh = makeGhMock(['Dockerfile'], { Dockerfile: DOCKERFILE_WITH_USER });
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(0);
  });

  it('O-3: CI workflow without timeout-minutes — one medium-severity finding', async () => {
    const gh = makeGhMock(
      ['.github/workflows/ci.yml'],
      { '.github/workflows/ci.yml': WORKFLOW_NO_TIMEOUT },
    );
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('workflow-missing-timeout');
    expect(findings[0].severity).toBe('medium');
  });

  it('O-4: CI workflow with timeout-minutes — no findings', async () => {
    const gh = makeGhMock(
      ['.github/workflows/ci.yml'],
      { '.github/workflows/ci.yml': WORKFLOW_WITH_TIMEOUT },
    );
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(0);
  });

  it('O-5: K8s manifest without resources — one high-severity finding', async () => {
    const gh = makeGhMock(
      ['k8s/deployment.yaml'],
      { 'k8s/deployment.yaml': K8S_NO_RESOURCES },
    );
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('k8s-missing-resources');
    expect(findings[0].severity).toBe('high');
  });

  it('O-6: K8s manifest with resources — no findings', async () => {
    const gh = makeGhMock(
      ['k8s/deployment.yaml'],
      { 'k8s/deployment.yaml': K8S_WITH_RESOURCES },
    );
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(0);
  });

  it('O-7: multiple non-compliant files — findings ordered Dockerfile → workflow → k8s', async () => {
    const gh = makeGhMock(
      ['Dockerfile', '.github/workflows/ci.yml', 'k8s/deployment.yaml'],
      {
        Dockerfile: DOCKERFILE_NO_USER,
        '.github/workflows/ci.yml': WORKFLOW_NO_TIMEOUT,
        'k8s/deployment.yaml': K8S_NO_RESOURCES,
      },
    );
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(3);
    // The oracle processes dockerfiles → workflows → k8s in that order.
    expect(findings[0].rule).toBe('dockerfile-no-root');
    expect(findings[1].rule).toBe('workflow-missing-timeout');
    expect(findings[2].rule).toBe('k8s-missing-resources');
  });

  it('O-8: listFilesAtRef throws — oracle swallows the error and returns empty findings', async () => {
    const gh = {
      listFilesAtRef: vi.fn().mockRejectedValue(new Error('network error')),
      getFileAtRef: vi.fn(),
    } as unknown as GitHubClient;
    const findings = await runComplianceScan(gh);
    expect(findings).toHaveLength(0);
  });

  it('O-9: getFileAtRef returns null for a file — oracle skips that file and continues', async () => {
    // The oracle's fetchFiles helper calls gh.getFileAtRef().catch(() => null) and skips
    // entries where content === null. This tests the null-return path (file not found or
    // access denied), which is handled identically to an exception by the .catch() guard.
    const gh = {
      listFilesAtRef: vi.fn().mockResolvedValue(['Dockerfile', '.github/workflows/ci.yml']),
      getFileAtRef: vi.fn()
        .mockResolvedValueOnce(null)               // Dockerfile fetch returns null → skipped
        .mockResolvedValueOnce(WORKFLOW_NO_TIMEOUT), // workflow fetch succeeds
    } as unknown as GitHubClient;
    const findings = await runComplianceScan(gh);
    // Dockerfile produced no finding (null content → skipped by fetchFiles).
    // Workflow produced one finding.
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('workflow-missing-timeout');
  });
});

// ── 7. DB-2: Scope separation — oracle ↔ SBOM / license-checker ──────────────

describe('DB-2: compliance-oracle and SBOM/license-checker have orthogonal scopes', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('S-1: GPL dependency in lockfile does not affect oracle findings', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-lib': { version: '1.0.0', license: 'GPL-3.0' },
    });
    const gh = makeGhMock(
      ['Dockerfile'],
      { Dockerfile: DOCKERFILE_WITH_USER }, // clean Dockerfile
    );
    const [oracleFindings, licenseReport] = await Promise.all([
      runComplianceScan(gh),
      Promise.resolve(checkLicenses(dir)),
    ]);
    // Oracle: sees only infrastructure — clean Dockerfile → no findings.
    expect(oracleFindings).toHaveLength(0);
    // License-checker: catches the GPL violation from the dependency tree.
    expect(licenseReport.passed).toBe(false);
    expect(licenseReport.violations.some((v) => v.reason === 'denied')).toBe(true);
  });

  it('S-2: rootless Dockerfile does not affect SBOM or license-checker output', () => {
    // Scenario: Dockerfile is missing USER (oracle will flag it), but all
    // dependencies are clean. SBOM and license-checker are unaffected.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
    });
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    // Neither SBOM nor license-checker reads Dockerfiles.
    expect(sbom.components.length).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('S-3: SBOM and license-checker (sync) can run concurrently with oracle (async)', async () => {
    writeFakeLock(dir, CLEAN_LOCK);
    const gh = makeGhMock([], {}); // no files → no oracle findings
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    const oracleFindings = await runComplianceScan(gh);
    expect(sbom.components.length).toBe(3);
    expect(report.passed).toBe(true);
    expect(oracleFindings).toHaveLength(0);
  });

  it('S-4: DB-2 confirmed — adding K8s non-compliance does not change SBOM component count', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
    });
    const gh = makeGhMock(
      ['k8s/deployment.yaml'],
      { 'k8s/deployment.yaml': K8S_NO_RESOURCES },
    );
    const sbom = generateSbom(dir);
    const oracleFindings = await runComplianceScan(gh);
    expect(sbom.components.length).toBe(1);          // unaffected by K8s findings
    expect(oracleFindings[0].rule).toBe('k8s-missing-resources');
  });
});

// ── 8. Three-subsystem consistency matrix ─────────────────────────────────────

describe('three-subsystem consistency matrix', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('M-1: clean dependency tree + clean infrastructure — all three report clean', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
    });
    const gh = makeGhMock(
      ['Dockerfile'],
      { Dockerfile: DOCKERFILE_WITH_USER },
    );
    const [sbom, report, findings] = await Promise.all([
      Promise.resolve(generateSbom(dir)),
      Promise.resolve(checkLicenses(dir)),
      runComplianceScan(gh),
    ]);
    expect(sbom.components.length).toBe(1);
    expect(report.passed).toBe(true);
    expect(findings).toHaveLength(0);
  });

  it('M-2: GPL dependency + rootless Dockerfile — each subsystem flags its own scope', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-lib': { version: '1.0.0', license: 'GPL-3.0' },
    });
    const gh = makeGhMock(
      ['Dockerfile'],
      { Dockerfile: DOCKERFILE_NO_USER },
    );
    const [sbom, report, findings] = await Promise.all([
      Promise.resolve(generateSbom(dir)),
      Promise.resolve(checkLicenses(dir)),
      runComplianceScan(gh),
    ]);
    // SBOM records the GPL component with its license.
    const gplComp = sbom.components.find((c) => c.name === 'gpl-lib');
    expect(gplComp?.licenses?.[0].license.id).toBe('GPL-3.0');
    // License-checker denies it.
    expect(report.passed).toBe(false);
    expect(report.violations[0].reason).toBe('denied');
    // SBOM and license-checker agree on the license string.
    expect(gplComp?.licenses?.[0].license.id).toBe(report.violations[0].license);
    // Oracle flags the missing USER directive.
    expect(findings[0].rule).toBe('dockerfile-no-root');
  });

  it('M-3: two full three-subsystem scans are deterministic', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-lib': { version: '1.0.0', license: 'GPL-3.0' },
    });
    const gh = makeGhMock(
      ['Dockerfile'],
      { Dockerfile: DOCKERFILE_NO_USER },
    );
    const run = async () => ({
      sbom: generateSbom(dir),
      report: checkLicenses(dir),
      findings: await runComplianceScan(gh),
    });
    const result1 = await run();
    const result2 = await run();
    expect(result1.sbom.components.length).toBe(result2.sbom.components.length);
    expect(result1.report.violations.length).toBe(result2.report.violations.length);
    expect(result1.findings.length).toBe(result2.findings.length);
    expect(result1.findings[0]?.rule).toBe(result2.findings[0]?.rule);
  });

  it('M-4 (DB-3): root package (empty key) is skipped consistently by both SBOM and license-checker', () => {
    const lockWithRoot = {
      '': { version: '1.2.3', license: 'MIT' }, // root — must be skipped
      'node_modules/dep': { version: '0.0.1', license: 'MIT' },
    } as Record<string, { version: string; license?: unknown }>;
    writeFakeLock(dir, lockWithRoot);
    const sbom = generateSbom(dir);
    const report = checkLicenses(dir);
    // Root is skipped by both; only 'dep' is counted.
    expect(sbom.components.length).toBe(1);
    expect(report.checked).toBe(1);
    // Neither subsystem should emit the root package.
    expect(sbom.components.some((c) => c.name === '')).toBe(false);
    expect(report.violations.some((v) => v.packageName === '')).toBe(false);
  });
});
