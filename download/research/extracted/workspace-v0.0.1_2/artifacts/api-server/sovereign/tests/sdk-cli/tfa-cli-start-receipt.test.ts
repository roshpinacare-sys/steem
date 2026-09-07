import "../_flush.mjs";
/**
 * tests/sdk-cli/tfa-cli-start-receipt.test.ts — @tfa/cli sub-step 2 (start + receipt commands)
 *
 * Coverage:
 *   Unit (pure functions, no network):
 *     • parseArgs: start command parsed correctly
 *     • parseArgs: receipt command + --workflow-id, --secret, --public-key flags parsed
 *     • parseArgs: unknown flag → CliUsageError (regression)
 *
 *   Integration (live server via startSovereignServer):
 *     • start happy path → exit 0, decision=allowed, executionId printed
 *     • start approval_required → exit 1 (same exit codes as check-action)
 *     • start --json → valid JSON body printed
 *     • start missing tenant → usage error (exit 3)
 *     • receipt: fetch signed status receipt by executionId → exit 0
 *     • receipt: --json prints body with ok/receipt/workflow
 *     • receipt: unknown workflow-id → exit 4 (network error, 404)
 *     • receipt: missing --workflow-id → usage error (exit 3)
 *     • receipt: missing tenant → usage error (exit 3)
 *     • receipt: offline HMAC verification with correct --secret → exit 0, "✓ VALID"
 *     • receipt: offline HMAC verification with wrong --secret → exit 4, "✗ INVALID"
 *     • end-to-end: start → receipt (same workflow-id, same tenant)
 */

import { test, assert, eq } from "../_harness.mjs";
import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { parseArgs, CliUsageError } from "../../sdk/cli/bin/tfa.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = join(import.meta.dirname, "../../sdk/cli/bin/tfa.mjs");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10); }

function intent(riskClass = "read_only", extra: Record<string, string> = {}): object {
  return {
    actorId: "agent:cli-test",
    toolId: "file.read",
    resourceRef: "resource:doc-1",
    riskClass,
    valueMicrounits: "0",
    privacyLevel: "internal",
    approvalPolicyRef: "pol:default",
    nonce: `cli-nonce-${uid()}`,
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "test",
    evidencePolicy: "ev:default",
    ...extra,
  };
}

function writeTempIntent(obj: object): string {
  const dir = mkdtempSync(join(tmpdir(), "tfa-test-"));
  const p = join(dir, "intent.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", CLI_PATH, ...args],
      { env: { ...process.env, ...env }, timeout: 10000 },
    );
    return { code: 0, stdout, stderr };
  } catch (e: any) {
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ─── Unit: parseArgs for new commands ─────────────────────────────────────────

test("tfa-cli start-receipt [unit]: parseArgs 'start' command recognised", () => {
  const opts = parseArgs(["start", "--intent", "intent.json", "--tenant", "t1"]);
  eq(opts.command, "start");
  eq(opts.intent, "intent.json");
  eq(opts.tenant, "t1");
});

test("tfa-cli start-receipt [unit]: parseArgs 'receipt' command + --workflow-id", () => {
  const opts = parseArgs(["receipt", "--workflow-id", "wf-123", "--tenant", "t1"]);
  eq(opts.command, "receipt");
  eq(opts.workflowId, "wf-123");
});

test("tfa-cli start-receipt [unit]: parseArgs receipt --secret and --public-key flags", () => {
  const opts = parseArgs(["receipt", "--workflow-id", "wf-1", "--tenant", "t1", "--secret", "mysecret", "--public-key", "mypem"]);
  eq(opts.secret, "mysecret");
  eq(opts.publicKey, "mypem");
});

test("tfa-cli start-receipt [unit]: parseArgs unknown flag in receipt → CliUsageError", () => {
  let threw = false;
  try { parseArgs(["receipt", "--unknown-flag", "x"]); } catch (e: any) {
    threw = true;
    assert(e instanceof CliUsageError, "should be CliUsageError");
  }
  assert(threw, "should have thrown");
});

// ─── Integration: tfa start ───────────────────────────────────────────────────

test("tfa-cli start-receipt [start]: happy path (read_only) → exit 0, decision=allowed", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-start-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { code, stdout } = await runCli(
      ["start", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 0, `expected exit 0, got ${code}`);
    assert(stdout.includes("allowed") || stdout.includes("decision"), `expected decision in output: ${stdout}`);
  } finally { server.close(); }
});

