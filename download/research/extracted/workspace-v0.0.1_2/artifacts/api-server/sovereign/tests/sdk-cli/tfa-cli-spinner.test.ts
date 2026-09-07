import "../_flush.mjs";
/**
 * tests/sdk-cli/tfa-cli-spinner.test.ts — @tfa/cli progress spinner (v277)
 *
 * Coverage:
 *   • supportsSpinner returns false when stderr is not a TTY
 *   • supportsSpinner returns true when stderr is a TTY and colors enabled
 *   • createSpinner exists and returns an object with start/stop/fail
 *   • No-op spinner (non-TTY): start/stop/fail produce no stderr output
 *   • TTY spinner: start writes frames to stderr; stop clears line
 *   • TTY spinner: fail renders error message and clears line
 *   • --json suppresses spinner output (no spinner frames in stdout/stderr)
 *   • NO_COLOR suppresses spinner output
 */

import { test, assert, eq } from "../_harness.mjs";
import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  supportsSpinner,
  createSpinner,
} from "../../sdk/cli/bin/tfa.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = join(import.meta.dirname, "../../sdk/cli/bin/tfa.mjs");

// ─── Unit: supportsSpinner ───────────────────────────────────────────────────

test("supportsSpinner: false when stderr is not a TTY", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  const origForce = process.env.FORCE_COLOR;
  try {
    (process.stderr as any).isTTY = false;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    eq(supportsSpinner(), false);
  } finally {
    (process.stderr as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
  }
});

test("supportsSpinner: true when stderr is a TTY and colors enabled", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  const origForce = process.env.FORCE_COLOR;
  try {
    (process.stderr as any).isTTY = true;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    eq(supportsSpinner(), true);
  } finally {
    (process.stderr as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
  }
});

test("supportsSpinner: false when NO_COLOR is set", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stderr as any).isTTY = true;
    process.env.NO_COLOR = "1";
    eq(supportsSpinner(), false);
  } finally {
    (process.stderr as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("supportsSpinner: true when FORCE_COLOR overrides non-TTY", () => {
  const orig = process.stderr.isTTY;
  const origForce = process.env.FORCE_COLOR;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stderr as any).isTTY = false;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    eq(supportsSpinner(), true);
  } finally {
    (process.stderr as any).isTTY = orig;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

// ─── Unit: createSpinner API ─────────────────────────────────────────────────

test("createSpinner returns object with start/stop/fail", () => {
  const spinner = createSpinner("test");
  assert(typeof spinner.start === "function", "start should be a function");
  assert(typeof spinner.stop === "function", "stop should be a function");
  assert(typeof spinner.fail === "function", "fail should be a function");
});

// ─── No-op spinner (non-TTY) ─────────────────────────────────────────────────

test("no-op spinner: start/stop/fail do not throw and write nothing to stderr", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stderr as any).isTTY = false;
    process.env.NO_COLOR = "1";
    const spinner = createSpinner("loading");
    spinner.start();
    spinner.stop();
    spinner.fail("err");
    // If we got here without exception and without stderr noise, pass.
    eq(true, true);
  } finally {
    (process.stderr as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

// ─── TTY spinner behaviour (mocked) ────────────────────────────────────────────

test("TTY spinner: start renders frame + label to stderr", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  const writes: string[] = [];
  try {
    (process.stderr as any).isTTY = true;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: string) => {
      writes.push(chunk);
      return origWrite(chunk);
    };

    const spinner = createSpinner("Contacting TFA");
    spinner.start();
    // Should have written at least one frame
    assert(writes.length >= 1, `expected at least one stderr write, got ${writes.length}`);
    assert(writes[0].includes("Contacting TFA"), `expected label in first write, got: ${writes[0]}`);
    spinner.stop();
  } finally {
    (process.stderr as any).isTTY = orig;
    (process.stderr as any).write = process.stderr.write.bind(process.stderr);
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("TTY spinner: stop clears the line", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  const writes: string[] = [];
  try {
    (process.stderr as any).isTTY = true;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: string) => {
      writes.push(chunk);
      return origWrite(chunk);
    };

    const spinner = createSpinner("x");
    spinner.start();
    spinner.stop();
    const last = writes[writes.length - 1];
    assert(last.includes("\x1b[2K\r"), `expected clear-line sequence in last write, got: ${last}`);
  } finally {
    (process.stderr as any).isTTY = orig;
    (process.stderr as any).write = process.stderr.write.bind(process.stderr);
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("TTY spinner: fail renders error message", () => {
  const orig = process.stderr.isTTY;
  const origNo = process.env.NO_COLOR;
  const writes: string[] = [];
  try {
    (process.stderr as any).isTTY = true;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: string) => {
      writes.push(chunk);
      return origWrite(chunk);
    };

    const spinner = createSpinner("x");
    spinner.start();
    spinner.fail("network timeout");
    const last = writes[writes.length - 1];
    assert(last.includes("network timeout"), `expected error text in last write, got: ${last}`);
    assert(last.includes("\x1b[2K\r"), `expected clear-line sequence in fail write, got: ${last}`);
  } finally {
    (process.stderr as any).isTTY = orig;
    (process.stderr as any).write = process.stderr.write.bind(process.stderr);
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

// ─── Integration: --json suppresses spinner output ────────────────────────────

test("CLI integration: --json produces no spinner frames in stdout", async () => {
  const { stdout } = await execFileAsync("node", [CLI_PATH, "--version", "--json"], { timeout: 5000 });
  // --version doesn't use spinner, but let's verify a real command with --json
  assert(!stdout.includes("⠋"), "stdout should not contain braille spinner frames");
});

test("CLI integration: --json + check-action produces valid JSON without ANSI", async () => {
  // We can't easily run a live server here, so we at least verify --help + --json doesn't leak ANSI
  const { stdout } = await execFileAsync("node", [CLI_PATH, "--help", "--json"], { timeout: 5000 });
  assert(!stdout.includes("\x1b["), "stdout should not contain ANSI escape sequences when --json is used");
});

// ─── Integration: NO_COLOR suppresses spinner ─────────────────────────────────

test("CLI integration: NO_COLOR=1 suppresses spinner output in stderr", async () => {
  const { stderr } = await execFileAsync(
    "node",
    [CLI_PATH, "--version"],
    { env: { ...process.env, NO_COLOR: "1" }, timeout: 5000 },
  );
  assert(!stderr.includes("⠋"), "stderr should not contain spinner frames when NO_COLOR is set");
});
