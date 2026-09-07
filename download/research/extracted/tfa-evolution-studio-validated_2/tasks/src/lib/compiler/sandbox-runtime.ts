/**
 * TFA Evolution Studio v28 — Sandbox Runtime
 *
 * Every project executes inside a strictly isolated sandbox.
 * Sandboxes are keyed by (projectId, sandboxId) and live under
 * WORKSPACE_ROOT/sandboxes/<projectId>/<sandboxId>/.
 *
 * Guarantees:
 *   - No two projects share a sandbox directory
 *   - All temporary execution state is inside the sandbox
 *   - ZIP ingest, extract, install, build, and export all operate
 *     within the sandbox boundary — never touching application source
 *   - Cross-project contamination is blocked by assertProjectIsolation()
 *   - Sandbox cleanup removes all ephemeral state without touching
 *     the durable artifact store
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import AdmZip from "adm-zip";
import { ensureDir, WORKSPACE_ROOT, getVersionArtifactsDir } from "@/lib/paths";
import { discoverAdapter } from "./adapter-registry";
import type { SandboxContext, SandboxIngestResult } from "@/lib/types";

const SANDBOXES_ROOT = path.join(WORKSPACE_ROOT, "sandboxes");

// ── Internal ───────────────────────────────────────────────────────────────

function getSandboxRoot(projectId: string, sandboxId: string): string {
  return path.join(SANDBOXES_ROOT, projectId, sandboxId);
}

function getActiveSandboxesFile(projectId: string): string {
  return path.join(SANDBOXES_ROOT, projectId, "_active.json");
}

function loadActiveSandboxes(projectId: string): SandboxContext[] {
  const file = getActiveSandboxesFile(projectId);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as SandboxContext[];
  } catch {
    return [];
  }
}

function saveActiveSandboxes(projectId: string, sandboxes: SandboxContext[]): void {
  const file = getActiveSandboxesFile(projectId);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(sandboxes, null, 2));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new isolated sandbox for a project.
 * Returns the SandboxContext describing all paths within the sandbox.
 */
export function createSandbox(
  projectId: string,
  isolationLevel: "strict" | "normal" = "strict"
): SandboxContext {
  const sandboxId = `sbx_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
  const sandboxRoot = getSandboxRoot(projectId, sandboxId);
  const projectRoot = path.join(sandboxRoot, "project");
  const artifactsDir = path.join(sandboxRoot, "artifacts");
  const tmpDir = path.join(sandboxRoot, "tmp");

  ensureDir(sandboxRoot);
  ensureDir(projectRoot);
  ensureDir(artifactsDir);
  ensureDir(tmpDir);

  const ctx: SandboxContext = {
    projectId,
    sandboxId,
    sandboxRoot,
    projectRoot,
    artifactsDir,
    tmpDir,
    createdAt: new Date().toISOString(),
    isolationLevel,
  };

  const active = loadActiveSandboxes(projectId);
  active.push(ctx);
  saveActiveSandboxes(projectId, active);
  return ctx;
}

/**
 * Ingest a ZIP into a sandbox.
 * Extracts into sandbox.projectRoot and auto-discovers the adapter.
 * Fails immediately if the ZIP path escapes the sandbox boundary.
 */
export async function ingestZipIntoSandbox(
  ctx: SandboxContext,
  zipPath: string
): Promise<SandboxIngestResult> {
  // Assert the ZIP lives under workspace (not application source)
  assertPathWithinWorkspace(zipPath);

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Sandbox ingest failed: ZIP not found at ${zipPath}`);
  }

    // sandbox-runtime.ts was missed in the v24 pass that patched project-ir.ts
  // for the same CVE-class vulnerability. A malicious ZIP could escape the
  // sandbox boundary and write into the host filesystem.
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error(`Sandbox ingest failed: ZIP is empty at ${zipPath}`);
  }
  const resolvedProjectRoot = path.resolve(ctx.projectRoot);
  for (const entry of entries) {
    const entryPath = path.resolve(resolvedProjectRoot, entry.entryName);
    if (
      !entryPath.startsWith(resolvedProjectRoot + path.sep) &&
      entryPath !== resolvedProjectRoot
    ) {
      throw new Error(
        `[sandbox-runtime] ZIP contains path traversal entry: "${entry.entryName}". ` +
        `Extraction aborted to protect sandbox boundary.`
      );
    }
  }
  zip.extractAllTo(ctx.projectRoot, true);

  const files = countFiles(ctx.projectRoot);
  const detectedAdapter = await discoverAdapter(ctx.projectRoot).then((t) => t?.targetId);

  return {
    sandboxId: ctx.sandboxId,
    projectRoot: ctx.projectRoot,
    fileCount: files,
    detectedAdapter,
    ingestedAt: new Date().toISOString(),
  };
}

