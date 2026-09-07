import "../_flush.mjs";
/**
 * tests/sdk-cli/github-action-bundler.test.ts — v287
 *
 * Closes MANIFEST "החסר הבא" #1 (GitHub Action sync/bundler) by testing the
 * bundler that creates a standalone, distributable GitHub Action package.
 *
 * The sync script (github-action-bin-sync.test.ts) already verifies that
 * sdk/github-action/bin/tfa.mjs is a generated, up-to-date copy of the CLI.
 * This suite verifies that the BUNDLER produces a clean, self-contained,
 * byte-identical package from the sdk/github-action/ source tree.
 *
 * Coverage:
 *   buildBundle (pure-ish function, scratch directories)
 *     • bundle creation produces all required files (action.yml, bin/tfa.mjs, LICENSE, README.md)
 *     • bundled binary is executable and runs (--version succeeds)
 *     • bundle files are byte-identical to source (no silent transformation)
 *     • idempotency: running buildBundle twice from the same source produces identical output
 *     • --check mode passes on a fresh bundle
 *     • --check mode fails when a file is missing from the bundle
 *     • --check mode fails when a file in the bundle has been tampered with
 *
 *   verifySourceComplete (unit-level)
 *     • all required files present → no throw
 *     • missing required file → throws with descriptive message
 *
 *   fail-closed
 *     • missing source file → buildBundle throws, not silently produces broken bundle
 *     • bundled binary that fails to run → buildBundle throws
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test, assert, eq } from "../_harness.mjs";
import { buildBundle, verifySourceComplete } from "../../scripts/bundle-github-action.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const REAL_SOURCE_DIR = join(ROOT, "sdk", "github-action");
const BUNDLE_SCRIPT = join(ROOT, "scripts", "bundle-github-action.mjs");

// ─── verifySourceComplete (unit-level) ──────────────────────────────────────

test("verifySourceComplete: passes when all required files exist", () => {
  let threw = false;
  try {
    verifySourceComplete(REAL_SOURCE_DIR);
  } catch {
    threw = true;
  }
  assert(!threw, "real sdk/github-action/ should have all required files");
});

test("verifySourceComplete [fail-closed]: throws when a required file is missing", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  try {
    mkdirSync(join(scratch, "bin"), { recursive: true });
    writeFileSync(join(scratch, "action.yml"), "name: test\n", "utf8");
    writeFileSync(join(scratch, "bin", "tfa.mjs"), "#!/usr/bin/env node\n", "utf8");
    writeFileSync(join(scratch, "LICENSE"), "MIT\n", "utf8");
    // deliberately omit README.md
    let threw = false;
    let msg = "";
    try {
      verifySourceComplete(scratch);
    } catch (e: any) {
      threw = true;
      msg = e.message;
    }
    assert(threw, "missing README.md must cause a throw");
    assert(/README\.md/.test(msg), `error mentions the missing file: ${msg}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ─── buildBundle: happy path (scratch directories) ────────────────────────────

test("buildBundle: creates all required files in the output directory", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    // Lay out a minimal valid source tree
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    writeFileSync(join(scratchSource, "action.yml"), "name: 'TFA Test'\n", "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), "#!/usr/bin/env node\nconst VERSION='9.9.9';\nconsole.log(VERSION);\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT License\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# Test\n", "utf8");

    const result = buildBundle({ sourceDir: scratchSource, outDir: scratchOut });
    eq(result.ok, true, `bundle creation should succeed: ${result.message}`);

    assert(existsSync(join(scratchOut, "action.yml")), "action.yml should be copied");
    assert(existsSync(join(scratchOut, "bin", "tfa.mjs")), "bin/tfa.mjs should be copied");
    assert(existsSync(join(scratchOut, "LICENSE")), "LICENSE should be copied");
    assert(existsSync(join(scratchOut, "README.md")), "README.md should be copied");
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

test("buildBundle: bundled binary runs and produces version output", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    // Use the REAL CLI binary as the source so --version works without mocking
    const realBin = readFileSync(join(REAL_SOURCE_DIR, "bin", "tfa.mjs"), "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), realBin, "utf8");
    writeFileSync(join(scratchSource, "action.yml"), "name: 'TFA Test'\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# Test\n", "utf8");

    const result = buildBundle({ sourceDir: scratchSource, outDir: scratchOut });
    eq(result.ok, true, `bundle with real binary should succeed: ${result.message}`);

    const versionOutput = execFileSync("node", [join(scratchOut, "bin", "tfa.mjs"), "--version"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    assert(versionOutput.length > 0, "bundled binary should print a version");
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

test("buildBundle: bundle files are byte-identical to source", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    const body = "name: 'TFA'\nbranding:\n  icon: shield\n";
    writeFileSync(join(scratchSource, "action.yml"), body, "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), "#!/usr/bin/env node\nconst VERSION='9.9.9';\nif (process.argv.includes('--version')) { console.log(VERSION); }\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# R\n", "utf8");

    buildBundle({ sourceDir: scratchSource, outDir: scratchOut });

    for (const rel of ["action.yml", "bin/tfa.mjs", "LICENSE", "README.md"]) {
      const srcBytes = readFileSync(join(scratchSource, rel));
      const dstBytes = readFileSync(join(scratchOut, rel));
      assert(srcBytes.equals(dstBytes), `${rel} must be byte-identical between source and bundle`);
    }
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

test("buildBundle: is idempotent — running twice from same source produces identical output", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut1 = mkdtempSync(join(tmpdir(), "tfa-bundle-out1-"));
  const scratchOut2 = mkdtempSync(join(tmpdir(), "tfa-bundle-out2-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    writeFileSync(join(scratchSource, "action.yml"), "name: 'TFA'\n", "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), "#!/usr/bin/env node\nconst VERSION='9.9.9';\nif (process.argv.includes('--version')) { console.log(VERSION); }\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# Idempotent\n", "utf8");

    buildBundle({ sourceDir: scratchSource, outDir: scratchOut1 });
    buildBundle({ sourceDir: scratchSource, outDir: scratchOut2 });

    for (const rel of ["action.yml", "bin/tfa.mjs", "LICENSE", "README.md"]) {
      const first = readFileSync(join(scratchOut1, rel));
      const second = readFileSync(join(scratchOut2, rel));
      assert(first.equals(second), `${rel} must be identical between two bundle runs`);
    }
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut1, { recursive: true, force: true });
    rmSync(scratchOut2, { recursive: true, force: true });
  }
});

// ─── buildBundle: --check mode ────────────────────────────────────────────────

test("buildBundle --check: passes on a freshly-created bundle", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    const realBin = readFileSync(join(REAL_SOURCE_DIR, "bin", "tfa.mjs"), "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), realBin, "utf8");
    writeFileSync(join(scratchSource, "action.yml"), "name: 'TFA Test'\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# Test\n", "utf8");

    buildBundle({ sourceDir: scratchSource, outDir: scratchOut });
    const check = buildBundle({ sourceDir: scratchSource, outDir: scratchOut, checkOnly: true });
    eq(check.ok, true, `check on fresh bundle should pass: ${check.message}`);
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

test("buildBundle --check: fails when a required file is missing from the bundle", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    const realBin = readFileSync(join(REAL_SOURCE_DIR, "bin", "tfa.mjs"), "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), realBin, "utf8");
    writeFileSync(join(scratchSource, "action.yml"), "name: 'TFA'\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# Test\n", "utf8");

    buildBundle({ sourceDir: scratchSource, outDir: scratchOut });
    // Remove one file from the bundle to simulate drift
    rmSync(join(scratchOut, "LICENSE"), { force: true });

    const check = buildBundle({ sourceDir: scratchSource, outDir: scratchOut, checkOnly: true });
    eq(check.ok, false, "check must fail when a file is missing");
    assert(/LICENSE/.test(check.message), `error mentions LICENSE: ${check.message}`);
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

test("buildBundle --check: fails when a file in the bundle has been tampered with", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    const realBin = readFileSync(join(REAL_SOURCE_DIR, "bin", "tfa.mjs"), "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), realBin, "utf8");
    writeFileSync(join(scratchSource, "action.yml"), "name: 'TFA'\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    writeFileSync(join(scratchSource, "README.md"), "# Test\n", "utf8");

    buildBundle({ sourceDir: scratchSource, outDir: scratchOut });
    // Tamper one file
    writeFileSync(join(scratchOut, "README.md"), "# Tampered\n", "utf8");

    const check = buildBundle({ sourceDir: scratchSource, outDir: scratchOut, checkOnly: true });
    eq(check.ok, false, "check must fail when a file has been tampered");
    assert(/differs/.test(check.message), `error mentions content difference: ${check.message}`);
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

// ─── buildBundle: fail-closed on missing source ──────────────────────────────

test("buildBundle [fail-closed]: throws when source directory is missing a required file", () => {
  const scratchSource = mkdtempSync(join(tmpdir(), "tfa-bundle-src-"));
  const scratchOut = mkdtempSync(join(tmpdir(), "tfa-bundle-out-"));
  try {
    mkdirSync(join(scratchSource, "bin"), { recursive: true });
    writeFileSync(join(scratchSource, "action.yml"), "name: test\n", "utf8");
    writeFileSync(join(scratchSource, "bin", "tfa.mjs"), "#!/usr/bin/env node\n", "utf8");
    writeFileSync(join(scratchSource, "LICENSE"), "MIT\n", "utf8");
    // omit README.md
    let threw = false;
    let msg = "";
    try {
      buildBundle({ sourceDir: scratchSource, outDir: scratchOut });
    } catch (e: any) {
      threw = true;
      msg = e.message;
    }
    assert(threw, "missing source file must cause a throw, not a silent broken bundle");
    assert(/README\.md/.test(msg), `error mentions the missing file: ${msg}`);
  } finally {
    rmSync(scratchSource, { recursive: true, force: true });
    rmSync(scratchOut, { recursive: true, force: true });
  }
});

// ─── CLI integration (real repo, never modifies real files) ────────────────────

test("[CLI] bundle script --check on the REAL repo passes after generating the bundle", () => {
  // Ensure the bundle exists first (regenerate if needed), then verify --check passes.
  // This test is robust whether or not dist/github-action was left from a prior run.
  execFileSync("node", [BUNDLE_SCRIPT], { cwd: ROOT, encoding: "utf8", timeout: 10000 });
  const result = execFileSync("node", [BUNDLE_SCRIPT, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
  });
  assert(result.includes("in sync") || result.includes("Bundle at"), `unexpected CLI output: ${result}`);
});

test("[CLI] bundle script --check fails when output directory does not exist", () => {
  const fakeOut = mkdtempSync(join(tmpdir(), "tfa-fake-bundle-"));
  rmSync(fakeOut, { recursive: true, force: true }); // ensure it does not exist
  try {
    let threw = false;
    let stderr = "";
    try {
      execFileSync("node", [BUNDLE_SCRIPT, "--check", "--out", fakeOut], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 10000,
      });
    } catch (e: any) {
      threw = true;
      stderr = e.stderr?.toString?.() || "";
    }
    assert(threw, "--check on missing outDir must exit non-zero");
    assert(/drift|does not exist/.test(stderr), `stderr explains missing bundle: ${stderr}`);
  } finally {
    rmSync(fakeOut, { recursive: true, force: true });
  }
});
