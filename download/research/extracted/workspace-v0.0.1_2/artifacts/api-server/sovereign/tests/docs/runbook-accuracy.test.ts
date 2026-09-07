import "../_flush.mjs";
/**
 * tests/docs/runbook-accuracy.test.ts
 *
 * Verify that the ops runbook (docs/RUNBOOK.md) is accurate:
 *   • file exists and is substantial
 *   • every script referenced in backticks under `scripts/` actually exists on disk
 *   • every env var in the runbook table is known to the system
 *   • runbook version is consistent with MANIFEST.md
 *
 * Failures here indicate documentation drift — the runbook claims capabilities
 * or references scripts that do not exist, which misleads on-call engineers.
 */

import { test, assert, eq } from "../_harness.mjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const read = (name: string): string => readFileSync(join(root, name), "utf8");
const exists = (name: string): boolean => existsSync(join(root, name));

// ─── Existence & size ───────────────────────────────────────────────────────

test("RUNBOOK: exists and is substantial", () => {
  assert(exists("docs/RUNBOOK.md"), "docs/RUNBOOK.md exists");
  const content = read("docs/RUNBOOK.md");
  assert(content.length > 2000, "RUNBOOK is substantial (>2000 chars)");
});

// ─── Script references must exist ───────────────────────────────────────────

test("RUNBOOK: every scripts/ reference exists on disk", () => {
  const runbook = read("docs/RUNBOOK.md");
  const scriptRefs = new Set<string>();
  // Match script filenames inside backticks, allowing prefixes like "node " or paths
  const pattern = /`(?:node\s+)?scripts\/([a-z0-9_.-]+(?:\.[a-z]+)?)`/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(runbook)) !== null) {
    scriptRefs.add(m[1]);
  }

  assert(scriptRefs.size > 0, "RUNBOOK references at least one script");

  for (const scriptName of scriptRefs) {
    const path = `scripts/${scriptName}`;
    assert(
      exists(path),
      `RUNBOOK references ${path} but it does not exist on disk`
    );
  }
});

// ─── Env vars in the table must be known ────────────────────────────────────

test("RUNBOOK: env vars in the table are known to the system", () => {
  const runbook = read("docs/RUNBOOK.md");
  const checkEnv = read("scripts/check-env.mjs");
  const composition = read("src/composition.ts");
  const server = read("src/http/sovereign-server.ts");

  // Extract env vars from the runbook table rows: `VAR_NAME`
  const envPattern = /\|\s*`([A-Z_][A-Z0-9_]*)`/g;
  const envVars = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = envPattern.exec(runbook)) !== null) {
    envVars.add(m[1]);
  }

  assert(envVars.size >= 5, "RUNBOOK documents at least 5 env vars");

  for (const v of envVars) {
    const known =
      checkEnv.includes(v) ||
      composition.includes(v) ||
      server.includes(v) ||
      v === "TFA_SECRET"; // validated implicitly by signer init
    assert(known, `RUNBOOK env var ${v} is not referenced in check-env, composition, or server`);
  }
});

// ─── Version consistency ────────────────────────────────────────────────────

test("RUNBOOK: version is consistent with MANIFEST", () => {
  const runbook = read("docs/RUNBOOK.md");
  const manifest = read("MANIFEST.md");

  // Allow markdown formatting around Version: e.g. **Version:** v271
  const rbMatch = runbook.match(/Version:[:\s*]*v(\d+)/);
  assert(rbMatch, "RUNBOOK has a version header");
  const rbVersion = Number(rbMatch![1]);

  const mfMatch = manifest.match(/MANIFEST קנוני \(v(\d+)\)/);
  assert(mfMatch, "MANIFEST has a version header");
  const mfVersion = Number(mfMatch![1]);

  // Runbook may be equal to or ahead of MANIFEST (if updated in same cycle)
  assert(
    rbVersion >= mfVersion,
    `RUNBOOK version v${rbVersion} should be >= MANIFEST v${mfVersion}`
  );
});

// ─── No reference to removed legacy scripts ─────────────────────────────────

test("RUNBOOK: does not reference removed legacy scripts", () => {
  const runbook = read("docs/RUNBOOK.md");
  const legacy = ["scripts/backup.mjs", "scripts/restore.mjs", "scripts/verify-backup.mjs"];
  for (const ref of legacy) {
    assert(
      !runbook.includes(ref),
      `RUNBOOK must not reference removed legacy script ${ref}`
    );
  }
});
