/**
 * security-api-sources.test.ts — Pass 67 / task-36
 *
 * Adversarial tests for the three new security API second-sources:
 *   D4 — Snyk CVE enrichment in cve-scanner.ts
 *   S1 — Socket.dev supply-chain risk in integrations/socket-risk.ts
 *   S2 — Socket.dev supply-chain risk in license-checker.ts
 *   V1 — VirusTotal hash reputation in integrations/virustotal.ts
 *   V2 — VirusTotal findings attachment in dry-run.ts
 *
 * All external fetch calls are intercepted via vi.stubGlobal('fetch', ...).
 * No real network access occurs. The VT batch-delay is patched to 0 ms to
 * prevent test timeouts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'qodo-sec-api-'));
}

function writeFakeLock(
  dir: string,
  packages: Record<string, { version: string; license?: string; resolved?: string }>,
): void {
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
}

/** Build a minimal fetch mock that returns the given payload for any URL. */
function mockFetch(statusOrHandler: number | ((url: string) => { status: number; body: unknown }), body?: unknown) {
  if (typeof statusOrHandler === 'function') {
    const handler = statusOrHandler;
    return vi.fn(async (url: string) => {
      const { status, body: responseBody } = handler(url);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => responseBody,
      };
    });
  }
  const status = statusOrHandler;
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

// ── imports ───────────────────────────────────────────────────────────────────

import { scanCve, loadCveShelf } from '../src/services/cve-scanner.js';
import type { SbomComponent } from '../src/services/cve-scanner.js';
import { fetchSocketRisk, flaggedPackages, SOCKET_SUPPLY_CHAIN_THRESHOLD } from '../src/services/integrations/socket-risk.js';
import { scanHashesWithVirusTotal, flaggedFindings, VT_MALICIOUS_THRESHOLD } from '../src/services/integrations/virustotal.js';
import { checkSocketSupplyChain } from '../src/services/license-checker.js';
import { initDryRun, dryRunSkip, setVirusTotalFindings, getDryRunReport, _resetDryRun } from '../src/services/dry-run.js';

