import "../_flush.mjs";
/**
 * tests/sdk-cli/tfa-cli-verify.test.ts — @tfa/cli verify command
 *
 * Coverage:
 *   Unit (pure functions, no network):
 *     • parseArgs: verify command parsed correctly
 *     • parseArgs: verify --receipt and --mandate-linkage flags parsed
 *     • parseArgs: missing --receipt in verify → CliUsageError
 *
 *   Integration (live server via startSovereignServer):
 *     • verify valid execution receipt → exit 0, VALID
 *     • verify tampered receipt → exit 2, INVALID
 *     • verify --json prints raw JSON
 *     • verify missing tenant → exit 3 (usage error)
 */

import { test, assert, eq } from "../_harness.mjs";
import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { parseArgs, CliUsageError } from "../../sdk/cli/bin/tfa.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = join(import.meta.dirname, "../../sdk/cli/bin/tfa.mjs");

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
  const dir = mkdtempSync(join(tmpdir(), "tfa-verify-"));
  const p = join(dir, "intent.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

function writeTempReceipt(obj: object): string {
  const dir = mkdtempSync(join(tmpdir(), "tfa-verify-"));
  const p = join(dir, "receipt.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

async function runCli(args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, ...args], {
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, TFA_BASE_URL: "", TFA_TENANT_ID: "", TFA_API_KEY: "", ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (e: any) {
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

test("parseArgs: verify command recognised", () => {
  const opts = parseArgs(["verify", "--receipt", "receipt.json"]);
  eq(opts.command, "verify");
  eq(opts.receipt, "receipt.json");
});

test("parseArgs: verify --mandate-linkage recognised", () => {
  const opts = parseArgs(["verify", "--receipt", "r.json", "--mandate-linkage", "link.json"]);
  eq(opts.command, "verify");
  eq(opts.receipt, "r.json");
  eq(opts.mandateLinkage, "link.json");
});

test("tfa-cli verify: missing --receipt → exit 3 (usage error)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  try {
    const { code } = await runCli(
      ["verify", "--base-url", `http://localhost:${port}`, "--tenant", "t"],
    );
    eq(code, 3, `expected exit 3 (usage error), got ${code}`);
  } finally { server.close(); }
});

// ─── Integration tests ────────────────────────────────────────────────────────

test("tfa-cli verify: valid execution receipt → exit 0, VALID", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-verify-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    // Start an action to get a signed execution receipt.
    const { code: startCode, stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(startCode, 0, `start should succeed, got exit ${startCode}: ${startOut}`);
    const startBody = JSON.parse(startOut.trim());
    const receipt = startBody.receipt;
    assert(receipt, `start should return receipt, got: ${JSON.stringify(startBody)}`);

    const receiptPath = writeTempReceipt(receipt);
    const { code, stdout } = await runCli(
      ["verify", "--receipt", receiptPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 0, `verify should exit 0, got ${code}: ${stdout}`);
    assert(stdout.includes("VALID"), `expected VALID in output: ${stdout}`);
    assert(!stdout.includes("INVALID"), `expected no INVALID in output: ${stdout}`);
  } finally { server.close(); }
});

test("tfa-cli verify: tampered receipt → exit 2, INVALID", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-verify-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    const receipt = JSON.parse(startOut.trim()).receipt;
    assert(receipt, "need receipt from start");

    // Tamper: change actorId to break signature integrity.
    receipt.actorId = "agent:tampered";
    const receiptPath = writeTempReceipt(receipt);

    const { code, stdout } = await runCli(
      ["verify", "--receipt", receiptPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 2, `expected exit 2 (invalid), got ${code}: ${stdout}`);
    assert(stdout.includes("INVALID"), `expected INVALID in output: ${stdout}`);
  } finally { server.close(); }
});

test("tfa-cli verify: --json prints raw JSON", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const tenant = "cli-verify-" + uid();
  const intentPath = writeTempIntent(intent("read_only"));
  try {
    const { stdout: startOut } = await runCli(
      ["start", "--json", "--intent", intentPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    const receipt = JSON.parse(startOut.trim()).receipt;
    assert(receipt, "need receipt from start");

    const receiptPath = writeTempReceipt(receipt);
    const { code, stdout } = await runCli(
      ["verify", "--json", "--receipt", receiptPath, "--base-url", `http://localhost:${port}`, "--tenant", tenant],
    );
    eq(code, 0);
    const body = JSON.parse(stdout.trim());
    assert("valid" in body, "JSON should have valid field");
    assert("signatureValid" in body, "JSON should have signatureValid field");
  } finally { server.close(); }
});

test("tfa-cli verify: missing tenant → exit 3 (usage error)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as any).port;
  const receiptPath = writeTempReceipt({ version: "tfa-receipt-v1", executionId: "x" });
  try {
    const { code } = await runCli(
      ["verify", "--receipt", receiptPath, "--base-url", `http://localhost:${port}`],
      { TFA_TENANT_ID: "" },
    );
    eq(code, 3, `expected exit 3 (usage error), got ${code}`);
  } finally { server.close(); }
});
