#!/usr/bin/env node
/**
 * scripts/publish-sdk.mjs — SDK publish orchestrator for @tfa/* packages.
 *
 * Validates all three publishable SDK packages, then optionally publishes
 * them to the npm registry with --access public (required for scoped packages).
 *
 * Usage:
 *   node scripts/publish-sdk.mjs [--dry-run | --prod]
 *
 * --dry-run (default):
 *   Runs npm publish --dry-run --access public in each package directory.
 *   Validates packaging without side effects. Exits 0 if all pass.
 *
 * --prod:
 *   Runs npm publish --access public for real. Requires NPM_TOKEN env var.
 *   Exits 0 on success, 1 on any failure.
 *
 * Packages (in order):
 *   sdk/passport-client  → @tfa/passport-client
 *   sdk/escrow-client    → @tfa/escrow-client
 *   sdk/cli              → @tfa/cli
 *
 * Invariants:
 *   • Every package must have package.json, README.md, LICENSE.
 *   • npm publish --dry-run must emit zero warnings per package.
 *   • Scoped packages always use --access public (fail-closed for publish).
 *   • --prod is blocked without NPM_TOKEN (fail-closed for auth).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const PACKAGES = [
  { dir: "sdk/passport-client", name: "@tfa/passport-client" },
  { dir: "sdk/escrow-client",   name: "@tfa/escrow-client" },
  { dir: "sdk/cli",             name: "@tfa/cli" },
];

const ARGS = process.argv.slice(2);
const PROD = ARGS.includes("--prod");
const DRY_RUN = !PROD || ARGS.includes("--dry-run");

function log(msg) {
  console.log(msg);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validatePackage(pkg) {
  const pkgDir = join(ROOT, pkg.dir);
  const pkgJsonPath = join(pkgDir, "package.json");
  const readmePath = join(pkgDir, "README.md");
  const licensePath = join(pkgDir, "LICENSE");
  const npmrcPath = join(pkgDir, ".npmrc");

  if (!existsSync(pkgJsonPath)) {
    throw new Error(`${pkg.name}: missing package.json`);
  }
  if (!existsSync(readmePath)) {
    throw new Error(`${pkg.name}: missing README.md`);
  }
  if (!existsSync(licensePath)) {
    throw new Error(`${pkg.name}: missing LICENSE`);
  }

  const pkgJson = readJson(pkgJsonPath);
  if (!pkgJson.name || typeof pkgJson.name !== "string") {
    throw new Error(`${pkg.name}: package.json missing valid name`);
  }
  if (!pkgJson.version || typeof pkgJson.version !== "string") {
    throw new Error(`${pkg.name}: package.json missing valid version`);
  }
  if (!pkgJson.license) {
    throw new Error(`${pkg.name}: package.json missing license`);
  }

  // Ensure .npmrc with access=public exists for scoped packages
  if (pkgJson.name.startsWith("@")) {
    if (!existsSync(npmrcPath)) {
      throw new Error(`${pkg.name}: missing .npmrc (scoped packages require access=public)`);
    }
    const npmrc = readFileSync(npmrcPath, "utf8");
    if (!npmrc.includes("access=public")) {
      throw new Error(`${pkg.name}: .npmrc missing access=public`);
    }
  }
}

/**
 * Markers npm uses specifically when it AUTO-CORRECTS or REJECTS part of
 * package.json on publish (e.g. `npm WARN publish "bin[tfa]" ... was invalid
 * and removed`). These go to STDERR and npm still exits 0 for --dry-run, so we
 * must inspect stderr ourselves or a stripped bin entry passes silently.
 *
 * Deliberately NARROW: the bare phrase "npm warn" is NOT a marker, because npm
 * prints a benign "npm warn This command requires you to be logged in … (dry-run)"
 * on every unauthenticated dry-run. Matching that would make the check useless.
 * We match only package.json-mutation phrases, which always signal a real defect.
 */
const NPM_WARNING_MARKERS = [
  "auto-corrected",
  "was invalid",
  "was cleaned",
  "removed invalid",
  "errors corrected",
  "invalid and removed",
  "npm pkg fix", // npm appends this advice whenever it corrected the manifest
];

function hasNpmWarning(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return NPM_WARNING_MARKERS.some((m) => lower.includes(m));
}

function runNpmPublishDryRun(pkgDir) {
  // spawnSync (not execSync) so we capture BOTH stdout and stderr. npm emits
  // package.json auto-correction warnings on stderr and exits 0 for --dry-run,
  // so scanning stdout alone (the old bug) let stripped bin entries pass.
  const res = spawnSync(
    "npm",
    ["publish", "--dry-run", "--access", "public"],
    {
      cwd: pkgDir,
      encoding: "utf8",
      env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" },
    },
  );

  if (res.error) {
    throw new Error(`npm publish --dry-run could not run: ${res.error.message}`);
  }
  const stdout = res.stdout || "";
  const stderr = res.stderr || "";

  // Fail-closed on a non-zero exit (real packaging error).
  if (res.status !== 0) {
    throw new Error(
      `npm publish --dry-run exited ${res.status}:\n${stderr || stdout}`,
    );
  }

  // Fail on auto-correction/invalid warnings in EITHER stream. These mean npm
  // rewrote package.json on publish (e.g. a removed bin entry) — a real defect.
  if (hasNpmWarning(stdout) || hasNpmWarning(stderr)) {
    throw new Error(
      `npm publish --dry-run emitted package.json warnings (npm would rewrite the published manifest):\n${stderr}${stdout}`,
    );
  }
  return stdout;
}

function runNpmPublishProd(pkgDir) {
  const out = execSync("npm publish --access public", {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return out;
}

function main() {
  if (PROD && !process.env.NPM_TOKEN) {
    die("Error: --prod requires NPM_TOKEN environment variable.");
  }

  let failures = 0;

  for (const pkg of PACKAGES) {
    try {
      log(`\n[validate] ${pkg.name}`);
      validatePackage(pkg);
      log(`  ✓ structure OK`);
    } catch (e) {
      log(`  ✗ validation failed: ${e.message}`);
      failures++;
      continue;
    }

    const pkgDir = join(ROOT, pkg.dir);

    try {
      if (DRY_RUN || !PROD) {
        log(`  → npm publish --dry-run --access public`);
        runNpmPublishDryRun(pkgDir);
        log(`  ✓ dry-run OK`);
      }
      if (PROD) {
        log(`  → npm publish --access public`);
        runNpmPublishProd(pkgDir);
        log(`  ✓ published`);
      }
    } catch (e) {
      log(`  ✗ publish failed: ${e.message}`);
      failures++;
    }
  }

  log("");
  if (failures > 0) {
    die(`\nFailed: ${failures} package(s) had errors.`);
  }
  log(`All ${PACKAGES.length} SDK packages validated successfully.`);
  process.exit(0);
}

// Run as a CLI only when invoked directly; stay importable for unit tests.
const INVOKED_DIRECTLY =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main();
}

export { hasNpmWarning, NPM_WARNING_MARKERS };