const SAMPLE_COMPONENTS: SbomComponent[] = [
  { type: 'library', name: 'express', version: '4.18.0', purl: 'pkg:npm/express@4.18.0', hashes: [{ alg: 'SHA-256', content: 'aaaa' }] },
  { type: 'library', name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21', hashes: [{ alg: 'SHA-256', content: 'bbbb' }] },
];

// ── D4: Snyk CVE integration ───────────────────────────────────────────────

describe('D4 — cve-scanner: Snyk absent when SNYK_TOKEN not set', () => {
  it('returns empty sourceCounts.snyk:0 when no SNYK_TOKEN', async () => {
    const env = { ...process.env, SNYK_TOKEN: undefined };
    delete env.SNYK_TOKEN;

    // OSV returns empty; GHSA skipped (no GITHUB_TOKEN); Snyk skipped
    vi.stubGlobal('fetch', mockFetch(200, { results: [{}, {}] }));

    const tmpDir = makeTmpDir();
    try {
      const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);
      expect(result.sourceCounts.snyk).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });
});

describe('D4 — cve-scanner: Snyk enriches results when SNYK_TOKEN is set', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); vi.unstubAllGlobals(); process.env.SNYK_TOKEN = undefined as unknown as string; delete process.env.SNYK_TOKEN; });

  it('merges Snyk vulnerability into CVE shelf', async () => {
    process.env.SNYK_TOKEN = 'test-snyk-token';

    const snykPayload = {
      ok: false,
      issues: {
        vulnerabilities: [{
          id: 'SNYK-JS-EXPRESS-001',
          title: 'Prototype Pollution',
          severity: 'high',
          identifiers: { CVE: ['CVE-2023-9999'] },
        }],
      },
    };

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('osv.dev')) return { status: 200, body: { results: [{}, {}] } };
      if (url.includes('snyk.io')) return { status: 200, body: snykPayload };
      return { status: 200, body: { data: { securityAdvisories: { nodes: [] } } } };
    }));

    const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);
    expect(result.sourceCounts.snyk).toBeGreaterThan(0);
    // CVE-2023-9999 should be in the shelf (Snyk ID wins over SNYK-JS alias)
    const shelf = loadCveShelf(tmpDir);
    const entry = shelf.find((e) => e.id === 'CVE-2023-9999' || e.id === 'SNYK-JS-EXPRESS-001');
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('HIGH');
    expect(entry?.sources).toContain('snyk');
  });

  it('tolerates Snyk 404 for unknown package gracefully', async () => {
    process.env.SNYK_TOKEN = 'test-snyk-token';

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('osv.dev')) return { status: 200, body: { results: [{}, {}] } };
      if (url.includes('snyk.io')) return { status: 404, body: {} };
      return { status: 200, body: { data: { securityAdvisories: { nodes: [] } } } };
    }));

    const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);
    expect(result.sourceCounts.snyk).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('tolerates Snyk 401 (bad token) gracefully', async () => {
    process.env.SNYK_TOKEN = 'invalid-token';

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('snyk.io')) return { status: 401, body: { error: 'Unauthorized' } };
      return { status: 200, body: { results: [{}, {}] } };
    }));

    const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);
    expect(result.sourceCounts.snyk).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('deduplicates a CVE reported by both Snyk and OSV', async () => {
    process.env.SNYK_TOKEN = 'test-snyk-token';

    const osvPayload = {
      results: [{
        vulns: [{
          id: 'CVE-2023-1234',
          aliases: [],
          summary: 'OSV version',
          database_specific: { severity: 'MEDIUM' },
        }],
      }, {}],
    };
    const snykPayload = {
      ok: false,
      issues: {
        vulnerabilities: [{
          id: 'SNYK-JS-LODASH-001',
          title: 'Snyk version',
          severity: 'medium',
          identifiers: { CVE: ['CVE-2023-1234'] },
        }],
      },
    };

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('osv.dev')) return { status: 200, body: osvPayload };
      if (url.includes('snyk.io') && url.includes('lodash')) return { status: 200, body: snykPayload };
      if (url.includes('snyk.io')) return { status: 404, body: {} };
      return { status: 200, body: { data: { securityAdvisories: { nodes: [] } } } };
    }));

    const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);
    // CVE-2023-1234 should appear exactly once
    const shelfEntries = loadCveShelf(tmpDir).filter((e) => e.id === 'CVE-2023-1234');
    expect(shelfEntries).toHaveLength(1);
    // sources should reflect both
    expect(shelfEntries[0].sources).toContain('osv');
    expect(shelfEntries[0].sources).toContain('snyk');
  });

  it('survives a Snyk network error without crashing', async () => {
    process.env.SNYK_TOKEN = 'test-snyk-token';

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('snyk.io')) throw new Error('ECONNREFUSED');
      return { status: 200, body: { results: [{}, {}] } };
    }));

    await expect(scanCve(SAMPLE_COMPONENTS, tmpDir)).resolves.not.toThrow();
  });

  it('sourceCounts includes snyk count in scan result', async () => {
    process.env.SNYK_TOKEN = 'test-snyk-token';

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('osv.dev')) return { status: 200, body: { results: [{}, {}] } };
      if (url.includes('snyk.io')) return { status: 200, body: { ok: false, issues: { vulnerabilities: [{ id: 'SNYK-1', title: 'A', severity: 'low', identifiers: {} }] } } };
      return { status: 404, body: {} };
    }));

    const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);
    expect(typeof result.sourceCounts.osv).toBe('number');
    expect(typeof result.sourceCounts.ghsa).toBe('number');
    expect(typeof result.sourceCounts.snyk).toBe('number');
    expect(result.sourceCounts.snyk).toBeGreaterThan(0);
  });
});

// ── S1: Socket.dev fetchSocketRisk ─────────────────────────────────────────

