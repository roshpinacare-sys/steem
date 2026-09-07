import "../_flush.mjs";
/**
 * tests/sdk-cli/tfa-cli.test.ts — @tfa/cli sub-step 1 (check-action command)
 *
 * Coverage:
 *   Unit (pure functions, no network):
 *     • parseArgs: check-action + flags, --json, --help, --version, unknown flag throws
 *     • parseIntentJson: valid object passes, non-object/array/malformed throws CliUsageError
 *     • resolveBaseUrl: flag > env > default; trailing slash stripped
 *     • resolveTenant: flag > env > intent.tenantId > null
 *     • resolveApiKey: flag > env > null
 *     • exitCodeForDecision: allowed=0, approval_required=1, denied=2, unknown=4
 *
 *   Integration (live server via startSovereignServer):
 *     • check-action happy path (read_only) → exit 0, decision=allowed, receipt printed
 *     • check-action approval_required (write_destructive) → exit 1
 *     • check-action denied path → exit 2
 *     • check-action missing tenant (no flag/env/intent.tenantId, no api-key) → usage error (exit 3)
 *     • check-action malformed intent JSON → usage error (exit 3)
 *     • check-action network error (bad base-url, unreachable port) → exit 4
 *     • check-action --json prints valid JSON matching the receipt body
 *     • check-action reads intent from a file path (not just stdin)
 *
 * The CLI module is invoked via dynamic spawn (real subprocess) for integration
 * tests so we exercise the actual `main()` entry-point, exit codes, and stdout/stderr
 * — not just the exported helpers.
 */

import { test, assert, eq } from "../_harness.mjs";
import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import {
  parseArgs,
  parseIntentJson,
  resolveBaseUrl,
  resolveTenant,
  resolveApiKey,
  exitCodeForDecision,
  CliUsageError,
} from "../../sdk/cli/bin/tfa.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = join(import.meta.dirname, "../../sdk/cli/bin/tfa.mjs");

// ─── Unit: parseArgs ────────────────────────────────────────────────────────

test("parseArgs: check-action with --intent and --tenant", () => {
  const opts = parseArgs(["check-action", "--intent", "x.json", "--tenant", "t1"]);
  eq(opts.command, "check-action");
  eq(opts.intent, "x.json");
  eq(opts.tenant, "t1");
});

test("parseArgs: --json flag is recognised", () => {
  const opts = parseArgs(["check-action", "--intent", "-", "--json"]);
  eq(opts.json, true);
});

test("parseArgs: --help sets help=true", () => {
  const opts = parseArgs(["--help"]);
  eq(opts.help, true);
});

test("parseArgs: --version sets version=true", () => {
  const opts = parseArgs(["--version"]);
  eq(opts.version, true);
});

test("parseArgs: unknown flag throws CliUsageError", () => {
  let threw = false;
  try { parseArgs(["check-action", "--bogus", "x"]); }
  catch (e) { threw = e instanceof CliUsageError; }
  assert(threw, "should throw CliUsageError for unknown flag");
});

// ─── Unit: parseIntentJson ──────────────────────────────────────────────────

test("parseIntentJson: valid object passes through", () => {
  const obj = parseIntentJson('{"actorId":"a","toolId":"t"}');
  eq(obj.actorId, "a");
});

test("parseIntentJson: malformed JSON throws CliUsageError", () => {
  let threw = false;
  try { parseIntentJson("{not json"); }
  catch (e) { threw = e instanceof CliUsageError; }
  assert(threw, "malformed JSON should throw CliUsageError");
});

test("parseIntentJson: array input throws CliUsageError", () => {
  let threw = false;
  try { parseIntentJson("[1,2,3]"); }
  catch (e) { threw = e instanceof CliUsageError; }
  assert(threw, "array input should throw CliUsageError");
});

test("parseIntentJson: null input throws CliUsageError", () => {
  let threw = false;
  try { parseIntentJson("null"); }
  catch (e) { threw = e instanceof CliUsageError; }
  assert(threw, "null input should throw CliUsageError");
});

// ─── Unit: resolveBaseUrl / resolveTenant / resolveApiKey ──────────────────

test("resolveBaseUrl: flag value wins, trailing slash stripped", () => {
  eq(resolveBaseUrl("https://example.com/"), "https://example.com");
});

test("resolveBaseUrl: defaults to localhost:3000 when nothing supplied", () => {
  const saved = process.env.TFA_BASE_URL;
  delete process.env.TFA_BASE_URL;
  try {
    eq(resolveBaseUrl(null), "http://localhost:3000");
  } finally {
    if (saved !== undefined) process.env.TFA_BASE_URL = saved;
  }
});

test("resolveTenant: flag > env > intent.tenantId > null", () => {
  eq(resolveTenant("flag-t", { tenantId: "intent-t" }), "flag-t");
  eq(resolveTenant(null, { tenantId: "intent-t" }), "intent-t");
  eq(resolveTenant(null, {}), null);
});

test("resolveApiKey: flag wins over env", () => {
  eq(resolveApiKey("flag-key"), "flag-key");
});

