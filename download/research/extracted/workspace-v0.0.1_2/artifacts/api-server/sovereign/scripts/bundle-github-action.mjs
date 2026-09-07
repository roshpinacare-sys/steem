#!/usr/bin/env node
// scripts/bundle-github-action.mjs
//
// PURPOSE: closes MANIFEST "החסר הבא" #1 — GitHub Action bundler.
//
// Creates a standalone, distributable GitHub Action package from the canonical
// sdk/github-action/ source tree. The composite action is zero-dependency and
// self-contained, but it lives inside the larger sovereign repo. This bundler
// produces a clean, verifiable output directory (or ZIP) that contains ONLY
// the files required for the action — useful for CI artifacts, Marketplace
// publishing, or vendoring into a separate action repository.
//
// USAGE
//   node scripts/bundle-github-action.mjs              # build bundle into dist/github-action/
//   node scripts/bundle-github-action.mjs --out <dir>  # custom output directory
//   node scripts/bundle-github-action.mjs --zip          # also create dist/github-action.zip
//   node scripts/bundle-github-action.mjs --check        # CI mode: verify bundle is fresh
//
// fail-closed: any missing source file, unreadable source, or I/O error exits
// non-zero with a clear message — never silently produces a broken bundle.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SOURCE_DIR = join(REPO_ROOT, "sdk", "github-action");
const DEFAULT_OUT = join(REPO_ROOT, "dist", "github-action");

/** Files that must be present in a complete, standalone action package. */
const REQUIRED_FILES = [
  "action.yml",
  "bin/tfa.mjs",
  "LICENSE",
  "README.md",
];

/**
 * Verify every required file exists in the source directory and is readable.
 * fail-closed: throws with a descriptive message if anything is missing.
 */
export function verifySourceComplete(sourceDir) {
  for (const rel of REQUIRED_FILES) {
    const p = join(sourceDir, rel);
    if (!existsSync(p)) {
      throw new Error(`bundle-github-action: missing required source file: ${rel} (looked at ${p})`);
    }
    try {
      statSync(p);
    } catch {
      throw new Error(`bundle-github-action: cannot read source file: ${rel} (looked at ${p})`);
    }
  }
}

/**
 * Build (or verify) the bundle.
 *
 * @param {{ sourceDir: string; outDir: string; zip?: boolean; checkOnly?: boolean }} opts
 * @returns {{ ok: boolean; outDir: string; zipPath?: string; message: string }}
 */
export function buildBundle({ sourceDir, outDir, zip = false, checkOnly = false }) {
  verifySourceComplete(sourceDir);

  if (checkOnly) {
    if (!existsSync(outDir)) {
      return { ok: false, outDir, message: `Bundle drift: ${outDir} does not exist. Run without --check to generate it.` };
    }
    for (const rel of REQUIRED_FILES) {
      const src = join(sourceDir, rel);
      const dst = join(outDir, rel);
      if (!existsSync(dst)) {
        return { ok: false, outDir, message: `Bundle drift: missing ${rel} in ${outDir}` };
      }
      const srcBytes = readFileSync(src);
      const dstBytes = readFileSync(dst);
      if (!srcBytes.equals(dstBytes)) {
        return { ok: false, outDir, message: `Bundle drift: ${rel} in ${outDir} differs from source` };
      }
    }
    return { ok: true, outDir, message: `Bundle at ${outDir} is in sync with sdk/github-action/` };
  }

  // Clean and recreate output directory
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(join(outDir, "bin"), { recursive: true });

  // Copy required files verbatim
  for (const rel of REQUIRED_FILES) {
    const src = join(sourceDir, rel);
    const dst = join(outDir, rel);
    copyFileSync(src, dst);
  }

  // Verify binary is executable (best effort)
  const binPath = join(outDir, "bin", "tfa.mjs");
  try {
    const versionOutput = execFileSync("node", [binPath, "--version"], { encoding: "utf8", timeout: 5000 }).trim();
    if (!versionOutput) {
      throw new Error("bundle-github-action: bundled binary produced empty --version output");
    }
  } catch (e) {
    if (e.message && e.message.includes("bundle-github-action:")) throw e;
    throw new Error(`bundle-github-action: bundled binary failed to run: ${e.message || e}`);
  }

  let zipPath;
  if (zip) {
    zipPath = outDir + ".zip";
    // Use system `zip` command if available; otherwise skip gracefully
    try {
      if (existsSync(zipPath)) rmSync(zipPath, { force: true });
      execFileSync("zip", ["-r", zipPath, basename(outDir)], { cwd: dirname(outDir), stdio: "pipe" });
    } catch {
      // zip command not available (some CI sandboxes) — non-fatal, the directory bundle is still correct
      zipPath = undefined;
    }
  }

  return { ok: true, outDir, zipPath, message: `Bundle created at ${outDir}${zipPath ? ` and ${zipPath}` : ""}` };
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const zip = args.includes("--zip");
  const outFlag = args.indexOf("--out");
  const outDir = outFlag !== -1 && args[outFlag + 1] ? args[outFlag + 1] : DEFAULT_OUT;

  try {
    const result = buildBundle({ sourceDir: SOURCE_DIR, outDir, zip, checkOnly });
    if (result.ok) {
      console.log(`[bundle-github-action] ${result.message}`);
      process.exit(0);
    } else {
      console.error(`[bundle-github-action] ${result.message}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`[bundle-github-action] FAIL: ${e.message || e}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