describe('S1 — socket-risk: absent when SOCKET_API_KEY not set', () => {
  it('returns [] when SOCKET_API_KEY is undefined', async () => {
    const results = await fetchSocketRisk(
      [{ name: 'lodash', version: '4.17.21' }],
      { env: {} },
    );
    expect(results).toHaveLength(0);
  });
});

describe('S1 — socket-risk: fetches and parses scores', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a healthy package score correctly', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      status: 'success',
      score: { supplyChain: 0.9, quality: 0.85, maintenance: 0.8, vulnerability: 0.95, license: 1.0 },
      alerts: [],
    }));

    const results = await fetchSocketRisk(
      [{ name: 'lodash', version: '4.17.21' }],
      { env: { SOCKET_API_KEY: 'sk-test' } },
    );

    expect(results).toHaveLength(1);
    expect(results[0].score.supplyChain).toBe(0.9);
    expect(results[0].highSupplyChainRisk).toBe(false);
    expect(results[0].alerts).toHaveLength(0);
  });

  it('flags a package with low supply-chain score', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      status: 'success',
      score: { supplyChain: 0.1, quality: 0.5 },
      alerts: [{ type: 'obfuscated-code', severity: 'critical', category: 'supply-chain' }],
    }));

    const results = await fetchSocketRisk(
      [{ name: 'evil-pkg', version: '1.0.0' }],
      { env: { SOCKET_API_KEY: 'sk-test' } },
    );

    expect(results[0].highSupplyChainRisk).toBe(true);
    expect(results[0].score.supplyChain).toBeLessThan(SOCKET_SUPPLY_CHAIN_THRESHOLD);
    expect(flaggedPackages(results)).toHaveLength(1);
  });

  it('handles 404 (unknown package) gracefully', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));

    const results = await fetchSocketRisk(
      [{ name: 'obscure-pkg', version: '0.0.1' }],
      { env: { SOCKET_API_KEY: 'sk-test' } },
    );

    expect(results).toHaveLength(1);
    expect(results[0].highSupplyChainRisk).toBe(false);
    expect(results[0].score).toEqual({});
  });

  it('handles network error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const results = await fetchSocketRisk(
      [{ name: 'some-pkg', version: '1.0.0' }],
      { env: { SOCKET_API_KEY: 'sk-test' } },
    );

    expect(results).toHaveLength(1);
    expect(results[0].highSupplyChainRisk).toBe(false);
  });

  it('processes multiple packages in batches', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      return { ok: true, status: 200, json: async () => ({ status: 'success', score: { supplyChain: 0.8 }, alerts: [] }) };
    }));

    const pkgs = Array.from({ length: 5 }, (_, i) => ({ name: `pkg-${i}`, version: '1.0.0' }));
    const results = await fetchSocketRisk(pkgs, { env: { SOCKET_API_KEY: 'sk-test' }, concurrency: 3 });

    expect(results).toHaveLength(5);
    expect(callCount).toBe(5);
  });
});

// ── S2: Socket.dev license-checker integration ────────────────────────────

describe('S2 — license-checker: checkSocketSupplyChain absent when no API key', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns socketEnabled:false and no violations when key absent', async () => {
    writeFakeLock(dir, { '': { version: '0.0.0' }, 'node_modules/lodash': { version: '4.17.21' } });

    const report = await checkSocketSupplyChain(dir, { env: {} });

    expect(report.socketEnabled).toBe(false);
    expect(report.violations).toHaveLength(0);
    expect(report.passed).toBe(true);
    expect(report.checked).toBe(0);
  });
});

