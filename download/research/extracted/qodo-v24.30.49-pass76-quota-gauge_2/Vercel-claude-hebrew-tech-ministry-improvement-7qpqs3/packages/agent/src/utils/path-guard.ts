/**
 * Pass 36 fix — this file previously contained an independent, weaker
 * path-traversal check (literal ".." segment matching only — no null-byte
 * stripping, no URL-decoding, no fixed-root resolve). It is the ONLY guard
 * actually called on coder-agent output (see agents/coder.ts), which means
 * every hardening added to validators/path-guard-scoped.ts in Pass 33 and
 * Pass 35 (null-byte stripping, URL-decode, .. resolution against a fixed
 * root) never protected the live pipeline — that code path was unreachable
 * dead code, exactly the bug class scripts/check-dead-integrations.mjs is
 * built to catch, and it did flag all three exports of path-guard-scoped.ts
 * as unreferenced. Nobody had triaged that specific flag yet.
 *
 * Fix: delegate to the hardened validator so there is a single source of
 * truth. `guardPaths(files)` keeps its existing signature so `coder.ts`
 * requires no changes and no new params need to be threaded through the
 * call chain (runCoder does not currently receive a workspaceRoot).
 *
 * ⚠ BEHAVIOR CHANGE — MUST BE VERIFIED BEFORE MERGE, NOT ASSUMED SAFE:
 * The old BLOCKED list was minimal (".github/workflows/", literal "..").
 * The new DEFAULT_CONFIG (from path-guard-scoped.ts) has a real allowlist
 * (`src/`, `lib/`, `apps/`, `packages/`, `worker/`) in addition to a wider
 * blocklist. Any legitimate coder-generated file OUTSIDE those five
 * prefixes — e.g. top-level config (`package.json`, `tsconfig.json`),
 * `k6/`, `k8s/`, `scripts/`, `bin/`, `docker-compose.yml`, root docs — will
 * now be REJECTED where it previously passed. That may be correct (the
 * coder agent arguably shouldn't be editing k8s manifests unsupervised)
 * or it may break legitimate current behavior. This was not run against
 * the test suite or build (no network/npm access in the environment that
 * produced this patch — same constraint noted in the original
 * AGENT_INSTRUCTIONS.md). Do not merge without running the full test
 * suite and at least one real end-to-end coder run against a task that
 * touches a root-level file, and either confirm the new rejection is
 * correct or widen `allowedPaths` via ALLOWED_PATHS env / config file.
 *
 * config resolution: loadPathGuardConfig() also reads a
 * `path-guard-config.json` from the workspace root and ALLOWED_PATHS /
 * BLOCKED_PATHS env vars. Using process.cwd() here as the workspace root
 * assumes the agent process is always invoked from the repo root — verify
 * that assumption holds for every entry point (CLI, k8s job, worker).
 */
import { isPathAllowed as isPathAllowedScoped, loadPathGuardConfig } from "../validators/path-guard-scoped.js";

export function isPathAllowed(path: string): boolean {
  const config = loadPathGuardConfig(process.cwd());
  return isPathAllowedScoped(path, config);
}

export function guardPaths(files: { path: string }[]): { allowed: boolean; blocked: string[] } {
  const config = loadPathGuardConfig(process.cwd());
  const blocked = files.map((f) => f.path).filter((p) => !isPathAllowedScoped(p, config));
  return { allowed: blocked.length === 0, blocked };
}
