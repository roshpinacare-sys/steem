import "../_flush.mjs";
/**
 * tests/scripts/publish-sdk.test.ts
 *
 * Tests for scripts/publish-sdk.mjs — SDK publish orchestrator.
 *
 * Coverage:
 *   • --dry-run validates all three SDK packages without side effects
 *   • Missing package.json causes validation failure
 *   • Missing .npmrc for scoped package causes validation failure
 *   • --prod is blocked without NPM_TOKEN (fail-closed)
 *   • npm publish --dry-run produces no warnings
 *   • Script exits 0 on success, non-zero on failure
 */

import { test, assert, eq } from "../_harness.mjs";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasNpmWarning, NPM_WARNING_MARKERS } from "../../scripts/publish-sdk.mjs";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dir, "../..");
const SCRIPT = join(ROOT, "scripts/publish-sdk.mjs");

function pkgDir(name: string): string {
  return join(ROOT, "sdk", name);
}

function readJson(name: string): any {
  return JSON.parse(readFileSync(join(pkgDir(name), "package.json"), "utf8"));
}

function runScript(args = "", env = {}) {
  try {
    const out = execSync(`node ${JSON.stringify(SCRIPT)} ${args}`, {
      encoding: "utf8",
      timeout: 30_000,
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (e: any) {
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ─── Dry-run happy path ───────────────────────────────────────────────────────

test("publish-sdk --dry-run exits 0 and validates all 3 packages", () => {
  const res = runScript("--dry-run");
  eq(res.status, 0, `expected exit 0, got ${res.status}. stdout: ${res.stdout}`);
  assert(res.stdout.includes("@tfa/passport-client"), "output mentions passport-client");
  assert(res.stdout.includes("@tfa/escrow-client"), "output mentions escrow-client");
  assert(res.stdout.includes("@tfa/cli"), "output mentions cli");
  assert(res.stdout.includes("All 3 SDK packages validated successfully"), "output reports success");
});

// ─── Prod blocked without NPM_TOKEN ───────────────────────────────────────────

test("publish-sdk --prod blocked without NPM_TOKEN", () => {
  const res = runScript("--prod", { NPM_TOKEN: "" });
  assert(res.status !== 0, "expected non-zero exit when NPM_TOKEN is missing");
  assert(res.stdout.includes("NPM_TOKEN") || res.stderr.includes("NPM_TOKEN"), "error mentions NPM_TOKEN");
});

// ─── Validation: scoped package requires .npmrc ───────────────────────────────

test("publish-sdk detects missing .npmrc on scoped package", () => {
  // Temporarily rename .npmrc in passport-client, run script, restore
  const pkgDir = join(ROOT, "sdk/passport-client");
  const npmrcPath = join(pkgDir, ".npmrc");
  const backupPath = join(pkgDir, ".npmrc.bak");

  if (!existsSync(npmrcPath)) {
    assert(false, "test precondition failed: .npmrc should exist");
    return;
  }

  // move away
  rmSync(backupPath, { force: true });
  writeFileSync(backupPath, readFileSync(npmrcPath));
  rmSync(npmrcPath);

  try {
    const res = runScript("--dry-run");
    assert(res.status !== 0, "expected failure when .npmrc missing for scoped package");
    assert(
      res.stdout.includes("missing .npmrc") || res.stderr.includes("missing .npmrc"),
      "error mentions missing .npmrc",
    );
  } finally {
    // restore
    if (existsSync(backupPath)) {
      writeFileSync(npmrcPath, readFileSync(backupPath));
      rmSync(backupPath);
    }
  }
});

// ─── Validation: missing package.json ─────────────────────────────────────────

test("publish-sdk detects missing package.json", () => {
  const pkgDir = join(ROOT, "sdk/passport-client");
  const jsonPath = join(pkgDir, "package.json");
  const backupPath = join(pkgDir, "package.json.bak");

  if (!existsSync(jsonPath)) {
    assert(false, "test precondition failed: package.json should exist");
    return;
  }

  rmSync(backupPath, { force: true });
  writeFileSync(backupPath, readFileSync(jsonPath));
  rmSync(jsonPath);

  try {
    const res = runScript("--dry-run");
    assert(res.status !== 0, "expected failure when package.json missing");
    assert(
      res.stdout.includes("missing package.json") || res.stderr.includes("missing package.json"),
      "error mentions missing package.json",
    );
  } finally {
    if (existsSync(backupPath)) {
      writeFileSync(jsonPath, readFileSync(backupPath));
      rmSync(backupPath);
    }
  }
});

// ─── npm 11 bin integrity: values must be in npm's normalized form ────────────
// npm 11's bin normalizer strips a leading "./" and would emit
// `"bin[...]" was invalid and removed`, dropping the entry from the published
// manifest. Bin values must already be normalized (no leading "./") so npm
// makes no correction. Replicates npm-normalize-package-bin's per-value rule.

function npmNormalizeBinValue(v: string): string {
  // npm: join("/", value).slice(1) — drops leading "./", collapses . and ..
  return join("/", v).slice(1);
}

function assertBinUnchanged(pkgName: string, binKey: string) {
  const pkg = readJson(pkgName);
  assert(pkg.bin && typeof pkg.bin === "object", `${pkgName}: bin is an object`);
  const val = pkg.bin[binKey];
  assert(typeof val === "string" && val.length > 0, `${pkgName}: bin.${binKey} present`);
  eq(
    npmNormalizeBinValue(val),
    val,
    `${pkgName}: bin.${binKey} ("${val}") must equal its npm-normalized form ("${npmNormalizeBinValue(val)}") so npm 11 does not rewrite/remove it`,
  );
  // The target file must actually exist in the package.
  assert(existsSync(join(pkgDir(pkgName), val)), `${pkgName}: bin target ${val} exists on disk`);
}

test("@tfa/cli keeps a valid bin.tfa that npm 11 will not strip", () => {
  assertBinUnchanged("cli", "tfa");
  const pkg = readJson("cli");
  eq(pkg.bin.tfa, "bin/tfa.mjs", "cli bin.tfa points at bin/tfa.mjs");
});

test("@tfa/passport-client keeps a valid bin.verify-passport that npm 11 will not strip", () => {
  assertBinUnchanged("passport-client", "verify-passport");
  const pkg = readJson("passport-client");
  eq(pkg.bin["verify-passport"], "verify-passport.mjs", "passport bin points at verify-passport.mjs");
});

// ─── warning detector: real package.json corrections vs benign notices ────────

test("hasNpmWarning catches real package.json auto-correction warnings", () => {
  assert(hasNpmWarning('npm WARN publish "bin[tfa]" script name bin/tfa.mjs was invalid and removed'), "bin invalid+removed caught");
  assert(hasNpmWarning("npm warn publish npm auto-corrected some errors in your package.json"), "auto-corrected caught");
  assert(hasNpmWarning('npm WARN publish "bin[myapp]" script name was cleaned'), "was cleaned caught");
  assert(hasNpmWarning("npm warn publish errors corrected:"), "errors corrected caught");
  assert(hasNpmWarning('Removed invalid "scripts"'), "removed invalid caught");
});

test("hasNpmWarning ignores the benign unauthenticated dry-run login notice", () => {
  // This appears on EVERY unauthenticated dry-run; matching it would make the gate useless.
  assert(
    !hasNpmWarning("npm warn This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)"),
    "login notice must not be treated as a package.json warning",
  );
  assert(!hasNpmWarning("npm notice package: @tfa/cli@1.0.0"), "plain notice is not a warning");
  assert(!hasNpmWarning(""), "empty string is not a warning");
});

test("NPM_WARNING_MARKERS does not include the bare 'npm warn' phrase", () => {
  // Guard against regressing to an over-broad matcher.
  assert(!NPM_WARNING_MARKERS.includes("npm warn"), "bare 'npm warn' must not be a marker");
  assert(NPM_WARNING_MARKERS.includes("was invalid"), "'was invalid' is a marker");
});

// ─── dry-run fails on a real warning (fault injection) ────────────────────────
// Revert one package's bin to the broken "./"-prefixed form and confirm the
// orchestrator's dry-run detects npm's correction and fails. Skips gracefully
// if the local npm is too old to emit the warning (the detector is unit-tested
// above regardless), so this never produces a false red on old toolchains.

test("publish-sdk --dry-run FAILS when a bin entry triggers npm correction", () => {
  const pkgDir_ = join(ROOT, "sdk/cli");
  const jsonPath = join(pkgDir_, "package.json");
  const original = readFileSync(jsonPath, "utf8");
  const broken = original.replace('"tfa": "bin/tfa.mjs"', '"tfa": "./bin/tfa.mjs"');
  assert(broken !== original, "fault injection actually changed the bin value");

  // First, confirm THIS npm version emits a correction for the broken form.
  writeFileSync(jsonPath, broken);
  try {
    let npmCorrects = false;
    try {
      const res = execSync("npm publish --dry-run --access public 2>&1", {
        cwd: pkgDir_, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" },
      });
      npmCorrects = hasNpmWarning(res);
    } catch (e: any) {
      npmCorrects = hasNpmWarning((e.stdout ?? "") + (e.stderr ?? ""));
    }

    if (!npmCorrects) {
      // Old npm (e.g. 10.x) does not emit the correction; detector is covered by unit tests.
      assert(true, "skipped: local npm does not emit bin correction (detector unit-tested separately)");
      return;
    }

    const res = runScript("--dry-run");
    assert(res.status !== 0, "orchestrator must fail when npm corrects the manifest");
    assert(
      (res.stdout + res.stderr).includes("package.json warnings"),
      "failure message names the package.json warning",
    );
  } finally {
    writeFileSync(jsonPath, original);
  }
});

test("publish-sdk --dry-run passes with the corrected (normalized) bin values", () => {
  // Regression guard: the shipped packages must pass cleanly.
  const res = runScript("--dry-run");
  eq(res.status, 0, `expected clean dry-run, got ${res.status}. out: ${res.stdout}${res.stderr}`);
});
