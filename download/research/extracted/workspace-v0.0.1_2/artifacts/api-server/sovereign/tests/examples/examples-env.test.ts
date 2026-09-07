import "../_flush.mjs";
/**
 * tests/examples/examples-env.test.ts — Example scripts run correctly in production env.
 *
 * Coverage:
 *   • buildSovereignStack throws in production without provider/pool (fail-closed).
 *   • buildSovereignStack works in production with explicit InMemoryLedger provider.
 *   • full-economy-demo.mjs runs to completion with NODE_ENV=production.
 *   • third-party-verify.mjs runs to completion with NODE_ENV=production.
 *   • Server startSovereignServer works in production when stack is pre-built with provider.
 */

import { test, assert, eq } from "../_harness.mjs";
import { spawnSync } from "node:child_process";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

const DEMO = "examples/full-economy-demo.mjs";
const QUICKSTART = "examples/quickstart.mjs";
const VERIFY = "examples/third-party-verify.mjs";

function run(script: string, env?: Record<string, string>): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [script], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("buildSovereignStack: production without pool/provider throws fail-closed", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let threw = false;
  try {
    buildSovereignStack();
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("DbPool is required"), "expected DbPool error, got: " + e.message);
  } finally {
    process.env.NODE_ENV = prev;
  }
  assert(threw, "expected buildSovereignStack to throw in production without pool");
});

test("buildSovereignStack: production with explicit provider succeeds", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let stack: any;
  try {
    stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  } finally {
    process.env.NODE_ENV = prev;
  }
  assert(stack && stack.ledger, "stack should be built with explicit provider in production");
});

test("full-economy-demo.mjs runs with NODE_ENV=production", () => {
  const r = run(DEMO, { NODE_ENV: "production" });
  eq(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  assert(r.stdout.includes("✅ Full economy demo complete."), "demo should print completion marker");
});

test("quickstart.mjs runs with NODE_ENV=production", () => {
  const r = run(QUICKSTART, { NODE_ENV: "production" });
  eq(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  assert(r.stdout.includes("✅ Quickstart complete"), "quickstart should print completion marker");
  assert(r.stdout.includes("trust rose: 50 →"), "quickstart should show track record rising");
});

test("third-party-verify.mjs runs with NODE_ENV=production", () => {
  const r = run(VERIFY, { NODE_ENV: "production" });
  eq(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  assert(r.stdout.includes("✅ Zero-trust verification demo complete."), "verify should print completion marker");
});

test("third-party-verify.mjs: cross-tenant tamper detection works in production", () => {
  const r = run(VERIFY, { NODE_ENV: "production" });
  eq(r.code, 0, `expected exit 0, got ${r.code}`);
  assert(r.stdout.includes("tampered passport detected"), "should detect tampered passport");
  assert(r.stdout.includes("cross-tenant lookup → not_found"), "should fail closed on cross-tenant lookup");
});
