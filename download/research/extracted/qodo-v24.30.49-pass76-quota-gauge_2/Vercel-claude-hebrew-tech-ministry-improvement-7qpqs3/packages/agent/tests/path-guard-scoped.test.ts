/**
 * Regression tests for path-guard-scoped.ts
 * Focus: env overrides must take precedence over file config (Bug 17-D).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPathGuardConfig, isPathAllowed } from '../src/validators/path-guard-scoped.js';

describe('path-guard-scoped — env overrides merge with file config (Bug 17-D regression)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'qodo-pathguard-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('applies env ALLOWED_PATHS over a config file', () => {
    writeFileSync(
      join(workspace, 'path-guard-config.json'),
      JSON.stringify({ allowedPaths: ['src/'], blockedPaths: ['node_modules/'] }),
    );

    const cfg = loadPathGuardConfig(workspace, {
      ALLOWED_PATHS: 'app/,lib/',
      BLOCKED_PATHS: 'secrets/',
    });

    expect(cfg.allowedPaths).toEqual(['app/', 'lib/']);
    expect(cfg.blockedPaths).toEqual(['secrets/']);

    // A path allowed by file config but not by env override should be rejected.
    expect(isPathAllowed('src/main.ts', cfg)).toBe(false);
    // A path allowed by env override should pass.
    expect(isPathAllowed('app/index.ts', cfg)).toBe(true);
    // A path blocked by env override should be rejected (blocked wins).
    expect(isPathAllowed('secrets/key.pem', cfg)).toBe(false);
  });

  it('falls back to file config when env is absent', () => {
    writeFileSync(
      join(workspace, 'path-guard-config.json'),
      JSON.stringify({ allowedPaths: ['custom/'], blockedPaths: ['blocked/'] }),
    );

    const cfg = loadPathGuardConfig(workspace, {});
    expect(cfg.allowedPaths).toEqual(['custom/']);
    expect(cfg.blockedPaths).toEqual(['blocked/']);
  });
});

describe('path-guard-scoped — traversal escape regression (audit finding 2.2)', () => {
  const cfg = {
    allowedPaths: ['src/', 'lib/'],
    blockedPaths: ['.env', 'secrets/'],
  };

  it('rejects a path that textually starts with an allowed prefix but escapes via ..', () => {
    // Previously: startsWith('src/') was true on the raw string, so this
    // passed straight through the allowlist despite resolving to '.env'.
    expect(isPathAllowed('src/../../.env', cfg)).toBe(false);
    expect(isPathAllowed('src/../../../secrets/prod.key', cfg)).toBe(false);
  });

  it('still allows a normal, non-traversal path under an allowed prefix', () => {
    expect(isPathAllowed('src/services/foo.ts', cfg)).toBe(true);
  });

  it('rejects a path that escapes the root entirely', () => {
    expect(isPathAllowed('../../etc/passwd', cfg)).toBe(false);
  });

  it('rejects an absolute path outside the workspace', () => {
    expect(isPathAllowed('/etc/passwd', cfg)).toBe(false);
  });

  it('collapses internal ./ and redundant slashes before matching', () => {
    expect(isPathAllowed('src/./services/../services/foo.ts', cfg)).toBe(true);
  });
});

describe('path-guard-scoped — adversarial bypass cases (Pass 35)', () => {
  const cfg = {
    allowedPaths: ['src/', 'lib/'],
    blockedPaths: ['.env', 'secrets/', '.git/'],
  };

  // ── URL-encoded traversal ─────────────────────────────────────────────────
  it('rejects URL-encoded dot-dot-slash traversal (%2e%2e%2f)', () => {
    // `src/%2e%2e%2f.env` decodes to `src/../.env` → escapes to `.env`
    expect(isPathAllowed('src/%2e%2e%2f.env', cfg)).toBe(false);
  });

  it('rejects mixed-case URL encoding (%2E%2E%2F)', () => {
    expect(isPathAllowed('src/%2E%2E%2F.env', cfg)).toBe(false);
  });

  it('rejects URL-encoded traversal into secrets', () => {
    expect(isPathAllowed('src/%2e%2e%2fsecrets%2fprod.key', cfg)).toBe(false);
  });

  it('allows a path whose percent-encoded chars are benign (space in filename)', () => {
    // `src/my%20file.ts` decodes to `src/my file.ts` — stays inside src/
    expect(isPathAllowed('src/my%20file.ts', cfg)).toBe(true);
  });

  it('blocks a path with malformed percent-encoding', () => {
    // `%GG` is not valid hex — decodeURIComponent throws → blocked
    expect(isPathAllowed('src/%GGfoo.ts', cfg)).toBe(false);
  });

  // ── Null-byte injection ───────────────────────────────────────────────────
  it('rejects a path with a null byte before a traversal sequence', () => {
    // `src/\x00../../.env` — null stripped first, then traversal caught
    expect(isPathAllowed('src/\x00../../.env', cfg)).toBe(false);
  });

  it('rejects a path that is only a null byte', () => {
    expect(isPathAllowed('\x00', cfg)).toBe(false);
  });

  it('allows a normal path that incidentally contains no special chars after null strip', () => {
    expect(isPathAllowed('src/\x00main.ts', cfg)).toBe(true);
  });

  // ── Windows-style backslash paths ─────────────────────────────────────────
  it('rejects Windows-style traversal (backslash dot-dot)', () => {
    expect(isPathAllowed('src\\..\\..\\secrets\\key.pem', cfg)).toBe(false);
  });

  it('allows a Windows-style path that stays inside an allowed prefix', () => {
    expect(isPathAllowed('src\\services\\foo.ts', cfg)).toBe(true);
  });

  // ── .git traversal ────────────────────────────────────────────────────────
  it('rejects a path targeting .git/config via traversal', () => {
    expect(isPathAllowed('src/../../.git/config', cfg)).toBe(false);
  });

  // ── Double-encoding is NOT decoded (one pass only) ────────────────────────
  it('does not double-decode %252e (only one decode pass — by design)', () => {
    // %252e → first pass → %2e (a literal string, not a dot) → stays in src/
    // This is intentional: double-encoding indicates obfuscation; one-pass
    // decode is the safe baseline.  Document rather than silently allow.
    const result = isPathAllowed('src/%252e%252e%252f.env', cfg);
    // After one decode: `src/%2e%2e%2f.env` → still under src/ (not traversal)
    // So this particular input actually passes — which is correct: the path
    // does NOT escape after one decode pass.
    expect(result).toBe(true);
  });
});
