/**
 * Extended path-guard — whitelist/blacklist config on top of the existing
 * blast-radius pattern. Reads ALLOWED_PATHS and BLOCKED_PATHS from env
 * or from a path-guard-config.json file in the workspace root.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { log as logger } from '../services/logger.js';

export interface PathGuardConfig {
  allowedPaths: string[];   // glob-like prefixes that ARE allowed
  blockedPaths: string[];   // glob-like prefixes that are NEVER allowed
}

const DEFAULT_CONFIG: PathGuardConfig = {
  allowedPaths: ['src/', 'lib/', 'apps/', 'packages/', 'worker/'],
  blockedPaths: [
    '.git/',
    'node_modules/',
    '.env',
    '.env.local',
    '.env.production',
    'secrets/',
    'private/',
    'dist/',
    'build/',
    '.github/workflows/',
  ],
};

export interface PathGuardEnv {
  ALLOWED_PATHS?: string;
  BLOCKED_PATHS?: string;
}

export function loadPathGuardConfig(
  workspaceRoot: string,
  env: PathGuardEnv = process.env as PathGuardEnv,
): PathGuardConfig {
  const cfgPath = resolve(workspaceRoot, 'path-guard-config.json');
  // Start from defaults, then layer file config, then env overrides.  Bug 17-D
  // fix: previously env overrides were silently ignored whenever a config file
  // existed, because the function returned the file config early and never
  // reached the env-override branch.
  let allowedPaths = DEFAULT_CONFIG.allowedPaths;
  let blockedPaths = DEFAULT_CONFIG.blockedPaths;

  if (existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as Partial<PathGuardConfig>;
      if (raw.allowedPaths) allowedPaths = raw.allowedPaths;
      if (raw.blockedPaths) blockedPaths = raw.blockedPaths;
    } catch {
      logger.warn('Failed to parse path-guard-config.json; using defaults');
    }
  }

  // Env overrides take final precedence over file config and defaults.
  const envAllowed = env.ALLOWED_PATHS?.split(',').map((p) => p.trim()).filter(Boolean);
  const envBlocked = env.BLOCKED_PATHS?.split(',').map((p) => p.trim()).filter(Boolean);
  if (envAllowed?.length) allowedPaths = envAllowed;
  if (envBlocked?.length) blockedPaths = envBlocked;

  return { allowedPaths, blockedPaths };
}

export function isPathAllowed(filePath: string, config: PathGuardConfig): boolean {
  // ── Defense layer 1: strip null bytes ────────────────────────────────────
  // A null byte in a path string (`src/\x00../../.env`) terminates the string
  // at the C layer in older libc and some JS environments, producing unexpected
  // results.  Strip before any other processing.
  // eslint-disable-next-line no-control-regex
  const withoutNull = filePath.replace(/\x00/g, '');

  // ── Defense layer 2: URL-decode before normalisation ─────────────────────
  // A path like `src/%2e%2e%2f.env` resolves to `src/../.env` once decoded.
  // Decode once here so the traversal is caught by the path.resolve logic
  // below rather than passing through as an innocent percent-encoded string.
  // Double-encoding (`%252e`) is not decoded (one pass only) — intentional.
  let decoded = withoutNull;
  try {
    decoded = decodeURIComponent(withoutNull);
  } catch {
    // decodeURIComponent throws on malformed sequences; treat as blocked.
    logger.warn('Path contains malformed percent-encoding — blocked', { filePath });
    return false;
  }

  // ── Defense layer 3: resolve `..`/`.` segments against a fixed root ──────
  // A raw string check like `startsWith('src/')` is bypassed trivially by
  // `src/../../.env` — it starts with the allowed prefix textually while
  // actually escaping to a blocked path once the OS resolves it. Anchoring
  // to a fixed, fake root and re-deriving a root-relative posix path closes
  // that hole regardless of what workspaceRoot is on this machine.
  //
  // Symlink note: path.resolve() operates on the string only and does NOT
  // dereference symlinks.  A symlink inside an allowed directory that points
  // outside the workspace will pass this check.  Full symlink-safe jailing
  // requires `fs.realpathSync()` against an actual on-disk workspace.  That
  // is intentionally deferred: this function is called with patch-file paths
  // before they are written to disk, so realpathSync cannot be used here.
  // Callers operating on already-written files should additionally verify
  // with realpathSync against the real workspace root.
  const root = '/__qodo_workspace_root__';
  const resolved = resolve(root, decoded.replace(/\\/g, '/'));
  const normalised = resolved.startsWith(root + '/')
    ? resolved.slice(root.length + 1)
    : ''; // resolved outside root entirely (e.g. absolute path, or escaped via ..)

  if (!normalised) {
    logger.warn('Path escapes workspace root', { filePath });
    return false;
  }

  // Blocked takes precedence
  if (config.blockedPaths.some((prefix) => normalised.startsWith(prefix))) {
    logger.warn('Path blocked by path-guard', { filePath });
    return false;
  }

  // Must match at least one allowed prefix.
  // Also accept the exact directory root (e.g. "src" resolves from "src/..").
  const allowed = config.allowedPaths.some((prefix) => {
    if (normalised.startsWith(prefix)) return true;
    const root = prefix.replace(/\/$/, '');
    return root.length > 0 && normalised === root;
  });
  if (!allowed) {
    logger.warn('Path not in allowlist', { filePath });
  }
  return allowed;
}

export function assertPathsAllowed(
  filePaths: string[],
  workspaceRoot: string,
  env?: PathGuardEnv,
): void {
  const config = loadPathGuardConfig(workspaceRoot, env);
  const violations = filePaths.filter((p) => !isPathAllowed(p, config));
  if (violations.length > 0) {
    throw new Error(
      `Path-guard violation: the following paths are not allowed:\n${violations.join('\n')}`,
    );
  }
}
