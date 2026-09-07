import "../_flush.mjs";
/**
 * tests/sdk-cli/github-action-compat.test.ts — GitHub Action compat check (v278)
 *
 * Closes MANIFEST "החסר הבא" #1: "action.yml משתמשת ב-CLI — לוודא ש-colored output +
 * spinner לא שוברים parsing של ה-outputs ב-GitHub Action."
 *
 * Coverage:
 *   action.yml capture:
 *     • stderr is NOT merged into the JSON temp file (defense in depth)
 *     • JSON extraction logic from action.yml works on clean CLI JSON output
 *     • fail-closed: malformed JSON yields empty strings, not exceptions
 *
 *   CLI --json stderr isolation:
 *     • check-action --json happy path: stdout is valid JSON, stderr is clean
 *     • check-action --json network error: stderr has no braille/ANSI frames
 *     • start --json happy path: stdout is valid JSON, stderr is clean
 *     • receipt --json happy path: stdout is valid JSON, stderr is clean
 *     • verify --json happy path: stdout is valid JSON, stderr is clean
 *
 *   TTY simulation (defense in depth):
 *     • even with FORCE_COLOR=1, --json check-action produces no ANSI in stderr
 */

import { test, assert, eq } from "../_harness.mjs";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

const execFileAsync = promisify(execFile);

/** Wrapper that resolves even on non-zero exit so we can inspect stdout/stderr. */
function execFileIgnoreExit(...args: any[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    (execFile as any)(...args, (error: any, stdout: string, stderr: string) => {
      resolve({ stdout, stderr, exitCode: error ? (error.code ?? 1) : 0 });
    });
  });
}
const CLI_PATH = join(import.meta.dirname, "../../sdk/cli/bin/tfa.mjs");
const ACTION_YML_PATH = join(import.meta.dirname, "../../sdk/github-action/action.yml");

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeIntent(overrides = {}) {
  return {
    tenantId: "compat-test-tenant",
    actorId: "agent:compat-test",
    toolId: overrides.toolId ?? "file.read",
    resourceRef: "res:compat-test",
    riskClass: overrides.riskClass ?? "read_only",
    valueMicrounits: "0",
    privacyLevel: "internal",
    approvalPolicyRef: "pol:default",
    nonce: "compat-nonce-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "compat-test",
    evidencePolicy: "ev:default",
    ...overrides,
  };
}

function writeTempIntent(obj) {
  const dir = mkdtempSync(join(tmpdir(), "tfa-compat-test-"));
  const file = join(dir, "intent.json");
  writeFileSync(file, JSON.stringify(obj));
  return file;
}

async function withServer(fn) {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** Simulates the exact node -e extraction logic from action.yml. */
function extractDecision(jsonText: string): string {
  try {
    const d = JSON.parse(jsonText);
    return d.decision || "";
  } catch {
    return "";
  }
}

function extractExecutionId(jsonText: string): string {
  try {
    const d = JSON.parse(jsonText);
    return d.executionId || d.receipt?.executionId || "";
  } catch {
    return "";
  }
}

function extractApprovalToken(jsonText: string): string {
  try {
    const d = JSON.parse(jsonText);
    return d.approvalToken || d.receipt?.approvalToken || "";
  } catch {
    return "";
  }
}

// ─── action.yml capture hygiene ──────────────────────────────────────────────

test("action.yml does not merge stderr into the JSON temp file", () => {
  const yml = readFileSync(ACTION_YML_PATH, "utf8");
  const captureLine = yml.split("\n").find((l) => l.includes('"$NODE" "$CLI"') && l.includes("--json"));
  assert(!!captureLine, "must find the CLI invocation line with --json");
  assert(
    !captureLine.includes("2>&1"),
    `JSON capture line must NOT merge stderr (got: ${captureLine.trim()})`
  );
});

test("action.yml JSON extraction logic works on real CLI --json output", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "check-action",
      "--intent",
      file,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    eq(extractDecision(stdout), "allowed");
    assert(extractExecutionId(stdout).length > 0, "executionId should be extractable");
  });
});

test("action.yml extraction is fail-closed: malformed JSON returns empty strings", () => {
  eq(extractDecision('{"decision": '), "");
  eq(extractExecutionId("not json"), "");
  eq(extractApprovalToken(""), "");
});

// ─── CLI --json stdout/stderr isolation ─────────────────────────────────────

