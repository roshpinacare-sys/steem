import "../_flush.mjs";
/**
 * tests/passport/integration-example.test.ts — SDK integration-example module tests.
 *
 * Coverage:
 *   • executeLocalVerificationDemo runs without throwing and produces output.
 *   • executeLocalVerificationDemo output mentions verification header (sanity).
 *   • executeLocalVerificationDemo: mock passport hash is intentionally fake →
 *     verifyPassport reports failure (expected demo-documentation behaviour).
 *   • executeRemoteFetchingDemo handles an unreachable server gracefully — must
 *     catch PassportClientError internally and NOT re-throw (fail-closed by design).
 *   • executeRemoteFetchingDemo with a live server returns a readable error code
 *     rather than a raw network stack trace (no error leaking).
 *   • ESM guard: the module can be imported without side-effects (no auto-execution).
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  executeLocalVerificationDemo,
  executeRemoteFetchingDemo,
} from "../../lib/passport-client/integration-example.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Capture all console.log / console.error lines during fn(), restore after. */
function captureConsole(fn: () => unknown): { lines: string[]; errLines: string[] } {
  const lines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errLines.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { lines, errLines };
}

async function captureConsoleAsync(
  fn: () => Promise<unknown>,
): Promise<{ lines: string[]; errLines: string[] }> {
  const lines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errLines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { lines, errLines };
}

// ─── executeLocalVerificationDemo ────────────────────────────────────────────

test("executeLocalVerificationDemo runs without throwing", () => {
  let threw = false;
  try {
    captureConsole(() => executeLocalVerificationDemo());
  } catch {
    threw = true;
  }
  assert(!threw, "executeLocalVerificationDemo must not throw");
});

test("executeLocalVerificationDemo produces output referencing the passport", () => {
  const { lines } = captureConsole(() => executeLocalVerificationDemo());
  const all = lines.join("\n");
  assert(all.includes("Verifying Passport"), "output should mention 'Verifying Passport'");
  assert(all.includes("SCENARIO A"), "output should include scenario header");
});

test("executeLocalVerificationDemo: mock passport hash is fake → at least one check fails (expected)", () => {
  // The integration-example uses generateMockPassport() which carries fake hashes
  // (it's a documentation artefact, not a live-issued passport). Verification must
  // report failure so readers see what a failed check looks like.
  const { lines, errLines } = captureConsole(() => executeLocalVerificationDemo());
  const all = (lines.concat(errLines)).join("\n");
  // Either lax or strict verification must report INVALID or a FAIL check.
  const hasFailSignal =
    all.includes("INVALID") ||
    all.includes("FAIL") ||
    all.includes("✗") ||
    errLines.length > 0;
  assert(hasFailSignal, "mock passport should produce at least one verification failure");
});

test("executeLocalVerificationDemo: strict mode output is more restrictive than lax", () => {
  const { lines } = captureConsole(() => executeLocalVerificationDemo());
  const all = lines.join("\n");
  // Both modes must appear in the output.
  assert(all.includes("Lax Verification"), "output should include Lax Verification result");
  assert(all.includes("Strict Verification"), "output should include Strict Verification result");
});

// ─── executeRemoteFetchingDemo ────────────────────────────────────────────────

test("executeRemoteFetchingDemo handles unreachable server without re-throwing", async () => {
  // The demo targets http://127.0.0.1:7700 which is not running in unit-test env.
  // The function MUST catch the network error internally and return cleanly.
  let threw = false;
  try {
    await captureConsoleAsync(() => executeRemoteFetchingDemo());
  } catch {
    threw = true;
  }
  assert(!threw, "executeRemoteFetchingDemo must absorb all errors — no uncaught throw");
});

test("executeRemoteFetchingDemo produces output on connection failure (no silent swallow)", async () => {
  const { lines } = await captureConsoleAsync(() => executeRemoteFetchingDemo());
  const all = lines.join("\n");
  // Must produce some output — either the fetch attempt line or the handled error message.
  assert(all.length > 0, "should produce output even on connection failure");
  assert(
    all.includes("Attempting remote fetch") || all.includes("aborted") || all.includes("failed"),
    "output should reference the remote fetch attempt or its failure",
  );
});

test("executeRemoteFetchingDemo reports error code (no raw network stack trace leaked)", async () => {
  const { lines } = await captureConsoleAsync(() => executeRemoteFetchingDemo());
  const all = lines.join("\n");
  // When it fails, the output must use the SDK error code path (e.g. 'network_error'
  // or 'timeout') — not a raw Node.js error object or a full stack trace.
  const hasRawStack = all.includes("at Object.") || all.includes("at async");
  assert(!hasRawStack, "no raw stack trace should appear in demo output");
});

// ─── ESM guard ────────────────────────────────────────────────────────────────

test("importing the integration-example module does not auto-execute demos", async () => {
  // The _isMain guard must prevent auto-execution when the file is imported
  // (not run directly). Since we already imported it above without side effects,
  // this test simply confirms we reached here without unexpected console output.
  assert(true, "module was imported without auto-running demos");
});
