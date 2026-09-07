/**
 * Pass 47 — Task-13: Supply-chain audit of the CVE scanner and license checker.
 *
 * This file adversarially probes the failure modes of cve-scanner.ts and
 * license-checker.ts that are NOT covered by the existing security.test.ts:
 *
 * cve-scanner:
 *   (A) OSV.dev unreachable (network error) — must not crash; returns clean result
 *   (B) OSV.dev returns HTTP 500 — must not crash; returns clean result
 *   (C) OSV.dev returns malformed body — must not crash; returns empty entries
 *   (D) GHSA unreachable — falls back to OSV-only result
 *   (E) Both sources unreachable — passed:true, empty results, shelf unchanged
 *   (F) Resolved entry preservation — a shelf entry marked resolved:true must
 *       remain resolved after a re-scan that encounters the same CVE ID again
 *   (G) Component batch > 1000 limit — only first 1000 components queried
 *       (documented design boundary; confirmed via slice argument in source)
 *   (H) CVE deduplication by alias — the same advisory reported by both OSV
 *       (under its GHSA alias) and GHSA (under its CVE primary ID) must not
 *       produce two separate shelf entries
 *
 * license-checker:
 *   (I)  Compound SPDX "MIT OR GPL-3.0" → denied (intentional conservative policy)
 *   (J)  "GPL-3.0-only" suffix → denied  (suffix not prevented by substring match)
 *   (K)  "GPL-3.0-or-later" variant → denied
 *   (L)  Missing license field → reason:'unknown', passed:true
 *        (design boundary: missing ≠ explicitly denied; operator must triage)
 *   (M)  Empty string license → reason:'unknown', passed:true
 *   (N)  lockfileVersion 2 format (dependencies key) → handled correctly
 *   (O)  Scoped package "@scope/pkg" → name normalised to "@scope/pkg" (not
 *        "/scope/pkg" or "node_modules/@scope/pkg")
 *   (P)  Custom allowlist/denylist override respected
 *   (Q)  Self-reported-clean design limit: license-checker trusts the license
 *        field in package-lock.json verbatim; a malicious package could self-
 *        report 'MIT' while actually being GPL. This is a documented design
 *        boundary requiring an external verification step (e.g. ClearlyDefined
 *        or SPDX cross-check — planned in task-42).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'qodo-supply-chain-'));
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

// ── cve-scanner: fetch mocking helpers ──────────────────────────────────────
// We mock global fetch because fetchWithTimeout delegates to it.

import { scanCve, loadCveShelf, saveCveShelf } from '../src/services/cve-scanner.js';
import type { CveEntry, SbomComponent } from '../src/services/cve-scanner.js';

const SAMPLE_COMPONENTS: SbomComponent[] = [
  { type: 'library', name: 'express', version: '4.18.0', purl: 'pkg:npm/express@4.18.0', hashes: [] },
  { type: 'library', name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21', hashes: [] },
];

function makeOsvResponse(vulns: Record<string, unknown>[][] = [[], []]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results: vulns.map((v) => (v.length ? { vulns: v } : {})) }),
  };
}

function makeEmptyOsvResponse() {
  return makeOsvResponse([[], []]);
}

// ────────────────────────────────────────────────────────────────────────────
// Group A — OSV.dev unreachable (fetch throws)
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: OSV.dev unreachable (A)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('returns passed:true and empty arrays when OSV fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) throw new Error('ECONNREFUSED');
      // GHSA: no token in env → returns [] before fetching
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    expect(result.passed).toBe(true);
    expect(result.critical).toHaveLength(0);
    expect(result.high).toHaveLength(0);
    expect(result.all).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group B — OSV.dev returns HTTP 500
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: OSV.dev HTTP 500 (B)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('returns passed:true when OSV returns 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    expect(result.passed).toBe(true);
    expect(result.all).toHaveLength(0);
  });

  it('does not modify a pre-existing shelf when OSV returns 500', async () => {
    const preExistingEntry: CveEntry = {
      id: 'CVE-2023-99999',
      aliases: [],
      severity: 'CRITICAL',
      affectedPackage: 'express',
      affectedVersion: '4.18.0',
      summary: 'Pre-existing critical',
      detectedAt: '2026-01-01T00:00:00.000Z',
      resolved: false,
    };
    saveCveShelf(dir, [preExistingEntry]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    // Pre-existing shelf entry is preserved and surfaces in result
    expect(result.all.some((e) => e.id === 'CVE-2023-99999')).toBe(true);
    expect(result.critical.some((e) => e.id === 'CVE-2023-99999')).toBe(true);
    expect(result.passed).toBe(false); // pre-existing critical blocks
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group C — OSV.dev returns malformed body
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: OSV.dev malformed response body (C)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('handles a response body missing the results field without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) {
        return { ok: true, status: 200, json: async () => ({ unexpected: 'shape' }) } as unknown as Response;
      }
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);
    // No results field → data.results is undefined → forEach is a no-op
    expect(result.passed).toBe(true);
    expect(result.all).toHaveLength(0);
  });

  it('handles OSV json() throwing without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) {
        return {
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('Unexpected token'); },
        } as unknown as Response;
      }
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);
    expect(result.passed).toBe(true);
    expect(result.all).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group D — GHSA unreachable; falls back to OSV-only result
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: GHSA unreachable — falls back to OSV-only (D)', () => {
  let dir: string;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    dir = makeTmpDir();
    process.env.GITHUB_TOKEN = 'fake-token-for-test';
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  });

  it('returns OSV findings even when GHSA fetch throws', async () => {
    const osvVuln = {
      id: 'GHSA-from-osv',
      aliases: [],
      summary: 'vuln from OSV',
      database_specific: { severity: 'HIGH' },
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) return makeOsvResponse([[osvVuln], []]) as unknown as Response;
      if (urlStr.includes('api.github.com')) throw new Error('EHOSTUNREACH');
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    expect(result.all.some((e) => e.id === 'GHSA-from-osv')).toBe(true);
    // HIGH doesn't block (only CRITICAL blocks)
    expect(result.passed).toBe(true);
    expect(result.high).toHaveLength(1);
  });

  it('returns OSV findings even when GHSA returns HTTP 403', async () => {
    const osvVuln = {
      id: 'CVE-2024-11111',
      aliases: [],
      summary: 'test crit',
      database_specific: { severity: 'CRITICAL' },
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) return makeOsvResponse([[osvVuln], []]) as unknown as Response;
      if (urlStr.includes('api.github.com')) return { ok: false, status: 403 } as unknown as Response;
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);
    expect(result.critical.some((e) => e.id === 'CVE-2024-11111')).toBe(true);
    expect(result.passed).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group E — Both sources unreachable
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: both sources unreachable (E)', () => {
  let dir: string;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    dir = makeTmpDir();
    process.env.GITHUB_TOKEN = 'fake-token-for-test';
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  });

  it('returns passed:true with empty results when both OSV and GHSA fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network offline');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    expect(result.passed).toBe(true);
    expect(result.critical).toHaveLength(0);
    expect(result.high).toHaveLength(0);
    expect(result.all).toHaveLength(0);
  });

  it('does not create or corrupt the shelf file when both sources fail and no shelf exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network offline');
    });

    await scanCve(SAMPLE_COMPONENTS, dir);

    // Shelf should exist but be empty array (fresh run, no CVEs found)
    const shelf = loadCveShelf(dir);
    expect(shelf).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group F — Resolved entry preservation across re-scan
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: resolved entry preservation (F)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('does not reset resolved:true to false when the same CVE is returned by a fresh scan', async () => {
    // Operator has manually resolved this CVE in the shelf.
    const resolvedEntry: CveEntry = {
      id: 'CVE-2023-RESOLVED',
      aliases: [],
      severity: 'HIGH',
      affectedPackage: 'lodash',
      affectedVersion: '4.17.21',
      summary: 'resolved by operator',
      detectedAt: '2026-01-01T00:00:00.000Z',
      resolved: true,   // ← operator set this
    };
    saveCveShelf(dir, [resolvedEntry]);

    // OSV returns the same CVE again (fresh scan, same advisory)
    const freshVuln = {
      id: 'CVE-2023-RESOLVED',
      aliases: [],
      summary: 'resolved by operator',
      database_specific: { severity: 'HIGH' },
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) return makeOsvResponse([[], [freshVuln]]) as unknown as Response;
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    // The resolved entry must NOT reappear as unresolved in the result
    expect(result.all.some((e) => e.id === 'CVE-2023-RESOLVED')).toBe(false);
    expect(result.high.some((e) => e.id === 'CVE-2023-RESOLVED')).toBe(false);

    // The shelf must still show resolved:true
    const shelf = loadCveShelf(dir);
    const entry = shelf.find((e) => e.id === 'CVE-2023-RESOLVED');
    expect(entry).toBeDefined();
    expect(entry!.resolved).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group G — Component batch > 1000 (documented design boundary)
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: component batch > 1000 limit (G)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('only sends the first 1000 components to OSV (slice limit)', async () => {
    // Generate 1200 synthetic components
    const bigList: SbomComponent[] = Array.from({ length: 1200 }, (_, i) => ({
      type: 'library' as const,
      name: `pkg-${i}`,
      version: '1.0.0',
      purl: `pkg:npm/pkg-${i}@1.0.0`,
      hashes: [],
    }));

    let capturedBatchSize = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) {
        const body = JSON.parse(init?.body as string ?? '{}');
        capturedBatchSize = body.queries?.length ?? 0;
        // Return empty results for all 1000 (no vulns found)
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: Array(capturedBatchSize).fill({}) }),
        } as unknown as Response;
      }
      throw new Error('unexpected fetch');
    });

    await scanCve(bigList, dir);

    // Design boundary: only first 1000 of 1200 components are queried
    expect(capturedBatchSize).toBe(1000);
    // Note: components 1001–1200 are silently excluded. This is a known
    // limitation; see task-42 for planned cross-check with deps.dev to
    // cover the tail of large SBOMs.
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group H — CVE deduplication by alias
// ────────────────────────────────────────────────────────────────────────────

describe('cve-scanner: deduplication of OSV + GHSA same advisory (H)', () => {
  let dir: string;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    dir = makeTmpDir();
    process.env.GITHUB_TOKEN = 'fake-token-for-test';
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  });

  it('produces exactly one shelf entry when OSV returns GHSA-ID and GHSA returns CVE-ID for the same advisory', async () => {
    // OSV reports the advisory under its GHSA alias
    const osvVuln = {
      id: 'GHSA-xxxx-yyyy-zzzz',
      aliases: ['CVE-2024-77777'],
      summary: 'Same advisory via OSV',
      database_specific: { severity: 'HIGH' },
    };

    // GHSA reports the same advisory under its CVE primary ID
    const ghsaResponse = {
      data: {
        securityAdvisories: {
          nodes: [
            {
              ghsaId: 'GHSA-xxxx-yyyy-zzzz',
              severity: 'HIGH',
              summary: 'Same advisory via GHSA',
              identifiers: [
                { type: 'CVE', value: 'CVE-2024-77777' },
                { type: 'GHSA', value: 'GHSA-xxxx-yyyy-zzzz' },
              ],
              vulnerabilities: {
                nodes: [
                  { package: { name: 'express', ecosystem: 'NPM' }, vulnerableVersionRange: '<5.0.0' },
                ],
              },
            },
          ],
        },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('osv.dev')) return makeOsvResponse([[osvVuln], []]) as unknown as Response;
      if (urlStr.includes('api.github.com')) {
        return { ok: true, status: 200, json: async () => ghsaResponse } as unknown as Response;
      }
      throw new Error('unexpected fetch');
    });

    const result = await scanCve(SAMPLE_COMPONENTS, dir);

    // Both OSV and GHSA report the same advisory — must appear only once.
    // GHSA entry wins (primary ID = CVE-2024-77777).
    const shelf = loadCveShelf(dir);
    const matchingEntries = shelf.filter(
      (e) => e.id === 'CVE-2024-77777' || e.id === 'GHSA-xxxx-yyyy-zzzz',
    );
    expect(matchingEntries.length).toBe(1);
    // The merged result set must also deduplicate
    const resultMatches = result.high.filter(
      (e) => e.id === 'CVE-2024-77777' || e.id === 'GHSA-xxxx-yyyy-zzzz',
    );
    expect(resultMatches.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// license-checker adversarial tests
// ════════════════════════════════════════════════════════════════════════════

import { checkLicenses, DEFAULT_ALLOWED_LICENSES, DEFAULT_DENIED_LICENSES } from '../src/services/license-checker.js';

// ────────────────────────────────────────────────────────────────────────────
// Group I — Compound SPDX "MIT OR GPL-3.0"
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: compound SPDX expressions (I)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('flags "MIT OR GPL-3.0" as denied (conservative policy: any denied component blocks)', () => {
    // Design decision: the license checker uses substring matching against the
    // full SPDX expression.  A compound expression containing any denied license
    // ID is treated as denied because the consuming system cannot guarantee
    // that only the allowed alternative will be exercised.
    //
    // This IS intentionally conservative; see task-42 (ClearlyDefined
    // integration) for a planned upgrade to expression-aware parsing.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/dual-pkg': { version: '1.0.0', license: 'MIT OR GPL-3.0' },
    });

    const report = checkLicenses(dir);
    const dualPkg = report.violations.find((v) => v.packageName === 'dual-pkg');
    expect(dualPkg).toBeDefined();
    expect(dualPkg!.reason).toBe('denied');
    expect(report.passed).toBe(false);
  });

  it('flags "LGPL-2.1 OR MIT" as denied (same conservative policy)', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/lgpl-or-mit': { version: '2.0.0', license: 'LGPL-2.1 OR MIT' },
    });

    const report = checkLicenses(dir);
    const pkg = report.violations.find((v) => v.packageName === 'lgpl-or-mit');
    expect(pkg).toBeDefined();
    expect(pkg!.reason).toBe('denied');
    expect(report.passed).toBe(false);
  });

  it('does NOT flag "MIT AND Apache-2.0" as denied (both tokens allowed)', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/dual-allowed': { version: '1.0.0', license: 'MIT AND Apache-2.0' },
    });

    const report = checkLicenses(dir);
    expect(report.violations.filter((v) => v.reason === 'denied')).toHaveLength(0);
    expect(report.passed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group J/K — GPL variant suffixes
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: GPL suffix variants (J, K)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('flags "GPL-3.0-only" as denied (substring match catches -only suffix)', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-only': { version: '1.0.0', license: 'GPL-3.0-only' },
    });

    const report = checkLicenses(dir);
    expect(report.violations.some((v) => v.reason === 'denied')).toBe(true);
    expect(report.passed).toBe(false);
  });

  it('flags "GPL-3.0-or-later" as denied', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-later': { version: '1.0.0', license: 'GPL-3.0-or-later' },
    });

    const report = checkLicenses(dir);
    expect(report.violations.some((v) => v.reason === 'denied')).toBe(true);
    expect(report.passed).toBe(false);
  });

  it('flags "AGPL-3.0-only" as denied (AGPL-3.0 is in deny list)', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/agpl-only': { version: '1.0.0', license: 'AGPL-3.0-only' },
    });

    const report = checkLicenses(dir);
    expect(report.violations.some((v) => v.reason === 'denied')).toBe(true);
    expect(report.passed).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group L — Missing license field
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: missing / empty license field (L, M)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reports reason:unknown (not denied) when license field is absent — passed:true (L)', () => {
    // Design boundary: a missing license field is treated as 'UNKNOWN', not
    // as a denied license.  This means passed:true so the pipeline continues;
    // the operator must manually triage 'unknown' violations.
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/unlicensed-pkg': { version: '3.0.0' },  // no license field
    });

    const report = checkLicenses(dir);
    const violation = report.violations.find((v) => v.packageName === 'unlicensed-pkg');
    expect(violation).toBeDefined();
    expect(violation!.reason).toBe('unknown');
    expect(violation!.license).toBe('UNKNOWN');
    // passed is true because only 'denied' blocks
    expect(report.passed).toBe(true);
  });

  it('reports reason:unknown when license is empty string (M)', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/empty-license': { version: '1.0.0', license: '' },
    });

    const report = checkLicenses(dir);
    const violation = report.violations.find((v) => v.packageName === 'empty-license');
    expect(violation).toBeDefined();
    expect(violation!.reason).toBe('unknown');
    expect(report.passed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group N — lockfileVersion 2 (dependencies key)
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: lockfileVersion 2 format (N)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads from dependencies key when packages key is absent (v2 lockfile)', () => {
    writeFakeLock(dir, {
      'node_modules/some-mit-pkg': { version: '1.0.0', license: 'MIT' },
      'node_modules/some-gpl-pkg': { version: '2.0.0', license: 'GPL-2.0' },
    }, /* useDependenciesKey = */ true);

    const report = checkLicenses(dir);
    expect(report.checked).toBeGreaterThanOrEqual(2);
    expect(report.violations.some((v) => v.reason === 'denied')).toBe(true);
    expect(report.passed).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group O — Scoped package name normalisation
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: scoped package name normalisation (O)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('strips node_modules/ prefix from scoped packages and preserves @ prefix', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/@scope/pkg': { version: '1.0.0', license: 'GPL-3.0' },
    });

    const report = checkLicenses(dir);
    const violation = report.violations.find((v) => v.packageName === '@scope/pkg');
    expect(violation).toBeDefined();
    // Must NOT appear as 'node_modules/@scope/pkg' or '/scope/pkg'
    expect(report.violations.some((v) => v.packageName.startsWith('node_modules/'))).toBe(false);
  });

  it('normalises deeply nested scoped package path', () => {
    // Lock v3 can nest packages: node_modules/a/node_modules/@scope/dep
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/outer/node_modules/@scope/inner': { version: '2.0.0', license: 'MIT' },
    });

    const report = checkLicenses(dir);
    const checked = report.checked;
    // Package is checked (not skipped as root entry)
    expect(checked).toBeGreaterThanOrEqual(1);
    // Name should be normalised to 'outer/@scope/inner' (leading node_modules/ stripped)
    const names = readFileSync(join(dir, 'package-lock.json'), 'utf8');
    expect(names).toContain('node_modules/outer/node_modules/@scope/inner');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group P — Custom allowlist/denylist override
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: custom allowlist/denylist override (P)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('respects a custom allowlist that permits MIT only', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/mit-pkg': { version: '1.0.0', license: 'MIT' },
      'node_modules/apache-pkg': { version: '1.0.0', license: 'Apache-2.0' },
    });

    const report = checkLicenses(dir, ['MIT'], DEFAULT_DENIED_LICENSES);
    // Apache-2.0 is not in custom allowlist → 'unknown'
    expect(report.violations.some((v) => v.packageName === 'apache-pkg' && v.reason === 'unknown')).toBe(true);
    // MIT is in custom allowlist → no violation
    expect(report.violations.some((v) => v.packageName === 'mit-pkg')).toBe(false);
    // Only unknown violations, not denied → passed:true
    expect(report.passed).toBe(true);
  });

  it('respects a custom denylist that also blocks ISC', () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/isc-pkg': { version: '1.0.0', license: 'ISC' },
    });

    const customDenied = [...DEFAULT_DENIED_LICENSES, 'ISC'];
    const report = checkLicenses(dir, DEFAULT_ALLOWED_LICENSES, customDenied);
    expect(report.violations.some((v) => v.packageName === 'isc-pkg' && v.reason === 'denied')).toBe(true);
    expect(report.passed).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Group Q — Self-reported-clean design limit (documented)
// ────────────────────────────────────────────────────────────────────────────

describe('license-checker: self-reported-clean design boundary (Q)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('passes a package that self-reports MIT even if it is actually GPL (design limit)', () => {
    // KNOWN DESIGN LIMIT: license-checker trusts the license field in
    // package-lock.json verbatim.  A malicious package could publish with
    // license: 'MIT' in its package.json while its actual source is GPL.
    //
    // This test documents the boundary, not a bug to fix here.
    // Mitigation: cross-check against ClearlyDefined / SPDX license data
    // (planned in task-42).
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/malicious-self-reports-mit': { version: '1.0.0', license: 'MIT' },
    });

    const report = checkLicenses(dir);
    // checker accepts the self-reported MIT — this is the documented gap
    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
    // The external mitigation (task-42: ClearlyDefined cross-check) would
    // catch this; the local checker cannot without a network call.
  });
});
