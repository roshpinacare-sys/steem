/**
 * sacred-file-integrity.ts — tamper/drift detection for the repo's highest
 * blast-radius files, ported from the sibling ECOS project's "sacred file"
 * pattern (see HARD-TASKS-BACKLOG.md item #14).
 *
 * ECOS hashes `fiatLedger.js` / `auditLog.js` with MD5 every session. Qodo
 * already has a stronger hash primitive in-house (`audit-log.ts` uses
 * SHA-256 for its tamper-evident chain), so this port intentionally upgrades
 * MD5 → SHA-256 rather than duplicating a weaker primitive — MD5 offers no
 * meaningful integrity guarantee and this repo's own hash-chain precedent is
 * SHA-256. Everything else about the pattern (a checked-in manifest of
 * known-good hashes, verified every session, drift = loud signal) is
 * preserved as-is.
 *
 * Purpose: catch exactly the defect class this repo's own audit history
 * flags as the most common one — a critical file silently drifting (e.g.
 * unreachable drift-halt logic, a fake-lock condition) with no other
 * validator positioned to notice, because nothing else in the pipeline
 * re-reads these specific files every run.
 *
 * This module is intentionally dependency-free beyond `crypto`/`fs`, in the
 * same spirit as kill-switch.ts: it must be able to run even if every other
 * service is degraded.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { appendAuditEntry } from "./audit-log.js";
import { log as logger } from "./logger.js";

const MANIFEST_FILE = ".sacred-manifest.json";

/**
 * The repo's current blast-radius files, per HARD-TASKS-BACKLOG.md item #14:
 * schemas (the AI-contract boundary), path-guard-scoped.ts (the filesystem
 * write boundary), and cli.ts (the phase state machine + kill-switch call
 * sites). audit-log.ts and kill-switch.ts are included because they are the
 * mechanisms that would otherwise be relied on to report tampering with
 * anything else on this list.
 *
 * This list is deliberately small and explicit — matching the Phase-1
 * roadmap principle of a "fixed, small set" rather than an open-ended glob,
 * so additions are a reviewed, intentional decision each time.
 */
export const SACRED_FILES: readonly string[] = [
  "packages/agent/src/cli.ts",
  "packages/agent/src/validators/path-guard-scoped.ts",
  "packages/agent/src/services/audit-log.ts",
  "packages/agent/src/services/kill-switch.ts",
  "packages/agent/src/schemas/architect-schema.ts",
  "packages/agent/src/schemas/coder-schema.ts",
  "packages/agent/src/schemas/reviewer-schema.ts",
];

export interface SacredManifest {
  generatedAt: string;
  algorithm: "sha256";
  files: Record<string, string>;
}

export interface SacredVerifyResult {
  ok: boolean;
  /** Files whose current hash no longer matches the manifest. */
  drifted: string[];
  /** Files listed in the manifest that no longer exist on disk. */
  missing: string[];
  /** Files on SACRED_FILES with no manifest entry yet (new, not yet baselined). */
  unbaselined: string[];
}

function hashFile(absPath: string): string {
  const contents = readFileSync(absPath);
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Computes and writes a fresh manifest from the current on-disk contents of
 * SACRED_FILES. This is an intentional, reviewed action (e.g. run once after
 * a PR touching a sacred file is merged) — not something the pipeline calls
 * on its own, since that would silently rebaseline over real tampering.
 */
export function generateSacredManifest(workspaceRoot: string): SacredManifest {
  const files: Record<string, string> = {};
  for (const rel of SACRED_FILES) {
    const abs = resolve(workspaceRoot, rel);
    if (!existsSync(abs)) {
      logger.warn("sacred-file-integrity: file listed but not found while generating manifest", { file: rel });
      continue;
    }
    files[rel] = hashFile(abs);
  }
  const manifest: SacredManifest = {
    generatedAt: new Date().toISOString(),
    algorithm: "sha256",
    files,
  };
  writeFileSync(resolve(workspaceRoot, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  logger.info("sacred-file-integrity: manifest generated", { fileCount: Object.keys(files).length });
  return manifest;
}

function loadManifest(workspaceRoot: string): SacredManifest | null {
  const path = resolve(workspaceRoot, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SacredManifest;
  } catch {
    logger.warn("sacred-file-integrity: manifest exists but is not valid JSON; treating as absent", { path });
    return null;
  }
}

/**
 * Verifies every file in SACRED_FILES against the checked-in manifest.
 * Pure read-only check — never writes, never halts on its own. Callers
 * (e.g. cli.ts at pipeline start) decide what to do with the result, same
 * separation of concerns as kill-switch.ts (`isHalted` vs `assertNotHalted`).
 *
 * If no manifest exists yet, every sacred file is reported as
 * `unbaselined` rather than `drifted` — an unestablished baseline is not
 * evidence of tampering, and should not be conflated with it.
 */
export function verifySacredFiles(workspaceRoot: string): SacredVerifyResult {
  const manifest = loadManifest(workspaceRoot);
  const drifted: string[] = [];
  const missing: string[] = [];
  const unbaselined: string[] = [];

  for (const rel of SACRED_FILES) {
    const abs = resolve(workspaceRoot, rel);
    const baseline = manifest?.files[rel];

    if (!baseline) {
      unbaselined.push(rel);
      continue;
    }
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const current = hashFile(abs);
    if (current !== baseline) {
      drifted.push(rel);
    }
  }

  const ok = drifted.length === 0 && missing.length === 0;
  const result: SacredVerifyResult = { ok, drifted, missing, unbaselined };

  if (!ok) {
    logger.error("sacred-file-integrity: drift detected on critical file(s)", { drifted, missing });
  } else if (unbaselined.length > 0) {
    logger.warn("sacred-file-integrity: some sacred files have no baseline yet", { unbaselined });
  } else {
    logger.info("sacred-file-integrity: all sacred files verified OK", { checked: SACRED_FILES.length });
  }

  return result;
}

/**
 * Runs verifySacredFiles() and, if drift or a missing file is found, records
 * it in the tamper-evident audit chain (not just a log line — logs rotate
 * and are best-effort; the audit chain is the accountability trail). This is
 * the explicit "wired into a real entry point" step the roadmap's Phase 0
 * preconditions call out as the most commonly missed step in this codebase's
 * history: a module that is written and unit-tested but never actually
 * called from a live pipeline phase.
 */
export function verifyAndAuditSacredFiles(workspaceRoot: string, runId: string): SacredVerifyResult {
  const result = verifySacredFiles(workspaceRoot);
  if (!result.ok) {
    try {
      appendAuditEntry(workspaceRoot, "sacred-file-drift-detected", runId || "qodo-agent", {
        drifted: result.drifted,
        missing: result.missing,
      });
    } catch {
      // Audit logging must never block the pipeline (same contract as cli.ts's audit()).
    }
  }
  return result;
}