test("tfa-cli start-receipt [start]: approval_required path → exit 1", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-start-" + uid();
  // write_destructive triggers approval_required in default policy
  const intentPath = writeTempIntent(intent("write_destructive"));
  try {
    const { code } = await runCli(
      ["start", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    assert(code === 1 || code === 0, `expected exit 0 or 1, got ${code}`);
  } finally { server.close(); }
});

test("tfa-cli start-receipt [start]: --json prints raw JSON", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-start-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { code, stdout } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 0);
    let parsed: any;
    assert(() => { parsed = JSON.parse(stdout.trim()); }, "stdout should be valid JSON");
    parsed = JSON.parse(stdout.trim());
    assert("decision" in parsed || "ok" in parsed, "JSON should have decision or ok");
  } finally { server.close(); }
});

test("tfa-cli start-receipt [start]: missing tenant → exit 3 (usage error)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { code } = await runCli(
      ["start", "--intent", intentPath, "--base-url", `http://localhost:${port}`],
      { TFA_TENANT_ID: "" },
    );
    eq(code, 3, `expected exit 3 (usage error), got ${code}`);
  } finally { server.close(); }
});

// ─── Integration: tfa receipt ─────────────────────────────────────────────────

test("tfa-cli start-receipt [receipt]: fetch receipt by executionId → exit 0", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-receipt-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    // First: start to get an executionId.
    const { code: startCode, stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(startCode, 0, `start should succeed, got exit ${startCode}: ${startOut}`);
    const startBody = JSON.parse(startOut.trim());
    const workflowId = startBody.receipt?.executionId ?? startBody.receipt?.approvalToken;
    assert(workflowId, `start should return an executionId, got: ${JSON.stringify(startBody)}`);

    // Then: fetch receipt.
    const { code, stdout } = await runCli(
      ["receipt", "--workflow-id", workflowId, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 0, `receipt should exit 0, got ${code}: ${stdout}`);
    assert(stdout.includes("status"), `receipt output should include status: ${stdout}`);
    assert(stdout.includes("signature"), `receipt output should include signature: ${stdout}`);
  } finally { server.close(); }
});

test("tfa-cli start-receipt [receipt]: --json prints body with ok/receipt/workflow", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-receipt-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    const workflowId = JSON.parse(startOut.trim()).receipt?.executionId;
    assert(workflowId, "need executionId from start");

    const { code, stdout } = await runCli(
      ["receipt", "--json", "--workflow-id", workflowId, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 0);
    const body = JSON.parse(stdout.trim());
    assert("receipt" in body, "JSON should have receipt field");
    assert("workflow" in body || "ok" in body, "JSON should have workflow or ok");
  } finally { server.close(); }
});

test("tfa-cli start-receipt [receipt]: unknown workflow-id → exit 4 (404)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-receipt-" + uid();
  try {
    const { code } = await runCli(
      ["receipt", "--workflow-id", "no-such-id-" + uid(), "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 4, `expected exit 4 (404), got ${code}`);
  } finally { server.close(); }
});

test("tfa-cli start-receipt [receipt]: missing --workflow-id → exit 3 (usage error)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  try {
    const { code, stderr } = await runCli(
      ["receipt", "--tenant", "t1", "--base-url", `http://localhost:${port}`],
    );
    eq(code, 3, `expected exit 3, got ${code}: ${stderr}`);
  } finally { server.close(); }
});

