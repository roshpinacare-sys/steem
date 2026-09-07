import "../_flush.mjs";
/**
 * tests/passport/verify-passport-cli.test.ts — standalone verifier CLI mode.
 *
 * Coverage:
 *   • happy path: node scripts/verify-passport.mjs <file> --hmac-secret <s> → exit 0, "Result: OK".
 *   • wrong HMAC secret → exit 1, "Result: FAILED", signature check fails.
 *   • tampered passport body file → exit 1, hash check fails.
 *   • missing file → exit 2, error message on stderr.
 *   • --json mode emits machine-readable report with ok:true.
 *   • --strict with missing keys → exit 1, ok:false in JSON.
 *   • --help → exit 0.
 */

import { test, assert, eq } from "../_harness.mjs";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issuePassport } from "../../lib/passport/index.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

const SECRET = "cli-verify-passport-secret-32bytes!!!";
const SCRIPT = "scripts/verify-passport.mjs";

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "passport-cli-"));
}

function teardown() {
  // no-op; files overwritten per test
}

function makePassportFile(tamper?: (p: any) => void): string {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = store.append({
    id: "audit-cli-" + Math.random().toString(36).slice(2),
    tenantId: "cli-tenant",
    actionId: "act-1",
    actionType: "test.action",
    source: "test-agent",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });
  if (tamper) tamper(passport);
  const p = join(tmpDir, `passport-${Date.now()}.json`);
  writeFileSync(p, JSON.stringify(passport, null, 2));
  return p;
}

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT, ...args], { cwd: process.cwd(), encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("CLI happy path: valid passport + correct secret → exit 0, Result: OK", () => {
  setup();
  const file = makePassportFile();
  const r = run([file, "--hmac-secret", SECRET]);
  eq(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  assert(r.stdout.includes("Result: OK"), "stdout should contain 'Result: OK'");
  assert(r.stdout.includes("✓ passport.signature.hmac"), "signature check should pass");
  teardown();
});

test("CLI wrong HMAC secret → exit 1, Result: FAILED", () => {
  setup();
  const file = makePassportFile();
  const r = run([file, "--hmac-secret", "wrong-secret-xxxxxxxxxxxxxxxxxx"]);
  eq(r.code, 1, `expected exit 1, got ${r.code}`);
  assert(r.stdout.includes("Result: FAILED"), "stdout should contain 'Result: FAILED'");
  assert(r.stdout.includes("✗ passport.signature.hmac"), "signature check should fail");
  teardown();
});

test("CLI tampered passport body → exit 1, hash check fails", () => {
  setup();
  const file = makePassportFile((p) => { p.tenantId = "tampered-tenant"; });
  const r = run([file, "--hmac-secret", SECRET]);
  eq(r.code, 1, `expected exit 1, got ${r.code}`);
  assert(r.stdout.includes("Result: FAILED"), "stdout should contain 'Result: FAILED'");
  assert(r.stdout.includes("✗ passport.hash"), "hash check should fail");
  teardown();
});

test("CLI missing file → exit 2, error on stderr", () => {
  setup();
  const r = run(["/tmp/non-existent-passport-file-12345.json"]);
  eq(r.code, 2, `expected exit 2, got ${r.code}`);
  assert(r.stderr.includes("cannot read passport"), "stderr should mention cannot read passport");
  teardown();
});

test("CLI --json mode emits machine-readable report with ok:true", () => {
  setup();
  const file = makePassportFile();
  const r = run([file, "--hmac-secret", SECRET, "--json"]);
  eq(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  const report = JSON.parse(r.stdout);
  eq(report.ok, true, "JSON report ok should be true");
  assert(Array.isArray(report.checks), "JSON report checks should be an array");
  const sigCheck = report.checks.find((c: any) => c.name === "passport.signature.hmac");
  assert(sigCheck && sigCheck.status === "pass", "JSON report signature check should pass");
  teardown();
});

test("CLI --strict with missing keys → exit 1, ok:false in JSON", () => {
  setup();
  const file = makePassportFile();
  const r = run([file, "--strict", "--json"]);
  eq(r.code, 1, `expected exit 1 for strict mode with no keys, got ${r.code}`);
  const report = JSON.parse(r.stdout);
  eq(report.ok, false, "JSON report ok should be false in strict mode with missing keys");
  teardown();
});

test("CLI --help → exit 0", () => {
  setup();
  const r = run(["--help"]);
  eq(r.code, 0, `expected exit 0 for --help, got ${r.code}`);
  assert(r.stderr.includes("Usage:"), "stderr should contain usage info");
  teardown();
});
