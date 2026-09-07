import "../_flush.mjs";
/**
 * tests/sdk-cli/github-action-bin-sync.test.ts — v257
 *
 * Closes MANIFEST debt (v253-v256, "החסר הבא" #2/#3): "bin/tfa.mjs ב-github-action
 * הוא עותק סטטי של sdk/cli/bin/tfa.mjs; דרוש CI sync script או bundler שמונע drift".
 *
 * scripts/sync-github-action-bin.mjs makes sdk/cli/bin/tfa.mjs the single source
 * of truth and sdk/github-action/bin/tfa.mjs a generated, banner-marked copy.
 * This closes a real gap the PREVIOUS safety net missed: the existing governance
 * test (tfa-github-action-governance.test.ts) only compared the VERSION *string*
 * between the two files — it would NOT catch someone editing one file's actual
 * command logic without touching the other (as long as they forgot to bump, or
 * correctly bumped, VERSION in both). This suite checks full content equality
 * (modulo the generated-file banner), which catches that case.
 *
 * Coverage:
 *   buildDerivedContent (pure function, unit-level)
 *     • shebang from the source is preserved as line 1 of the output
 *     • the generated-file banner appears after the shebang, before the rest
 *     • the full body of the source (everything after the shebang) is preserved
 *       byte-for-byte in the output (no silent transformation/mangling)
 *     • fail-closed: a source without a shebang line throws, rather than
 *       silently producing a non-executable copy
 *
 *   --check mode (drift detection, what CI would run)
 *     • the CHECKED-IN repo state passes --check with exit 0 (this is the
 *       actual regression guard: if someone edits sdk/github-action/bin/tfa.mjs
 *       directly, or sdk/cli/bin/tfa.mjs without re-running the sync, this fails)
 *     • a tampered copy (one extra space inserted) is detected as drift (exit 1)
 *     • a missing target file is detected as drift (exit 1), not silently created
 *
 *   regeneration (round-trip, on a scratch copy — never touches the real repo files)
 *     • running the generator then --check on the SAME scratch target succeeds
 *     • the regenerated file is executable (chmod 0o755) and actually runs
 *       (`--version` succeeds) — proves the banner doesn't break the shebang
 *     • regenerating is idempotent: running it twice produces byte-identical output
 *
 *   fail-closed
 *     • missing source file → process exits 1 with a clear stderr message
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test, assert, eq } from "../_harness.mjs";
import { buildDerivedContent } from "../../scripts/sync-github-action-bin.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const SYNC_SCRIPT = join(ROOT, "scripts/sync-github-action-bin.mjs");
const REAL_SOURCE = join(ROOT, "sdk/cli/bin/tfa.mjs");
const REAL_TARGET = join(ROOT, "sdk/github-action/bin/tfa.mjs");

function runCheck(scriptPath: string = SYNC_SCRIPT, cwd: string = ROOT): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [scriptPath, "--check"], { cwd, encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

// ─── buildDerivedContent (pure function) ─────────────────────────────────────

test("buildDerivedContent: preserves the shebang as line 1 of the output", () => {
  const src = "#!/usr/bin/env node\nconsole.log('hi');\n";
  const out = buildDerivedContent(src);
  eq(out.split("\n")[0], "#!/usr/bin/env node");
});

test("buildDerivedContent: inserts the generated-file banner after the shebang", () => {
  const src = "#!/usr/bin/env node\nconsole.log('hi');\n";
  const out = buildDerivedContent(src);
  assert(out.includes("GENERATED FILE — DO NOT EDIT DIRECTLY"), "banner is present");
  // banner must come AFTER the shebang line, not before it
  const shebangIdx = out.indexOf("#!/usr/bin/env node");
  const bannerIdx = out.indexOf("GENERATED FILE");
  assert(shebangIdx === 0 && bannerIdx > shebangIdx, "shebang precedes banner");
});

test("buildDerivedContent: preserves the full body byte-for-byte after the shebang", () => {
  const body = "const x = 1;\nfunction f() { return 'no mangling here — \\u00e9\\u00e8 unicode too'; }\n";
  const src = "#!/usr/bin/env node\n" + body;
  const out = buildDerivedContent(src);
  assert(out.endsWith(body), "body is preserved verbatim, unmodified, at the end of the output");
});

test("buildDerivedContent [fail-closed]: a source without a shebang line throws", () => {
  let threw = false;
  try {
    buildDerivedContent("console.log('no shebang');\n");
  } catch (e: any) {
    threw = true;
    assert(/shebang/.test(e.message), `error message mentions shebang: ${e.message}`);
  }
  assert(threw, "missing-shebang source must throw, not silently produce a broken copy");
});

// ─── --check mode against the REAL repo (the actual regression guard) ───────

test("[regression guard] the checked-in sdk/github-action/bin/tfa.mjs is in sync with sdk/cli/bin/tfa.mjs RIGHT NOW", () => {
  const result = runCheck();
  eq(result.code, 0, `sync check failed — the two binaries have drifted: ${result.stderr}`);
});

// NOTE: the tampered/missing tests use scratch copies instead of touching the real repo
// files, because concurrent test suites (e.g. tfa-github-action-governance.test.ts)
// read the real sdk/github-action/bin/tfa.mjs and a race window would cause flaky
// realFail failures under high-concurrency audit runs.

test("--check detects drift when the target has been tampered with (extra whitespace)", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "tfa-sync-test-"));
  try {
    const scratchScripts = join(scratchRoot, "scripts");
    const scratchCliBin = join(scratchRoot, "sdk/cli/bin");
    const scratchActionBin = join(scratchRoot, "sdk/github-action/bin");
    execFileSync("mkdir", ["-p", scratchScripts, scratchCliBin, scratchActionBin]);

    writeFileSync(join(scratchScripts, "sync-github-action-bin.mjs"), readFileSync(SYNC_SCRIPT, "utf8"), "utf8");
    const cliSource = readFileSync(REAL_SOURCE, "utf8");
    writeFileSync(join(scratchCliBin, "tfa.mjs"), cliSource, "utf8");
    writeFileSync(join(scratchActionBin, "tfa.mjs"), buildDerivedContent(cliSource) + " ", "utf8"); // tampered

    const result = runCheck(join(scratchScripts, "sync-github-action-bin.mjs"), scratchRoot);
    eq(result.code, 1, "tampered target must be detected as drift");
    assert(/DRIFT DETECTED/.test(result.stderr), `stderr mentions drift: ${result.stderr}`);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("--check detects drift when the target file is missing entirely", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "tfa-sync-test-"));
  try {
    const scratchScripts = join(scratchRoot, "scripts");
    const scratchCliBin = join(scratchRoot, "sdk/cli/bin");
    execFileSync("mkdir", ["-p", scratchScripts, scratchCliBin]);

    writeFileSync(join(scratchScripts, "sync-github-action-bin.mjs"), readFileSync(SYNC_SCRIPT, "utf8"), "utf8");
    const cliSource = readFileSync(REAL_SOURCE, "utf8");
    writeFileSync(join(scratchCliBin, "tfa.mjs"), cliSource, "utf8");
    // deliberately do NOT create sdk/github-action/bin/tfa.mjs

    const result = runCheck(join(scratchScripts, "sync-github-action-bin.mjs"), scratchRoot);
    eq(result.code, 1, "missing target must be detected as drift, not silently ignored");
    assert(/does not exist/.test(result.stderr), `stderr explains the file is missing: ${result.stderr}`);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ─── regeneration round-trip (scratch copy — never touches real repo files) ──

test("[scratch] generator + --check round-trip succeeds on a fresh copy of the repo layout", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "tfa-sync-test-"));
  try {
    const scratchScripts = join(scratchRoot, "scripts");
    const scratchCliBin = join(scratchRoot, "sdk/cli/bin");
    const scratchActionBin = join(scratchRoot, "sdk/github-action/bin");
    execFileSync("mkdir", ["-p", scratchScripts, scratchCliBin, scratchActionBin]);

    // Copy the real sync script + real CLI source into the scratch layout.
    writeFileSync(join(scratchScripts, "sync-github-action-bin.mjs"), readFileSync(SYNC_SCRIPT, "utf8"), "utf8");
    const cliSource = readFileSync(REAL_SOURCE, "utf8");
    writeFileSync(join(scratchCliBin, "tfa.mjs"), cliSource, "utf8");

    const scratchSyncScript = join(scratchScripts, "sync-github-action-bin.mjs");

    // First --check: target doesn't exist yet → drift (exit 1).
    const before = runCheck(scratchSyncScript, scratchRoot);
    eq(before.code, 1, "freshly-laid-out scratch repo has no target yet — drift expected");

    // Generate.
    execFileSync("node", [scratchSyncScript], { cwd: scratchRoot });
    assert(existsSync(join(scratchActionBin, "tfa.mjs")), "generator created the target file");

    // Second --check: now in sync.
    const after = runCheck(scratchSyncScript, scratchRoot);
    eq(after.code, 0, `generator output should immediately pass --check: ${after.stderr}`);

    // The regenerated file is executable and actually runs.
    const target = join(scratchActionBin, "tfa.mjs");
    const versionOutput = execFileSync("node", [target, "--version"], { encoding: "utf8" }).trim();
    assert(versionOutput.length > 0, "regenerated binary runs and prints a version");

    // Idempotency: regenerating again produces byte-identical output.
    const firstGen = readFileSync(target, "utf8");
    execFileSync("node", [scratchSyncScript], { cwd: scratchRoot });
    const secondGen = readFileSync(target, "utf8");
    eq(firstGen, secondGen, "regenerating twice from the same source is idempotent");
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ─── fail-closed: missing source ─────────────────────────────────────────────

test("[fail-closed] running the sync script with a missing canonical source exits 1 with a clear message", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "tfa-sync-missing-source-"));
  try {
    const scratchScripts = join(scratchRoot, "scripts");
    execFileSync("mkdir", ["-p", scratchScripts, join(scratchRoot, "sdk/cli/bin"), join(scratchRoot, "sdk/github-action/bin")]);
    writeFileSync(join(scratchScripts, "sync-github-action-bin.mjs"), readFileSync(SYNC_SCRIPT, "utf8"), "utf8");
    // Deliberately do NOT create sdk/cli/bin/tfa.mjs.
    let threw = false;
    try {
      execFileSync("node", [join(scratchScripts, "sync-github-action-bin.mjs")], { cwd: scratchRoot, encoding: "utf8" });
    } catch (e: any) {
      threw = true;
      eq(e.status, 1);
      assert(/canonical source not found/.test(e.stderr), `stderr explains the missing source: ${e.stderr}`);
    }
    assert(threw, "missing source must cause a non-zero exit, not a silent no-op");
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