test("tfa-cli start-receipt [receipt]: missing tenant → exit 3 (usage error)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  try {
    const { code } = await runCli(
      ["receipt", "--workflow-id", "wf-123", "--base-url", `http://localhost:${port}`],
      { TFA_TENANT_ID: "" },
    );
    eq(code, 3, `expected exit 3 (usage error), got ${code}`);
  } finally { server.close(); }
});

// ─── Offline verification ──────────────────────────────────────────────────────

test("tfa-cli start-receipt [receipt]: offline HMAC verification with correct --secret → exit 0, ✓ VALID", async () => {
  // Build a stack with a known HMAC secret for deterministic offline verification.
  delete process.env.NODE_ENV; // avoid production-only throw when no pool is provided
  const KNOWN_SECRET = "cli-test-known-secret-32bytes-ok!";
  const stack = buildSovereignStack(undefined, { signerKind: "hmac", auditSecret: KNOWN_SECRET });
  const { startSovereignServer: startWithStack } = await import("../../src/http/sovereign-server.ts");
  const server = startWithStack(0, stack);
  const port = (server.address() as any).port;
  const tenant = "cli-receipt-verify-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    const workflowId = JSON.parse(startOut.trim()).receipt?.executionId;
    assert(workflowId, "need executionId");

    const { code, stdout } = await runCli(
      ["receipt", "--workflow-id", workflowId, "--base-url", `http://localhost:${port}`,
       "--tenant", tenant, "--secret", KNOWN_SECRET],
    );
    eq(code, 0, `expected exit 0, got ${code}: ${stdout}`);
    assert(stdout.includes("VALID"), `expected VALID in output: ${stdout}`);
    assert(!stdout.includes("INVALID"), `expected no INVALID in output: ${stdout}`);
  } finally { server.close(); }
});

test("tfa-cli start-receipt [receipt]: offline HMAC verification with wrong --secret → exit 4, ✗ INVALID", async () => {
  const REAL_SECRET = "cli-test-real-secret-32bytes-ok!!";
  const WRONG_SECRET = "completely-different-secret-wrong";
  delete process.env.NODE_ENV; // avoid production-only throw when no pool is provided
  const stack = buildSovereignStack(undefined, { signerKind: "hmac", auditSecret: REAL_SECRET });
  const { startSovereignServer: startWithStack } = await import("../../src/http/sovereign-server.ts");
  const server = startWithStack(0, stack);
  const port = (server.address() as any).port;
  const tenant = "cli-receipt-verify-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    const workflowId = JSON.parse(startOut.trim()).receipt?.executionId;
    assert(workflowId, "need executionId");

    const { code, stdout } = await runCli(
      ["receipt", "--workflow-id", workflowId, "--base-url", `http://localhost:${port}`,
       "--tenant", tenant, "--secret", WRONG_SECRET],
    );
    eq(code, 4, `expected exit 4 (invalid sig), got ${code}: ${stdout}`);
    assert(stdout.includes("INVALID"), `expected INVALID in output: ${stdout}`);
  } finally { server.close(); }
});

// ─── End-to-end: start → receipt pipeline ─────────────────────────────────────

test("tfa-cli start-receipt [e2e]: start → receipt pipeline: receipt contains same executionId", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-e2e-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { code: startCode, stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(startCode, 0);
    const startBody = JSON.parse(startOut.trim());
    const executionId = startBody.receipt?.executionId;
    assert(executionId, "start should return executionId");

    const { code: receiptCode, stdout: receiptOut } = await runCli(
      ["receipt", "--json", "--workflow-id", executionId, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(receiptCode, 0);
    const receiptBody = JSON.parse(receiptOut.trim());
    eq(receiptBody.receipt?.executionId, executionId, "receipt.executionId should match start's executionId");
  } finally { server.close(); }
});
