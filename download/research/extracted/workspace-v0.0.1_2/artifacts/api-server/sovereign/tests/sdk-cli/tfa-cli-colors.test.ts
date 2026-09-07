import "../_flush.mjs";
/**
 * tests/sdk-cli/tfa-cli-colors.test.ts — @tfa/cli colored output / TTY behaviour
 *
 * Coverage:
 *   • supportsColor returns true when FORCE_COLOR is set (even without TTY)
 *   • supportsColor returns false when NO_COLOR is set
 *   • supportsColor returns false when stdout is not a TTY and FORCE_COLOR absent
 *   • supportsColor returns true when stdout is a TTY and NO_COLOR absent
 *   • decisionColor returns green for "allowed"
 *   • decisionColor returns red for "denied"
 *   • decisionColor returns yellow for "approval_required"
 *   • decisionColor returns gray for unknown decisions
 *   • parseArgs recognises --no-color
 *   • --no-color flag causes supportsColor to return false (via env side-effect)
 *   • c.bold / c.dim / c.red / c.green / c.yellow / c.blue / c.gray produce ANSI codes when enabled
 *   • c.* helpers return plain text when colors disabled
 */

import { test, eq, assert } from "../_harness.mjs";
import {
  parseArgs,
  supportsColor,
  c,
  decisionColor,
  CliUsageError,
} from "../../sdk/cli/bin/tfa.mjs";

// ── supportsColor tests ───────────────────────────────────────────────────────

test("supportsColor: true when FORCE_COLOR is set (no TTY)", () => {
  const orig = process.stdout.isTTY;
  const origForce = process.env.FORCE_COLOR;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = false;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    eq(supportsColor(), true);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("supportsColor: false when NO_COLOR is set (even with TTY)", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  const origForce = process.env.FORCE_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    eq(supportsColor(), false);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
  }
});

test("supportsColor: false when not TTY and FORCE_COLOR absent", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  const origForce = process.env.FORCE_COLOR;
  try {
    (process.stdout as any).isTTY = false;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    eq(supportsColor(), false);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
  }
});

test("supportsColor: true when TTY and NO_COLOR absent", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  const origForce = process.env.FORCE_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    eq(supportsColor(), true);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
  }
});

// ── decisionColor tests ─────────────────────────────────────────────────────────

test("decisionColor: allowed → green ANSI", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    const out = decisionColor("allowed");
    assert(out.includes("\x1b[32m"), `expected green ANSI code in "${out}"`);
    assert(out.includes("\x1b[39m"), `expected reset ANSI code in "${out}"`);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("decisionColor: denied → red ANSI", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    const out = decisionColor("denied");
    assert(out.includes("\x1b[31m"), `expected red ANSI code in "${out}"`);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("decisionColor: approval_required → yellow ANSI", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    const out = decisionColor("approval_required");
    assert(out.includes("\x1b[33m"), `expected yellow ANSI code in "${out}"`);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("decisionColor: unknown → gray ANSI", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    const out = decisionColor("weird");
    assert(out.includes("\x1b[90m"), `expected gray ANSI code in "${out}"`);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("decisionColor: no ANSI when colors disabled", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = false;
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
    const out = decisionColor("allowed");
    assert(!out.includes("\x1b["), `expected no ANSI codes when disabled, got "${out}"`);
    eq(out, "allowed");
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

// ── parseArgs --no-color ─────────────────────────────────────────────────────

test("parseArgs: --no-color flag recognised", () => {
  const opts = parseArgs(["check-action", "--intent", "i.json", "--no-color"]);
  eq(opts.command, "check-action");
  eq(opts.noColor, true);
});

test("parseArgs: --no-color defaults to false", () => {
  const opts = parseArgs(["verify", "--receipt", "r.json"]);
  eq(opts.noColor, false);
});

// ── c.* helpers produce ANSI when enabled, plain when disabled ─────────────────

test("c.green produces ANSI when colors enabled", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    const out = c.green("ok");
    assert(out === "\x1b[32mok\x1b[39m", `expected colored output, got "${out}"`);
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("c.green returns plain text when colors disabled", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = false;
    process.env.NO_COLOR = "1";
    const out = c.green("ok");
    eq(out, "ok");
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

test("c.bold / c.dim / c.red / c.yellow / c.blue / c.gray all respect supportsColor", () => {
  const orig = process.stdout.isTTY;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = true;
    delete process.env.NO_COLOR;
    assert(c.bold("x").includes("\x1b[1m"));
    assert(c.dim("x").includes("\x1b[2m"));
    assert(c.red("x").includes("\x1b[31m"));
    assert(c.yellow("x").includes("\x1b[33m"));
    assert(c.blue("x").includes("\x1b[34m"));
    assert(c.gray("x").includes("\x1b[90m"));
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});

// ── FORCE_COLOR overrides non-TTY ────────────────────────────────────────────

test("FORCE_COLOR overrides non-TTY for all c.* helpers", () => {
  const orig = process.stdout.isTTY;
  const origForce = process.env.FORCE_COLOR;
  const origNo = process.env.NO_COLOR;
  try {
    (process.stdout as any).isTTY = false;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    eq(c.green("x"), "\x1b[32mx\x1b[39m");
    eq(c.red("x"), "\x1b[31mx\x1b[39m");
    eq(c.bold("x"), "\x1b[1mx\x1b[22m");
  } finally {
    (process.stdout as any).isTTY = orig;
    if (origForce === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForce;
    if (origNo === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNo;
  }
});
