/**
 * STRESS TEST: License checker under 1000-package burst.
 * Simulates lock files with 1000 packages — all allowed, all denied, mixed.
 * Verifies: correct violation counts, no crashes on large inputs,
 * performance acceptability (< 5 seconds for 1000 packages).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkLicenses, DEFAULT_ALLOWED_LICENSES } from '../../src/services/license-checker.js';

const CONCURRENCY = 1000;

function writeLockWithPackages(
  dir: string,
  pkgs: Record<string, { version: string; license?: string }>,
) {
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: pkgs }));
}

function makePackages(
  count: number,
  licenseFactory: (i: number) => string | undefined,
): Record<string, { version: string; license?: string }> {
  const pkgs: Record<string, { version: string; license?: string }> = { '': { version: '0.0.0' } };
  for (let i = 0; i < count; i++) {
    const lic = licenseFactory(i);
    pkgs[`node_modules/pkg-${i}`] = { version: `1.${i}.0`, ...(lic ? { license: lic } : {}) };
  }
  return pkgs;
}

describe('license-checker — 1000-package burst stress', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qodo-stress-license-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('1000 MIT packages: all pass, 0 violations', () => {
    writeLockWithPackages(dir, makePackages(CONCURRENCY, () => 'MIT'));
    const report = checkLicenses(dir);
    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
    expect(report.checked).toBe(CONCURRENCY);
  });

  it('1000 GPL-3.0 packages: all fail as denied', () => {
    writeLockWithPackages(dir, makePackages(CONCURRENCY, () => 'GPL-3.0'));
    const report = checkLicenses(dir);
    expect(report.passed).toBe(false);
    expect(report.violations.filter((v) => v.reason === 'denied')).toHaveLength(CONCURRENCY);
  });

  it('mixed 1000: 50% MIT, 30% GPL-3.0, 20% unknown — correct counts', () => {
    writeLockWithPackages(
      dir,
      makePackages(CONCURRENCY, (i) => {
        if (i < 500) return 'MIT';
        if (i < 800) return 'GPL-3.0';
        return undefined; // unknown
      }),
    );
    const report = checkLicenses(dir);
    expect(report.passed).toBe(false);
    const denied = report.violations.filter((v) => v.reason === 'denied');
    const unknown = report.violations.filter((v) => v.reason === 'unknown');
    expect(denied).toHaveLength(300);
    expect(unknown).toHaveLength(200);
  });

  it('performance: 1000-package check completes in < 5 seconds', () => {
    writeLockWithPackages(
      dir,
      makePackages(CONCURRENCY, (i) =>
        DEFAULT_ALLOWED_LICENSES[i % DEFAULT_ALLOWED_LICENSES.length],
      ),
    );
    const start = Date.now();
    checkLicenses(dir);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it('violation objects contain required fields', () => {
    writeLockWithPackages(dir, makePackages(10, () => 'AGPL-3.0'));
    const report = checkLicenses(dir);
    for (const v of report.violations) {
      expect(v.packageName).toBeTruthy();
      expect(v.version).toBeTruthy();
      expect(v.license).toBeTruthy();
      expect(['denied', 'unknown']).toContain(v.reason);
    }
  });

  it('handles packages with compound licenses (e.g. MIT OR Apache-2.0)', () => {
    writeLockWithPackages(dir, {
      '': { version: '0.0.0' },
      'node_modules/dual': { version: '1.0.0', license: 'MIT OR Apache-2.0' },
      'node_modules/triple': { version: '1.0.0', license: 'MIT AND ISC' },
    });
    const report = checkLicenses(dir);
    expect(report.passed).toBe(true);
  });
});