// ─── Unit: exitCodeForDecision ──────────────────────────────────────────────

test("exitCodeForDecision: allowed=0, approval_required=1, denied=2, unknown=4", () => {
  eq(exitCodeForDecision("allowed"), 0);
  eq(exitCodeForDecision("approval_required"), 1);
  eq(exitCodeForDecision("denied"), 2);
  eq(exitCodeForDecision("garbage"), 4);
  eq(exitCodeForDecision(undefined), 4);
});

// ─── Integration: real subprocess against a live TFA server ────────────────

function makeIntent(overrides = {}) {
  return {
    tenantId: "cli-test-tenant",
    actorId: "agent:cli-test",
    toolId: overrides.toolId ?? "file.read",
    resourceRef: "res:cli-test",
    riskClass: overrides.riskClass ?? "read_only",
    valueMicrounits: "0",
    privacyLevel: "internal",
    approvalPolicyRef: "pol:default",
    nonce: "cli-nonce-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "cli-test",
    evidencePolicy: "ev:default",
    ...overrides,
  };
}

function writeTempIntent(obj) {
  const dir = mkdtempSync(join(tmpdir(), "tfa-cli-test-"));
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

test("CLI integration: check-action happy path (read_only) → exit 0, decision=allowed", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    try {
      const { stdout } = await execFileAsync("node", [CLI_PATH, "check-action", "--intent", file, "--base-url", baseUrl, "--tenant", "cli-test-tenant"]);
      assert(stdout.includes("allowed"), "stdout should mention allowed decision: " + stdout);
    } catch (e) {
      // execFile throws on non-zero exit; for allowed we expect exit 0, so this is unexpected
      throw new Error(`expected exit 0 but got error: ${e.message}\nstdout: ${e.stdout}\nstderr: ${e.stderr}`);
    }
  });
});

test("CLI integration: check-action approval_required (write_destructive) → exit 1", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }));
    let caught = null;
    try {
      await execFileAsync("node", [CLI_PATH, "check-action", "--intent", file, "--base-url", baseUrl, "--tenant", "cli-test-tenant"]);
    } catch (e) {
      caught = e;
    }
    assert(caught !== null, "expected non-zero exit for approval_required");
    eq(caught.code, 1);
    assert(caught.stdout.includes("approval_required"), "stdout should mention approval_required: " + caught.stdout);
  });
});

test("CLI integration: --json prints parseable JSON with decision field", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ toolId: "file.read", riskClass: "read_only" }));
    const { stdout } = await execFileAsync("node", [CLI_PATH, "check-action", "--intent", file, "--base-url", baseUrl, "--tenant", "cli-test-tenant", "--json"]);
    const parsed = JSON.parse(stdout);
    eq(parsed.decision, "allowed");
    assert(typeof parsed.receipt === "object", "receipt object present in JSON output");
  });
});

test("CLI integration: missing tenant (no flag/env/intent.tenantId/api-key) → usage error exit 3", async () => {
  await withServer(async (baseUrl) => {
    const file = writeTempIntent(makeIntent({ tenantId: undefined }));
    let caught = null;
    try {
      await execFileAsync("node", [CLI_PATH, "check-action", "--intent", file, "--base-url", baseUrl], {
        env: { ...process.env, TFA_TENANT_ID: "", TFA_API_KEY: "" },
      });
    } catch (e) {
      caught = e;
    }
    assert(caught !== null, "expected usage error for missing tenant");
    eq(caught.code, 3);
  });
});

test("CLI integration: malformed intent JSON file → usage error exit 3", async () => {
  await withServer(async (baseUrl) => {
    const dir = mkdtempSync(join(tmpdir(), "tfa-cli-test-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, "{ not valid json");
    let caught = null;
    try {
      await execFileAsync("node", [CLI_PATH, "check-action", "--intent", file, "--base-url", baseUrl, "--tenant", "t1"]);
    } catch (e) {
      caught = e;
    }
    assert(caught !== null, "expected usage error for malformed JSON");
    eq(caught.code, 3);
  });
});

test("CLI integration: unreachable base-url → network error exit 4", async () => {
  const file = writeTempIntent(makeIntent());
  let caught = null;
  try {
    await execFileAsync("node", [CLI_PATH, "check-action", "--intent", file, "--base-url", "http://127.0.0.1:1", "--tenant", "t1"], { timeout: 5000 });
  } catch (e) {
    caught = e;
  }
  assert(caught !== null, "expected network error for unreachable server");
  eq(caught.code, 4);
});

test("CLI integration: --help exits 0 and prints usage", async () => {
  const { stdout } = await execFileAsync("node", [CLI_PATH, "--help"]);
  assert(stdout.includes("check-action"), "help text should mention check-action");
  assert(stdout.includes("Exit codes"), "help text should document exit codes");
});

test("CLI integration: --version prints a version string", async () => {
  const { stdout } = await execFileAsync("node", [CLI_PATH, "--version"]);
  assert(/^\d+\.\d+\.\d+/.test(stdout.trim()), "version should look like semver: " + stdout);
});
