import "../_flush.mjs";
/**
 * tests/examples/claude-code-hook.test.ts
 *
 * Tests for examples/claude-code-hook/tfa-pre-tool-use.mjs.
 *
 * Coverage:
 *   classifyToolCall (exported for testing)
 *     • Safe tier-0 tools → tier 0, read_only
 *     • Bash rm command → tier 3, write_destructive
 *     • Bash shutdown → tier 4, write_destructive
 *     • Bash safe echo → tier 2, write_safe
 *     • WriteFile sensitive path (.env) → tier 3, write_destructive
 *     • WriteFile normal path → tier 1, write_safe
 *     • Unknown tool → tier 1
 *     • TFA MCP tools (tfa_check_action) → tier 0, read_only
 *
 *   Hook output (subprocess / stdin-stdout)
 *     • tier-0 tool → {"action":"allow"} with no TFA call
 *     • TFA_DRY_RUN=true always returns allow (with advisory message)
 *     • Malformed stdin → {"action":"allow"} (fail-open)
 *
 *   Dangerous bash pattern coverage
 *     • rm -rf → dangerous
 *     • kill -9 → dangerous
 *     • sudo su → dangerous
 *     • psql -c 'DROP TABLE' → dangerous
 *     • git push --force → dangerous
 *     • echo hello → NOT dangerous (tier 2 only)
 *     • ls -la → NOT dangerous (tier 0)
 *
 *   Sensitive path coverage
 *     • /etc/hosts → sensitive
 *     • .env → sensitive
 *     • secrets/key.pem → sensitive
 *     • src/index.ts → NOT sensitive
 */

import { test, assert, eq } from "../_harness.mjs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const HOOK_PATH = resolve(__dirname, "../../examples/claude-code-hook/tfa-pre-tool-use.mjs");
const README_PATH = resolve(__dirname, "../../examples/claude-code-hook/README.md");

// ─── Import classify function from hook ────────────────────────────────────────

// The hook exports classifyToolCall for testing.
// We import it dynamically so it runs in the same Node.js process (fast).
let classify: (toolName: string, toolInput: Record<string, unknown>) => {
  tier: number;
  riskClass: string;
  reasoning: string;
  toolId: string;
};