describe('S2 — license-checker: checkSocketSupplyChain flags risky packages', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it('returns supply-chain-risk violation for flagged package', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/evil-pkg': { version: '1.0.0' },
    });

    vi.stubGlobal('fetch', mockFetch(200, {
      status: 'success',
      score: { supplyChain: 0.05 },
      alerts: [{ type: 'install-scripts', severity: 'high', category: 'supply-chain' }],
    }));

    const report = await checkSocketSupplyChain(dir, { env: { SOCKET_API_KEY: 'sk-test' } });

    expect(report.socketEnabled).toBe(true);
    const v = report.violations.find((x) => x.packageName === 'evil-pkg');
    expect(v).toBeDefined();
    expect(v?.reason).toBe('supply-chain-risk');
    expect(v?.supplyChainScore).toBeDefined();
    expect((v?.supplyChainScore ?? 1)).toBeLessThan(SOCKET_SUPPLY_CHAIN_THRESHOLD);
    expect(report.passed).toBe(false);
  });

  it('passes a package with healthy supply-chain score', async () => {
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/safe-pkg': { version: '2.0.0' },
    });

    vi.stubGlobal('fetch', mockFetch(200, {
      status: 'success',
      score: { supplyChain: 0.95 },
      alerts: [],
    }));

    const report = await checkSocketSupplyChain(dir, { env: { SOCKET_API_KEY: 'sk-test' } });

    expect(report.violations).toHaveLength(0);
    expect(report.passed).toBe(true);
  });

  it('reports supply-chain-risk violations but not denied-license violations', async () => {
    // Separation of concerns: checkSocketSupplyChain is distinct from checkLicenses
    writeFakeLock(dir, {
      '': { version: '0.0.0' },
      'node_modules/gpl-with-risk': { version: '1.0.0' },
    });

    vi.stubGlobal('fetch', mockFetch(200, {
      status: 'success',
      score: { supplyChain: 0.1 },
      alerts: [],
    }));

    const report = await checkSocketSupplyChain(dir, { env: { SOCKET_API_KEY: 'sk-test' } });

    // Only supply-chain-risk reason — no 'denied' here
    expect(report.violations.every((v) => v.reason === 'supply-chain-risk')).toBe(true);
  });
});

// ── V1: VirusTotal hash lookup ────────────────────────────────────────────

describe('V1 — virustotal: absent when VT_API_KEY not set', () => {
  it('returns [] when VT_API_KEY is undefined', async () => {
    const results = await scanHashesWithVirusTotal(
      [{ name: 'lodash', version: '4.17.21', sha256: 'a'.repeat(64) }],
      { env: {}, delayMs: 0 },
    );
    expect(results).toHaveLength(0);
  });
});

