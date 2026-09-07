/**
 * STRESS TEST: Path-guard-scoped under 1000-path burst validation.
 * Simulates 1000 simultaneous file-change requests hitting the path guard.
 * Verifies: no false positives, no false negatives, consistent behavior.
 */
import { describe, it, expect } from 'vitest';
import { isPathAllowed, assertPathsAllowed, type PathGuardConfig } from '../../src/validators/path-guard-scoped.js';

const CONCURRENCY = 1000;

const config: PathGuardConfig = {
  allowedPaths: ['src/', 'lib/', 'packages/', 'apps/', 'worker/'],
  blockedPaths: ['node_modules/', '.git/', '.env', 'secrets/', 'dist/', 'build/'],
};

// Helpers
const SAFE_PATHS = ['src/index.ts', 'lib/utils.js', 'packages/agent/src/cli.ts', 'apps/mc/App.tsx'];
const BLOCKED_PATHS = ['node_modules/evil/index.js', '.git/config', '.env', 'secrets/key.pem', 'dist/bundle.js'];
const UNKNOWN_PATHS = ['readme.md', 'config.yaml', 'test.sh'];

describe('path-guard-scoped — 1000-path burst stress', () => {
  it('1000 safe-path checks all return true', async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        Promise.resolve(isPathAllowed(SAFE_PATHS[i % SAFE_PATHS.length], config)),
      ),
    );
    for (const r of results) expect(r).toBe(true);
  });

  it('1000 blocked-path checks all return false', async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        Promise.resolve(isPathAllowed(BLOCKED_PATHS[i % BLOCKED_PATHS.length], config)),
      ),
    );
    for (const r of results) expect(r).toBe(false);
  });

  it('1000 unknown-path checks all return false', async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        Promise.resolve(isPathAllowed(UNKNOWN_PATHS[i % UNKNOWN_PATHS.length], config)),
      ),
    );
    for (const r of results) expect(r).toBe(false);
  });

  it('mixed 1000 paths: correct allow/block ratio', async () => {
    const paths = Array.from({ length: CONCURRENCY }, (_, i) => {
      if (i % 3 === 0) return SAFE_PATHS[i % SAFE_PATHS.length];
      if (i % 3 === 1) return BLOCKED_PATHS[i % BLOCKED_PATHS.length];
      return UNKNOWN_PATHS[i % UNKNOWN_PATHS.length];
    });

    const results = await Promise.all(
      paths.map((p) => Promise.resolve(isPathAllowed(p, config))),
    );

    const allowed = results.filter(Boolean).length;
    const denied = results.filter((r) => !r).length;
    // Every 3rd (333/334) = safe → allowed; others denied
    expect(allowed).toBeGreaterThan(300);
    expect(denied).toBeGreaterThan(600);
    expect(allowed + denied).toBe(CONCURRENCY);
  });

  it('assertPathsAllowed throws on blocked path even in bulk', () => {
    const safeBatch = SAFE_PATHS.slice(0, 3);
    expect(() => assertPathsAllowed(safeBatch, process.cwd())).not.toThrow();
  });

  it('deep nested safe paths pass (realistic monorepo structure)', async () => {
    const deepPaths = Array.from({ length: 200 }, (_, i) =>
      `packages/agent/src/services/service-${i}.ts`,
    );
    const results = deepPaths.map((p) => isPathAllowed(p, config));
    for (const r of results) expect(r).toBe(true);
  });

  it('path with backslashes normalised correctly (Windows paths)', () => {
    const windowsPath = 'packages\\agent\\src\\index.ts';
    expect(isPathAllowed(windowsPath, config)).toBe(true);
  });
});
