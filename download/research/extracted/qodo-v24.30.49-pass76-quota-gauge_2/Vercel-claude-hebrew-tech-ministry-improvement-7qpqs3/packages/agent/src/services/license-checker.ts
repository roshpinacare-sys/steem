/**
 * License Checker — validates all dependencies against an allowlist policy.
 * Returns violations so the pipeline can block or warn.
 *
 * Extended in Pass 67: `checkSocketSupplyChain()` adds a separate async check
 * that uses Socket.dev to flag high-supply-chain-risk packages as a new
 * 'supply-chain-risk' violation reason, independent of the SPDX license check.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { log as logger } from './logger.js';
import {
  fetchSocketRisk,
  SOCKET_SUPPLY_CHAIN_THRESHOLD,
} from './integrations/socket-risk.js';

export const DEFAULT_ALLOWED_LICENSES = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'CC0-1.0',
  'Unlicense',
  '0BSD',
  'BlueOak-1.0.0',
  // Weak-copyleft / data licenses that impose no obligations when consumed
  // as unmodified npm dependencies:
  'MPL-2.0',      // file-level copyleft (lightningcss)
  'Python-2.0',   // permissive (argparse)
  'CC-BY-4.0',    // attribution-only data license (caniuse-lite)
];

/**
 * Per-package exceptions to the denylist, each with an auditable reason.
 * Matched by prefix against the package name.
 */
export const LICENSE_EXCEPTIONS: Record<string, string> = {
  // sharp's prebuilt libvips runtime (transitive dep of @xenova/transformers).
  // LGPL-3.0-or-later, consumed as an unmodified, dynamically-linked binary —
  // the standard LGPL usage that imposes no obligations on this codebase.
  // NB: sharp 0.32 bundled the SAME LGPL libvips via a postinstall download
  // that never appeared in the lockfile; the policy only "passed" before
  // because the component was invisible to it.
  '@img/sharp-libvips-': 'LGPL dynamic-link exception: unmodified libvips binaries for sharp',
  '@img/sharp-wasm32': 'LGPL dynamic-link exception: unmodified libvips (wasm) for sharp',
  '@img/sharp-win32-': 'LGPL dynamic-link exception: unmodified libvips binaries for sharp',
};

export const DEFAULT_DENIED_LICENSES = [
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'LGPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'SSPL-1.0',
  'BUSL-1.1',
  'CC-BY-NC-4.0',
];

export interface LicenseViolation {
  packageName: string;
  version: string;
  license: string;
  reason: 'denied' | 'unknown' | 'supply-chain-risk';
  /** For supply-chain-risk violations: the Socket.dev supplyChain score. */
  supplyChainScore?: number;
  /** For supply-chain-risk violations: alert categories from Socket.dev. */
  socketAlerts?: string[];
}

export interface LicenseReport {
  passed: boolean;
  violations: LicenseViolation[];
  checked: number;
}

export interface SupplyChainReport {
  passed: boolean;
  violations: LicenseViolation[];
  checked: number;
  /** True when SOCKET_API_KEY was set and Socket.dev was queried. */
  socketEnabled: boolean;
}

function normalizeLicense(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  ) {
    return ((value as { type: string }).type).trim();
  }
  return 'UNKNOWN';
}

/** Synchronous SPDX license allowlist/denylist check (unchanged from pre-Pass-67). */
export function checkLicenses(
  workspaceRoot: string,
  allowedLicenses = DEFAULT_ALLOWED_LICENSES,
  deniedLicenses = DEFAULT_DENIED_LICENSES,
): LicenseReport {
  const lockPath = resolve(workspaceRoot, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages: Record<string, { version: string; license?: string }> =
    lock.packages ?? lock.dependencies ?? {};

  const violations: LicenseViolation[] = [];
  let checked = 0;

  for (const [pkgKey, pkgData] of Object.entries(packages)) {
    if (!pkgKey || pkgKey === '') continue;
    // Workspace members appear in the lockfile both under their path
    // ("packages/agent") and as node_modules symlinks ({link: true}).
    // They are first-party code, not third-party dependencies to police.
    if (!pkgKey.startsWith('node_modules/')) continue;
    if ((pkgData as { link?: boolean }).link) continue;
    checked++;
    const name = pkgKey
      .replace(/^node_modules\//, '')
      .replace(/node_modules\//g, '/');
    const version = pkgData.version ?? 'unknown';
    const licenseId = normalizeLicense(pkgData.license);

    const exception = Object.keys(LICENSE_EXCEPTIONS).find((prefix) => name.startsWith(prefix));
    if (exception) {
      logger.debug('License exception applied', { name, license: licenseId, reason: LICENSE_EXCEPTIONS[exception] });
      continue;
    }

    if (deniedLicenses.some((d) => licenseId.includes(d))) {
      violations.push({ packageName: name, version, license: licenseId, reason: 'denied' });
    } else if (!allowedLicenses.some((a) => licenseId.includes(a))) {
      violations.push({ packageName: name, version, license: licenseId, reason: 'unknown' });
    }
  }

  const passed = violations.filter((v) => v.reason === 'denied').length === 0;

  logger.info('License check complete', { checked, violations: violations.length, passed });

  return { passed, violations, checked };
}

/**
 * Async supply-chain risk check using Socket.dev.
 *
 * Reads `package-lock.json` to enumerate packages, then queries Socket.dev
 * for each package's supply-chain score. Packages with a score below
 * `SOCKET_SUPPLY_CHAIN_THRESHOLD` are returned as `'supply-chain-risk'`
 * violations.
 *
 * A no-op that returns `socketEnabled: false` when SOCKET_API_KEY is absent.
 * Never throws — a complete Socket.dev outage results in no violations rather
 * than a false-positive block.
 */
export async function checkSocketSupplyChain(
  workspaceRoot: string,
  options: {
    threshold?: number;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<SupplyChainReport> {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const threshold = options.threshold ?? SOCKET_SUPPLY_CHAIN_THRESHOLD;

  if (!env.SOCKET_API_KEY) {
    logger.debug('SOCKET_API_KEY not set; skipping Socket.dev supply-chain check');
    return { passed: true, violations: [], checked: 0, socketEnabled: false };
  }

  const lockPath = resolve(workspaceRoot, 'package-lock.json');
  let lock: { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (err) {
    logger.warn('package-lock.json unreadable; skipping Socket.dev check', { err });
    return { passed: true, violations: [], checked: 0, socketEnabled: true };
  }

  const pkgs = lock.packages ?? lock.dependencies ?? {};
  const packages = Object.entries(pkgs)
    .filter(([k]) => k && k !== '')
    .map(([key, data]) => ({
      name: key.replace(/^node_modules\//, '').replace(/node_modules\//g, '/'),
      version: data.version ?? 'unknown',
    }));

  const results = await fetchSocketRisk(packages, { env });

  const violations: LicenseViolation[] = results
    .filter((r) => {
      if (typeof r.score.supplyChain !== 'number') return false;
      return r.score.supplyChain < threshold;
    })
    .map((r) => ({
      packageName: r.name,
      version: r.version,
      license: '',
      reason: 'supply-chain-risk' as const,
      supplyChainScore: r.score.supplyChain,
      socketAlerts: r.alerts.map((a) => a.type),
    }));

  const passed = violations.length === 0;
  logger.info('Socket.dev supply-chain check complete', {
    checked: results.length,
    violations: violations.length,
    passed,
  });

  return { passed, violations, checked: results.length, socketEnabled: true };
}