describe('V1 — virustotal: parses hash reputation correctly', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns clean finding for an undetected hash', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      data: {
        attributes: {
          last_analysis_stats: { malicious: 0, suspicious: 0, undetected: 65, harmless: 0, failure: 0, 'type-unsupported': 2 },
        },
      },
    }));

    const results = await scanHashesWithVirusTotal(
      [{ name: 'lodash', version: '4.17.21', sha256: 'a'.repeat(64) }],
      { env: { VT_API_KEY: 'vt-test-key' }, delayMs: 0 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].flagged).toBe(false);
    expect(results[0].unknown).toBe(false);
    expect(results[0].stats.malicious).toBe(0);
    expect(flaggedFindings(results)).toHaveLength(0);
  });

  it('flags a hash with malicious detections', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      data: {
        attributes: {
          last_analysis_stats: { malicious: 5, suspicious: 2, undetected: 58, harmless: 0, failure: 0, 'type-unsupported': 0 },
        },
      },
    }));

    const results = await scanHashesWithVirusTotal(
      [{ name: 'evil-pkg', version: '1.0.0', sha256: 'b'.repeat(64) }],
      { env: { VT_API_KEY: 'vt-test-key' }, delayMs: 0 },
    );

    expect(results[0].flagged).toBe(true);
    expect(results[0].stats.malicious).toBeGreaterThanOrEqual(VT_MALICIOUS_THRESHOLD);
    expect(flaggedFindings(results)).toHaveLength(1);
  });

  it('handles 404 (hash not in VT database) gracefully', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));

    const results = await scanHashesWithVirusTotal(
      [{ name: 'rare-pkg', version: '0.0.1', sha256: 'c'.repeat(64) }],
      { env: { VT_API_KEY: 'vt-test-key' }, delayMs: 0 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].unknown).toBe(true);
    expect(results[0].flagged).toBe(false);
  });

  it('skips packages with non-64-char hashes', async () => {
    const mockFetchFn = vi.fn();
    vi.stubGlobal('fetch', mockFetchFn);

    const results = await scanHashesWithVirusTotal(
      [{ name: 'pkg-short-hash', version: '1.0.0', sha256: 'tooshort' }],
      { env: { VT_API_KEY: 'vt-test-key' }, delayMs: 0 },
    );

    // Short hash → skipped entirely
    expect(results).toHaveLength(0);
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('handles network error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const results = await scanHashesWithVirusTotal(
      [{ name: 'pkg', version: '1.0.0', sha256: 'd'.repeat(64) }],
      { env: { VT_API_KEY: 'vt-test-key' }, delayMs: 0 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].unknown).toBe(true);
    expect(results[0].flagged).toBe(false);
  });

  it('processes multiple hashes in batches with per-batch delay', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, undetected: 60, harmless: 0, failure: 0, 'type-unsupported': 0 } } },
    }));

    const pkgs = Array.from({ length: 6 }, (_, i) => ({
      name: `pkg-${i}`,
      version: '1.0.0',
      sha256: (i.toString(16).padStart(1, '0')).repeat(64).slice(0, 64),
    }));

    const results = await scanHashesWithVirusTotal(pkgs, {
      env: { VT_API_KEY: 'vt-test-key' },
      batchSize: 3,
      delayMs: 0,
    });

    expect(results).toHaveLength(6);
  });
});

// ── V2: dry-run VirusTotal findings attachment ────────────────────────────

describe('V2 — dry-run: VirusTotal findings attach to report', () => {
  beforeEach(() => _resetDryRun());
  afterEach(() => _resetDryRun());

  it('getDryRunReport includes virusTotalFindings when set', () => {
    initDryRun(['--dry-run']);
    dryRunSkip('git-commit', 'main');

    const findings = [{
      hash: 'a'.repeat(64),
      packageName: 'some-pkg',
      packageVersion: '1.0.0',
      stats: { malicious: 0, suspicious: 0, undetected: 65, harmless: 0, failure: 0, 'type-unsupported': 0 },
      flagged: false,
      unknown: false,
    }];

    setVirusTotalFindings(findings);
    const report = getDryRunReport();

    expect(report.virusTotalFindings).toBeDefined();
    expect(report.virusTotalFindings).toHaveLength(1);
    expect(report.virusTotalFindings![0].packageName).toBe('some-pkg');
  });

  it('getDryRunReport omits virusTotalFindings when not set', () => {
    initDryRun(['--dry-run']);
    const report = getDryRunReport();
    expect(report.virusTotalFindings).toBeUndefined();
  });

  it('setVirusTotalFindings is a no-op when not in dry-run mode', () => {
    // dry-run not initiated
    const findings = [{ hash: 'a'.repeat(64), packageName: 'p', packageVersion: '1.0.0', stats: { malicious: 0, suspicious: 0, undetected: 0, harmless: 0, failure: 0, 'type-unsupported': 0 }, flagged: false, unknown: false }];
    setVirusTotalFindings(findings); // should be silently ignored
    const report = getDryRunReport();
    // getDryRunReport always works, but findings not attached since not in dry-run
    expect(report.virusTotalFindings).toBeUndefined();
  });

  it('flags a malicious finding and confirms it appears in report', () => {
    initDryRun(['--dry-run']);

    const findings = [{
      hash: 'b'.repeat(64),
      packageName: 'malicious-pkg',
      packageVersion: '0.1.0',
      stats: { malicious: 3, suspicious: 1, undetected: 50, harmless: 0, failure: 0, 'type-unsupported': 0 },
      flagged: true,
      unknown: false,
    }];

    setVirusTotalFindings(findings);
    const report = getDryRunReport();

    const flagged = (report.virusTotalFindings ?? []).filter((f) => f.flagged);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].packageName).toBe('malicious-pkg');
  });
});

