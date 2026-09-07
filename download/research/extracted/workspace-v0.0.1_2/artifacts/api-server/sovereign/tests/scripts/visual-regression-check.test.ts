/**
 * tests/scripts/visual-regression-check.test.ts
 *
 * Tests for scripts/visual-regression-check.ts — the CLI wrapper around
 * frontend/visual-regression/harness.ts (runVisualRegression/updateAllSnapshots).
 * Before this script existed, those functions were only reachable from test
 * code; this gives CI/ops a single command for check-vs-update.
 *
 * HAPPY       (4): script exists and is invocable; default run against the
 *                  real committed goldens is clean (exit 0); --update on an
 *                  empty scratch dir followed by a plain re-check round-trips
 *                  clean (exit 0 both times); --update output explicitly
 *                  reports "updated" so it's never confused with a plain check.
 * EDGE        (3): empty/missing snapshot dir reports every case as `added`
 *                  and exits 1 (fail-closed, matches harness semantics);
 *                  a single changed case after --update on one group only
 *                  is still caught by a subsequent default run; running
 *                  --update twice in a row is idempotent (second run is a no-op
 *                  diff against what the first run just wrote).
 * FAIL-CLOSED (3): a corrupt (non-JSON) snapshot file in --dir causes the
 *                  script to exit non-zero rather than silently passing;
 *                  --dir with no path argument errors instead of silently
 *                  using the real snapshot dir; default (real goldens) run
 *                  never mutates the committed snapshot files (read-only
 *                  unless --update is passed).
 *
 * All I/O against scratch snapshots runs in a temp dir (mkdtempSync) — the
 * real committed __snapshots__ files are never touched by this test file.
 */

import { test, assert, eq } from "../_harness.mjs";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dir, "../..");
const SCRIPT = join(ROOT, "scripts/visual-regression-check.ts");

function runScript(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const out = execSync(`node ${JSON.stringify(SCRIPT)} ${args.join(" ")}`, {
      encoding: "utf8",
      timeout: 30_000,
      cwd: ROOT,
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (e: any) {
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ── Happy path ──────────────────────────────────────────────────────────────

test("visual-regression-check.ts exists", () => {
  assert(existsSync(SCRIPT), `script not found at ${SCRIPT}`);
});

test("default run against real committed goldens is clean (exit 0)", () => {
  const r = runScript([]);
  eq(r.status, 0);
  assert(r.stdout.includes("All groups clean."), "expected clean output");
  assert(!r.stdout.includes("added"), "real goldens should have no added cases");
});

test("--update on empty scratch dir then plain re-check both exit 0 (round-trip)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-vrc-cli-test-"));
  try {
    const update = runScript(["--update", "--dir", scratch]);
    eq(update.status, 0);
    assert(update.stdout.includes("Snapshots updated and verified clean."), "expected update confirmation");

    const recheck = runScript(["--dir", scratch]);
    eq(recheck.status, 0);
    assert(recheck.stdout.includes("All groups clean."), "expected clean re-check after update");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("--update output is distinguishable from a plain check (explicit confirmation text)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-vrc-cli-test-"));
  try {
    const update = runScript(["--update", "--dir", scratch]);
    assert(update.stdout.includes("updating golden snapshots"), "expected update-mode banner");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("empty/missing snapshot dir reports every case as `added` and exits 1", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-vrc-cli-test-"));
  try {
    const r = runScript(["--dir", scratch]);
    eq(r.status, 1);
    assert(r.stdout.includes("added"), "expected added cases for missing snapshots");
    assert(r.stdout.includes("button"), "expected all four groups reported");
    assert(r.stdout.includes("input") && r.stdout.includes("table") && r.stdout.includes("card"), "expected all four groups");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a hand-edited snapshot is caught as `changed` on the next default run", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-vrc-cli-test-"));
  try {
    runScript(["--update", "--dir", scratch]);
    const buttonSnap = join(scratch, "button.snap.json");
    const raw = JSON.parse(readFileSync(buttonSnap, "utf8"));
    const firstKey = Object.keys(raw.entries)[0];
    raw.entries[firstKey].html = "<button>tampered</button>";
    raw.entries[firstKey].hash = "0".repeat(64); // wrong hash too — still must be caught by string compare path being bypassed; html itself differs from live render
    writeFileSync(buttonSnap, JSON.stringify(raw, null, 2));

    const r = runScript(["--dir", scratch]);
    eq(r.status, 1);
    assert(r.stdout.includes("changed"), "expected the tampered case to be reported changed");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("running --update twice in a row is idempotent (second run still clean)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-vrc-cli-test-"));
  try {
    const first = runScript(["--update", "--dir", scratch]);
    eq(first.status, 0);
    const second = runScript(["--update", "--dir", scratch]);
    eq(second.status, 0);
    assert(second.stdout.includes("Snapshots updated and verified clean."), "second update should also verify clean");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ── Fail-closed ───────────────────────────────────────────────────────────────

test("corrupt (non-JSON) snapshot file causes non-zero exit, not a silent pass", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tfa-vrc-cli-test-"));
  try {
    writeFileSync(join(scratch, "button.snap.json"), "{ not valid json", "utf8");
    const r = runScript(["--dir", scratch]);
    assert(r.status !== 0, "corrupt snapshot must not exit 0");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("--dir with no path argument errors rather than silently using the real dir", () => {
  const r = runScript(["--dir"]);
  assert(r.status !== 0, "missing --dir argument must not succeed silently");
});

test("default (real goldens) run never mutates the committed snapshot files", () => {
  const buttonSnap = join(ROOT, "frontend/visual-regression/__snapshots__/button.snap.json");
  const before = readFileSync(buttonSnap, "utf8");
  runScript([]);
  const after = readFileSync(buttonSnap, "utf8");
  eq(before, after);
});