/**
 * Copy a compiled artifact from sandbox into the durable artifacts store.
 * The sandbox artifact is preserved in-place until destroySandbox() is called.
 */
export function promoteArtifact(
  ctx: SandboxContext,
  artifactFilename: string,
  projectId: string,
  versionId: string
): string {
  const src = path.join(ctx.artifactsDir, artifactFilename);
  if (!fs.existsSync(src)) {
    throw new Error(`Cannot promote artifact: ${src} not found in sandbox`);
  }

  const destDir = getVersionArtifactsDir(projectId, versionId);
  const dest = path.join(destDir, artifactFilename);
  fs.copyFileSync(src, dest);
  return dest;
}

/**
 * Destroy a sandbox, removing all temporary state.
 * Does NOT touch the durable artifact store.
 */
export function destroySandbox(ctx: SandboxContext): void {
  if (fs.existsSync(ctx.sandboxRoot)) {
    fs.rmSync(ctx.sandboxRoot, { recursive: true, force: true });
  }
  const active = loadActiveSandboxes(ctx.projectId).filter(
    (s) => s.sandboxId !== ctx.sandboxId
  );
  saveActiveSandboxes(ctx.projectId, active);
}

/**
 * List all active sandboxes for a project.
 */
export function listActiveSandboxes(projectId: string): SandboxContext[] {
  return loadActiveSandboxes(projectId).filter((s) =>
    fs.existsSync(s.sandboxRoot)
  );
}

/**
 * Assert cross-project isolation: path must not reference another project's sandbox.
 * Throws if the path resolves outside the expected project sandbox subtree.
 */
export function assertProjectIsolation(ctx: SandboxContext, targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const expected = path.resolve(ctx.sandboxRoot);
  if (!resolved.startsWith(expected)) {
    throw new Error(
      `[sandbox-runtime] Isolation violation: path "${resolved}" escapes sandbox ` +
      `boundary "${expected}" for project "${ctx.projectId}".`
    );
  }
}

/**
 * Assert a path lives within WORKSPACE_ROOT (not application source).
 * Used for ZIP ingest to prevent path traversal.
 */
export function assertPathWithinWorkspace(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const workspaceResolved = path.resolve(WORKSPACE_ROOT);
  if (!resolved.startsWith(workspaceResolved)) {
    throw new Error(
      `[sandbox-runtime] Path "${resolved}" is outside WORKSPACE_ROOT ` +
      `"${workspaceResolved}". Refusing to operate on application source.`
    );
  }
}

/**
 * Evict stale sandboxes: remove sandbox directories whose on-disk roots no
 * longer exist (e.g. cleaned up by OS after restart) from the active list.
 */
export function evictStaleSandboxes(projectId: string): number {
  const active = loadActiveSandboxes(projectId);
  const live = active.filter((s) => fs.existsSync(s.sandboxRoot));
  if (live.length !== active.length) {
    saveActiveSandboxes(projectId, live);
  }
  return active.length - live.length;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countFiles(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}