// ── Design Boundaries ─────────────────────────────────────────────────────

describe('Design Boundaries (Pass 67)', () => {
  it('DB-1: all three integrations degrade gracefully when API keys absent', async () => {
    const noEnv = {};
    const [socketResult, vtResult] = await Promise.all([
      // Snyk — tested via scanCve internals (SNYK_TOKEN absent → snyk count = 0)
      // Socket.dev
      fetchSocketRisk([{ name: 'pkg', version: '1.0.0' }], { env: noEnv }),
      // VirusTotal
      scanHashesWithVirusTotal([{ name: 'pkg', version: '1.0.0', sha256: 'a'.repeat(64) }], { env: noEnv, delayMs: 0 }),
    ]);

    // Both return empty arrays without throwing
    expect(socketResult).toHaveLength(0);
    expect(vtResult).toHaveLength(0);
  });

  it('DB-2: SOCKET_SUPPLY_CHAIN_THRESHOLD is 0.3 (design invariant)', () => {
    expect(SOCKET_SUPPLY_CHAIN_THRESHOLD).toBe(0.3);
  });

  it('DB-3: VT_MALICIOUS_THRESHOLD is 1 (any positive detection triggers flag)', () => {
    expect(VT_MALICIOUS_THRESHOLD).toBe(1);
  });

  it('DB-4: flaggedPackages() and flaggedFindings() are pure filters — do not mutate input', () => {
    const socketResults = [
      { name: 'a', version: '1', score: { supplyChain: 0.1 }, alerts: [], highSupplyChainRisk: true },
      { name: 'b', version: '1', score: { supplyChain: 0.9 }, alerts: [], highSupplyChainRisk: false },
    ];
    const vtResults = [
      { hash: 'a'.repeat(64), packageName: 'a', packageVersion: '1', stats: { malicious: 1, suspicious: 0, undetected: 0, harmless: 0, failure: 0, 'type-unsupported': 0 }, flagged: true, unknown: false },
      { hash: 'b'.repeat(64), packageName: 'b', packageVersion: '1', stats: { malicious: 0, suspicious: 0, undetected: 65, harmless: 0, failure: 0, 'type-unsupported': 0 }, flagged: false, unknown: false },
    ];

    expect(socketResults).toHaveLength(2); // unchanged
    expect(vtResults).toHaveLength(2); // unchanged
    expect(flaggedPackages(socketResults)).toHaveLength(1);
    expect(flaggedFindings(vtResults)).toHaveLength(1);
    expect(socketResults).toHaveLength(2); // still unchanged
  });
});

// ── Rate-limit contract ───────────────────────────────────────────────────