test("CLI --json check-action happy path: stdout is valid JSON, stderr has no ANSI", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout, stderr } = await execFileAsync("node", [
      CLI_PATH,
      "check-action",
      "--intent",
      file,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    eq(parsed.decision, "allowed");
    assert(!stderr.includes("\x1b["), "stderr must not contain ANSI escape sequences");
    assert(!stderr.includes("⠋"), "stderr must not contain braille spinner frames");
  });
});

test("CLI --json check-action network error: stderr has no braille/ANSI", async () => {
  const file = writeTempIntent(makeIntent());
  let caught: any = null;
  try {
    await execFileAsync(
      "node",
      [CLI_PATH, "check-action", "--intent", file, "--base-url", "http://127.0.0.1:1", "--tenant", "t1", "--json"],
      { timeout: 5000 }
    );
  } catch (e) {
    caught = e;
  }
  assert(caught !== null, "expected network error");
  eq(caught.code, 4);
  const stderr = caught.stderr || "";
  assert(!stderr.includes("⠋"), "stderr must not contain braille frames on network error");
  assert(!stderr.includes("\x1b["), "stderr must not contain ANSI on network error");
});

test("CLI --json start happy path: stdout is valid JSON, stderr is clean", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout, stderr } = await execFileAsync("node", [
      CLI_PATH,
      "start",
      "--intent",
      file,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    assert(typeof parsed.decision === "string", "JSON decision field should be a string");
    assert(!stderr.includes("\x1b["), "stderr must not contain ANSI escape sequences");
    assert(!stderr.includes("⠋"), "stderr must not contain braille spinner frames");
  });
});

test("CLI --json receipt happy path: stdout is valid JSON, stderr is clean", async () => {
  await withServer(async (baseUrl) => {
    // First create an execution to get a workflowId.
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout: startOut } = await execFileAsync("node", [
      CLI_PATH,
      "start",
      "--intent",
      file,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const startBody = JSON.parse(startOut);
    const workflowId = startBody.receipt?.executionId || startBody.receipt?.approvalToken;
    assert(!!workflowId, "expected workflowId from start");

    const { stdout, stderr } = await execFileAsync("node", [
      CLI_PATH,
      "receipt",
      "--workflow-id",
      workflowId,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    assert(typeof parsed.receipt === "object" || typeof parsed.workflow === "object", "JSON should contain receipt or workflow");
    assert(!stderr.includes("\x1b["), "stderr must not contain ANSI escape sequences");
    assert(!stderr.includes("⠋"), "stderr must not contain braille spinner frames");
  });
});

test("CLI --json verify happy path: stdout is valid JSON, stderr is clean", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout: startOut } = await execFileAsync("node", [
      CLI_PATH,
      "start",
      "--intent",
      file,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const startBody = JSON.parse(startOut);
    const workflowId = startBody.receipt?.executionId || startBody.receipt?.approvalToken;
    assert(!!workflowId, "expected workflowId from start");

    // Fetch receipt as JSON file for verify command.
    const { stdout: receiptOut } = await execFileAsync("node", [
      CLI_PATH,
      "receipt",
      "--workflow-id",
      workflowId,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const receiptBody = JSON.parse(receiptOut);
    const receipt = receiptBody.receipt;
    assert(!!receipt, "expected receipt object");

    const receiptFile = join(tmpdir(), `tfa-compat-receipt-${Date.now()}.json`);
    writeFileSync(receiptFile, JSON.stringify(receipt));

    const { stdout, stderr } = await execFileIgnoreExit("node", [
      CLI_PATH,
      "verify",
      "--receipt",
      receiptFile,
      "--base-url",
      baseUrl,
      "--tenant",
      "compat-test-tenant",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    assert(typeof parsed.valid === "boolean", "JSON should contain valid boolean");
    assert(!stderr.includes("\x1b["), "stderr must not contain ANSI escape sequences");
    assert(!stderr.includes("⠋"), "stderr must not contain braille spinner frames");
  });
});

// ─── TTY simulation with FORCE_COLOR ─────────────────────────────────────────

test("CLI --json check-action with FORCE_COLOR=1 produces no ANSI in stderr", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout, stderr } = await execFileAsync(
      "node",
      [CLI_PATH, "check-action", "--intent", file, "--base-url", baseUrl, "--tenant", "compat-test-tenant", "--json"],
      { env: { ...process.env, FORCE_COLOR: "1" } }
    );
    const parsed = JSON.parse(stdout);
    eq(parsed.decision, "allowed");
    assert(!stderr.includes("\x1b["), "stderr must not contain ANSI even with FORCE_COLOR=1");
    assert(!stderr.includes("⠋"), "stderr must not contain braille even with FORCE_COLOR=1");
  });
});