const hookModule = await import(HOOK_PATH);
classify = hookModule.classifyToolCall;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runHook(
  input: unknown,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [HOOK_PATH], {
      env: { ...process.env, ...env, NODE_OPTIONS: "--experimental-strip-types" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
    proc.on("close", (code: number) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
  });
}

// ─── classifyToolCall: tier-0 safe tools ─────────────────────────────────────

test("classify: ReadFile → tier 0, read_only", () => {
  const r = classify("ReadFile", { path: "/tmp/test.ts" });
  eq(r.tier, 0);
  eq(r.riskClass, "read_only");
});

test("classify: ListFiles → tier 0, read_only", () => {
  const r = classify("ListFiles", {});
  eq(r.tier, 0);
  eq(r.riskClass, "read_only");
});

test("classify: GrepTool → tier 0, read_only", () => {
  const r = classify("GrepTool", { pattern: "TODO" });
  eq(r.tier, 0);
  eq(r.riskClass, "read_only");
});

test("classify: TFA MCP tool tfa_check_action → tier 0, read_only", () => {
  const r = classify("mcp__tfa__tfa_check_action", {});
  eq(r.tier, 0);
  eq(r.riskClass, "read_only");
});

test("classify: TFA MCP tool tfa_simulate_action → tier 0 (no infinite recursion risk)", () => {
  const r = classify("mcp__tfa__tfa_simulate_action", {});
  eq(r.tier, 0);
});

// ─── classifyToolCall: dangerous bash ─────────────────────────────────────────

test("classify: Bash rm -rf → tier 3, write_destructive", () => {
  const r = classify("Bash", { command: "rm -rf ./dist" });
  assert(r.tier >= 3, `Expected tier ≥ 3, got ${r.tier}`);
  eq(r.riskClass, "write_destructive");
});

test("classify: Bash sudo su → tier 3+, write_destructive", () => {
  const r = classify("Bash", { command: "sudo su -c 'id'" });
  assert(r.tier >= 3);
  eq(r.riskClass, "write_destructive");
});

test("classify: Bash kill -9 → tier 3+, write_destructive", () => {
  const r = classify("Bash", { command: "kill -9 1234" });
  assert(r.tier >= 3);
  eq(r.riskClass, "write_destructive");
});

test("classify: Bash psql DROP TABLE → tier 3+, write_destructive", () => {
  const r = classify("Bash", { command: "psql -c 'DROP TABLE users'" });
  assert(r.tier >= 3);
  eq(r.riskClass, "write_destructive");
});

test("classify: Bash git push --force → tier 3+, write_destructive", () => {
  const r = classify("Bash", { command: "git push origin main --force" });
  assert(r.tier >= 3);
  eq(r.riskClass, "write_destructive");
});

test("classify: Bash shutdown → tier 4, write_destructive", () => {
  const r = classify("Bash", { command: "shutdown -h now" });
  eq(r.tier, 4);
  eq(r.riskClass, "write_destructive");
});

test("classify: Bash reboot → tier 4, write_destructive", () => {
  const r = classify("Bash", { command: "reboot" });
  eq(r.tier, 4);
});

// ─── classifyToolCall: safe bash ──────────────────────────────────────────────

test("classify: Bash echo hello → tier 2 (side_effect), NOT dangerous", () => {
  const r = classify("Bash", { command: "echo hello world" });
  eq(r.tier, 2);
  eq(r.riskClass, "write_safe");
  assert(!r.reasoning.toLowerCase().includes("dangerous"), "echo should not be flagged dangerous");
});

test("classify: Bash node --version → tier 2, write_safe", () => {
  const r = classify("Bash", { command: "node --version" });
  eq(r.tier, 2);
});

// ─── classifyToolCall: file writes ────────────────────────────────────────────

test("classify: WriteFile to .env → tier 3, write_destructive", () => {
  const r = classify("WriteFile", { path: "/app/.env" });
  assert(r.tier >= 3);
  eq(r.riskClass, "write_destructive");
});

test("classify: WriteFile to /etc/hosts → tier 3, write_destructive", () => {
  const r = classify("WriteFile", { path: "/etc/hosts" });
  assert(r.tier >= 3);
  eq(r.riskClass, "write_destructive");
});

test("classify: WriteFile to secrets/api.key → tier 3, write_destructive", () => {
  const r = classify("WriteFile", { path: "secrets/api.key" });
  assert(r.tier >= 3);
});

test("classify: WriteFile to src/index.ts → tier 1, write_safe", () => {
  const r = classify("WriteFile", { path: "src/index.ts" });
  eq(r.tier, 1);
  eq(r.riskClass, "write_safe");
});

// ─── classifyToolCall: edge cases ─────────────────────────────────────────────

test("classify: unknown tool → tier 1 (conservative default)", () => {
  const r = classify("SomeFutureTool", { param: "value" });
  eq(r.tier, 1);
});

test("classify: empty tool name → tier 1 (conservative)", () => {
  const r = classify("", {});
  eq(r.tier, 1);
});

test("classify: Bash with no command → tier 2 (non-dangerous)", () => {
  const r = classify("Bash", {});
  eq(r.tier, 2);
});

// ─── Hook subprocess: tier-0 tool always allows without TFA call ──────────────

test("hook: ReadFile → {action:'allow'} instantly (no TFA network)", async () => {
  const { stdout, exitCode } = await runHook({
    tool_name: "ReadFile",
    tool_input: { path: "/tmp/test.ts" },
  }, {
    TFA_BASE_URL: "http://127.0.0.1:1", // unreachable — tier-0 should not try
  });
  const result = JSON.parse(stdout);
  eq(result.action, "allow");
  eq(exitCode, 0);
});

// ─── Hook subprocess: TFA_DRY_RUN=true always allows ─────────────────────────

test("hook: TFA_DRY_RUN=true + dangerous bash → allow with advisory message", async () => {
  const { stdout, exitCode } = await runHook({
    tool_name: "Bash",
    tool_input: { command: "rm -rf /tmp/test" },
  }, {
    TFA_DRY_RUN: "true",
    TFA_BASE_URL: "http://127.0.0.1:1", // unreachable — dry-run should not block
    TFA_TENANT_ID: "test-tenant",
  });
  const result = JSON.parse(stdout);
  eq(result.action, "allow");
  assert(typeof result.message === "string" && result.message.includes("dry-run"),
    `Expected dry-run advisory. Got: ${result.message}`);
  eq(exitCode, 0);
});

// ─── Hook subprocess: malformed stdin → fail-open ────────────────────────────

test("hook: malformed JSON stdin → {action:'allow'} (fail-open)", async () => {
  const proc = await new Promise<{ stdout: string; exitCode: number }>((resolve) => {
    const p = spawn(process.execPath, [HOOK_PATH], {
      env: { ...process.env, NODE_OPTIONS: "--experimental-strip-types" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    p.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    p.stdin.write("this is not valid json {{{{");
    p.stdin.end();
    p.on("close", (code: number) => resolve({ stdout, exitCode: code ?? 0 }));
  });
  const result = JSON.parse(proc.stdout);
  eq(result.action, "allow");
  eq(proc.exitCode, 0);
});

// ─── Hook: TFA unreachable → fail-open ────────────────────────────────────────

test("hook: TFA server unreachable + dangerous bash → allow with advisory (fail-open)", async () => {
  const { stdout, exitCode } = await runHook({
    tool_name: "Bash",
    tool_input: { command: "rm -rf /tmp/test2" },
  }, {
    TFA_BASE_URL: "http://127.0.0.1:1", // port 1 = unreachable
    TFA_TENANT_ID: "test-tenant",
    TFA_TIMEOUT_MS: "100", // fast timeout
    TFA_DRY_RUN: "false",
  });
  const result = JSON.parse(stdout);
  eq(result.action, "allow");
  assert(result.message?.includes("unreachable"), `Expected 'unreachable' in message. Got: ${result.message}`);
  eq(exitCode, 0);
});

// ─── README exists and contains key sections ──────────────────────────────────

test("hook README exists with installation instructions", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  assert(existsSync(README_PATH), `README not found at ${README_PATH}`);
  const content = readFileSync(README_PATH, "utf-8");
  assert(content.includes("Installation"), "README must have Installation section");
  assert(content.includes("PreToolUse"), "README must mention PreToolUse");
  assert(content.includes("TFA_BASE_URL"), "README must document TFA_BASE_URL");
  assert(content.includes("fail-open") || content.includes("Fail-open"), "README must mention fail-open policy");
});