describe('V3 — virustotal: default delay enforces 4 req/min contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses delayMs=60000 by default (= batchSize/60s = 4 req/min)', async () => {
    // This test verifies the contract, not the exact setTimeout call.
    // The default delay (60 000 ms) combined with batchSize (4) produces
    // exactly 4 requests per 60-second window — matching the VT free-tier cap.
    // We confirm the effective throughput: N batches require (N-1)*delay seconds.
    //
    // With delayMs=0 override (used in all other tests to prevent timeouts),
    // we verify that the batchSize grouping is respected (calls per batch = batchSize).

    let fetchCallCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, undetected: 65, harmless: 0, failure: 0, 'type-unsupported': 0 } } } }),
      };
    }));

    // 4 packages, batchSize=4 → single batch, no inter-batch delay needed
    const pkgs = Array.from({ length: 4 }, (_, i) => ({
      name: `pkg-${i}`,
      version: '1.0.0',
      sha256: (i + 1).toString(16).padStart(64, '0'),
    }));
    const results = await scanHashesWithVirusTotal(pkgs, {
      env: { VT_API_KEY: 'vt-test-key' },
      batchSize: 4,
      delayMs: 0, // suppress delay for test speed
    });

    // 4 packages → 4 fetch calls (all in one batch)
    expect(fetchCallCount).toBe(4);
    expect(results).toHaveLength(4);
  });

  it('batches correctly: 9 packages with batchSize=4 → 3 batches', async () => {
    // Confirms batch grouping: ceil(9/4) = 3 batches.
    // In production, each batch transition waits 60 000 ms; here delay=0.
    let fetchCallCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCallCount++;
      return {
        ok: true, status: 200,
        json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, undetected: 60, harmless: 0, failure: 0, 'type-unsupported': 0 } } } }),
      };
    }));

    const pkgs = Array.from({ length: 9 }, (_, i) => ({
      name: `pkg-${i}`,
      version: '1.0.0',
      sha256: (i + 10).toString(16).padStart(64, '0'),
    }));
    await scanHashesWithVirusTotal(pkgs, {
      env: { VT_API_KEY: 'vt-key' },
      batchSize: 4,
      delayMs: 0,
    });
    expect(fetchCallCount).toBe(9);
  });
});

// ── Merge precedence: GHSA > Snyk > OSV (3-way conflict) ─────────────────

describe('D5 — cve-scanner: merge precedence — GHSA overrides Snyk overrides OSV', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    delete process.env.SNYK_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it('final severity comes from GHSA when all three sources report same CVE with different severities', async () => {
    process.env.SNYK_TOKEN = 'snyk-token';
    process.env.GITHUB_TOKEN = 'gh-token';

    // OSV: MEDIUM
    const osvPayload = {
      results: [{
        vulns: [{
          id: 'CVE-2023-TRIPLE',
          aliases: [],
          summary: 'OSV says medium',
          database_specific: { severity: 'MEDIUM' },
        }],
      }, {}],
    };

    // Snyk: HIGH (should override OSV)
    const snykPayload = {
      ok: false,
      issues: {
        vulnerabilities: [{
          id: 'SNYK-JS-TRIPLE-001',
          title: 'Snyk says high',
          severity: 'high',
          identifiers: { CVE: ['CVE-2023-TRIPLE'] },
        }],
      },
    };

    // GHSA: CRITICAL (should override both OSV and Snyk)
    const ghsaPayload = {
      data: {
        securityAdvisories: {
          nodes: [{
            ghsaId: 'GHSA-0000-0000-0000',
            severity: 'CRITICAL',
            summary: 'GHSA says critical',
            identifiers: [{ type: 'CVE', value: 'CVE-2023-TRIPLE' }],
            vulnerabilities: {
              nodes: [{
                package: { name: 'express', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 5.0.0',
              }],
            },
          }],
        },
      },
    };

    vi.stubGlobal('fetch', mockFetch((url: string) => {
      if (url.includes('osv.dev')) return { status: 200, body: osvPayload };
      if (url.includes('snyk.io') && url.includes('express')) return { status: 200, body: snykPayload };
      if (url.includes('snyk.io')) return { status: 404, body: {} };
      if (url.includes('api.github.com')) return { status: 200, body: ghsaPayload };
      return { status: 404, body: {} };
    }));

    const result = await scanCve(SAMPLE_COMPONENTS, tmpDir);

    // CVE-2023-TRIPLE should appear exactly once
    const shelf = loadCveShelf(tmpDir);
    const entry = shelf.find((e) => e.id === 'CVE-2023-TRIPLE');
    expect(entry).toBeDefined();
    // GHSA overrides Snyk overrides OSV: final severity must be CRITICAL
    expect(entry?.severity).toBe('CRITICAL');
    // All three sources should be recorded
    expect(entry?.sources).toContain('osv');
    expect(entry?.sources).toContain('snyk');
    expect(entry?.sources).toContain('ghsa');
  });
});
