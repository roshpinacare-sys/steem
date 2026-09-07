#!/usr/bin/env node
/**
 * examples/claude-code-hook/tfa-pre-tool-use.mjs
 *
 * TFA Trust Gate — Claude Code PreToolUse Hook
 *
 * This hook intercepts every tool call in Claude Code *before* it executes.
 * For dangerous tools (file deletion, shell commands, DB migrations, etc.) it
 * automatically gates the action through TFA's trust infrastructure:
 *   1. Calls tfa_simulate_action (dry-run) to get risk prediction + blast radius.
 *   2. If the simulated decision is "allowed" — lets the action through (allow).
 *   3. If the decision is "approval_required" or "denied" — blocks the tool call
 *      and prints the TFA decision + receipt for the operator.
 *
 * This is wedge #1: zero changes to the AI system or tool implementations.
 * Drop this hook into ~/.claude/hooks/ and every Claude Code session is
 * automatically TFA-gated for dangerous operations.
 *
 * ─── How Claude Code hooks work ────────────────────────────────────────────
 *
 * Claude Code calls this script before each tool invocation, passing a JSON
 * object on stdin:
 *   {
 *     "tool_name": "Bash",
 *     "tool_input": { "command": "rm -rf /var/data/*" }
 *   }
 *
 * The hook must write a JSON object to stdout:
 *   { "action": "allow" }                        — proceed normally
 *   { "action": "block", "message": "reason" }  — block + show reason to user
 *   { "action": "allow", "message": "..." }      — proceed + show advisory note
 *
 * Returning non-zero exit code also blocks the tool call (emergency fallback).
 *
 * ─── Installation ────────────────────────────────────────────────────────────
 *
 *   # 1. Copy this file
 *   cp examples/claude-code-hook/tfa-pre-tool-use.mjs ~/.claude/hooks/
 *   chmod +x ~/.claude/hooks/tfa-pre-tool-use.mjs
 *
 *   # 2. Register in Claude Code settings (settings.json or via /hooks command):
 *   #    "hooks": { "PreToolUse": ["~/.claude/hooks/tfa-pre-tool-use.mjs"] }
 *
 *   # 3. Start TFA server (or point to your deployed TFA instance):
 *   #    TFA_BASE_URL=https://tfa.example.com
 *   #    TFA_TENANT_ID=my-org
 *   #    TFA_API_KEY=key_live_xxxx   (optional; use if your instance requires a key)
 *
 *   # 4. All dangerous tool calls are now TFA-gated automatically. Safe tools
 *   #    (ReadFile, ListFiles, etc.) pass through without any latency overhead.
 *
 * ─── Environment variables ────────────────────────────────────────────────────
 *
 *   TFA_BASE_URL    TFA server URL (default: http://localhost:7700)
 *   TFA_TENANT_ID   Tenant identifier (default: "default")
 *   TFA_API_KEY     API key for authenticated TFA instances (optional)
 *   TFA_ACTOR_ID    Actor ID for audit trail (default: "claude-code")
 *   TFA_DRY_RUN     Set to "true" to log decisions but always allow (testing mode)
 *   TFA_TIMEOUT_MS  HTTP timeout per TFA request in ms (default: 3000)
 *   TFA_VERBOSE     Set to "true" to log all decisions to stderr
 *
 * ─── Dangerous tool taxonomy ─────────────────────────────────────────────────
 *
 * The hook classifies tools into risk tiers. Only tier 2+ is checked by TFA:
 *
 *   Tier 0 (safe / always allow, no latency):
 *     ReadFile, ListFiles, SearchFiles, GlobTool, GrepTool, WebSearch, WebFetch,
 *     View, Cat, ls, echo, pwd, date, node --version, tfa --help, etc.
 *
 *   Tier 1 (low risk / allow with advisory note):
 *     WriteFile, EditFile, CreateFile — writing to non-sensitive paths
 *     Bash with safe read-only commands
 *
 *   Tier 2 (medium risk / TFA check):
 *     Bash with shell expansion, pipes, wildcards
 *     WriteFile to sensitive paths (env files, configs, secrets directories)
 *     Git operations (force push, branch deletion, rebase)
 *
 *   Tier 3 (high risk / TFA check, strict policy):
 *     Bash with rm, rmdir, truncate, dd, kill, pkill, sudo, chmod, chown
 *     Database commands (psql, mysql, migrate, drop, truncate)
 *     Network configuration, firewall rules
 *     File operations on production paths (/var, /etc, /proc, /sys)
 *     Secret management (aws secretsmanager, vault, kubectl secret)
 *
 *   Tier 4 (critical / always requires TFA approval_required or block):
 *     System shutdown/reboot, disk format, production deployment commands
 */

import { createInterface } from "node:readline";

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = (process.env.TFA_BASE_URL ?? "http://localhost:7700").replace(/\/$/, "");
const TENANT_ID = process.env.TFA_TENANT_ID ?? "default";
const API_KEY = process.env.TFA_API_KEY ?? null;
const ACTOR_ID = process.env.TFA_ACTOR_ID ?? "claude-code";
const DRY_RUN = process.env.TFA_DRY_RUN === "true";
const TIMEOUT_MS = Number(process.env.TFA_TIMEOUT_MS ?? "3000");
const VERBOSE = process.env.TFA_VERBOSE === "true";

// ─── Risk taxonomy ────────────────────────────────────────────────────────────

/** Patterns that indicate a dangerous Bash command. */
export const DANGEROUS_BASH_PATTERNS = [
  /\brm\s/,          // rm (any form)
  /\brmdir\b/,       // rmdir
  /\btruncate\b/,    // truncate
  /\bdd\b/,          // dd (disk dump — dangerous)
  /\bkill\b/,        // kill process
  /\bpkill\b/,       // pkill
  /\bsudo\b/,        // sudo escalation
  /\bchmod\b/,       // permission change
  /\bchown\b/,       // ownership change
  /\bpsql\b/,        // postgres CLI
  /\bmysql\b/,       // mysql CLI
  /\bdrop\s+table/i, // SQL drop
  /\btruncate\s+table/i,  // SQL truncate
  /\bshutdown\b/,    // system shutdown
  /\breboot\b/,      // reboot
  /\bformat\b/,      // disk format
  /\bmkfs\b/,        // make filesystem
  /\baws\s+secretsmanager/,  // AWS secrets
  /\bvault\s+write/,         // HashiCorp Vault write
  /\bkubectl\s+delete/,      // k8s delete
  /\bgit\s+push.*--force/,   // force push
  /\bgit\s+branch\s+-[Dd]/,  // branch delete
  /\bdocker\s+rm\b/,         // docker remove
  /\bdocker\s+rmi\b/,        // docker image remove
];

/** Sensitive path patterns — writing here triggers a TFA check. */
const SENSITIVE_PATH_PATTERNS = [
  /\/etc\//,
  /\/var\//,
  /\/proc\//,
  /\/sys\//,
  /\.env$/,
  /\.env\.\w/,
  /secrets?\//i,
  /credentials?\//i,
  /private.*key/i,
  /id_rsa/,
  /id_ed25519/,
];

/**
 * classifyToolCall — determine the risk tier for a tool invocation.
 *
 * Exported for testing. Runtime usage is via main() which reads stdin.
 *
 * Returns:
 *   { tier: 0..4, riskClass: string, reasoning: string, toolId: string }
 */
export function classifyToolCall(toolName, toolInput) {
  const name = (toolName ?? "").toLowerCase();
  const inputStr = JSON.stringify(toolInput ?? {}).toLowerCase();

  // Safe read-only tools — always tier 0
  const SAFE_TOOLS = ["readfile", "listfiles", "searchfiles", "globtool", "greptool",
    "websearch", "webfetch", "view", "ls", "cat", "pwd", "date", "todoread",
    "mcp__tfa__tfa_check_action", "mcp__tfa__tfa_simulate_action",
    "mcp__tfa__tfa_get_receipt", "mcp__tfa__tfa_verify_receipt"];
  if (SAFE_TOOLS.some(s => name.includes(s.toLowerCase()))) {
    return { tier: 0, riskClass: "read_only", reasoning: "safe read-only tool", toolId: `tool.${name}` };
  }

  // Bash commands — classify by command content
  if (name === "bash" || name === "runterminalcommand") {
    const cmd = (toolInput?.command ?? toolInput?.cmd ?? "").toString();
    if (DANGEROUS_BASH_PATTERNS.some(p => p.test(cmd))) {
      const isSystemLevel = /\b(shutdown|reboot|format|mkfs)\b/.test(cmd);
      return {
        tier: isSystemLevel ? 4 : 3,
        riskClass: isSystemLevel ? "write_destructive" : "write_destructive",
        reasoning: `Bash command matches dangerous pattern: ${cmd.slice(0, 80)}`,
        toolId: "bash.dangerous",
      };
    }
    // Bash with side-effects but not dangerous patterns
    if (cmd.trim()) {
      return {
        tier: 2,
        riskClass: "write_safe",
        reasoning: `Bash command: ${cmd.slice(0, 60)}`,
        toolId: "bash.side_effect",
      };
    }
    // Empty command — still a Bash call, tier 2 (side-effect possible)
    return { tier: 2, riskClass: "write_safe", reasoning: "Bash (no command)", toolId: "bash.empty" };
  }

  // File write to sensitive path
  if (name === "writefile" || name === "createfile" || name === "edit") {
    const filePath = (toolInput?.path ?? toolInput?.file_path ?? "").toString();
    if (SENSITIVE_PATH_PATTERNS.some(p => p.test(filePath))) {
      return {
        tier: 3,
        riskClass: "write_destructive",
        reasoning: `Writing to sensitive path: ${filePath}`,
        toolId: "file.write_sensitive",
      };
    }
    return { tier: 1, riskClass: "write_safe", reasoning: `Write to: ${filePath}`, toolId: "file.write" };
  }

  // Default: tier 1 for unknown tools with input
  return {
    tier: 1,
    riskClass: "write_safe",
    reasoning: `Unknown tool: ${toolName}`,
    toolId: `tool.${name || "unknown"}`,
  };
}

// ─── TFA HTTP helpers ─────────────────────────────────────────────────────────

async function callTfaSimulate(toolId, riskClass, metadata) {
  const headers = { "content-type": "application/json", "x-tenant-id": TENANT_ID };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const body = JSON.stringify({
    actionType: toolId,
    actorId: ACTOR_ID,
    riskClass,
    valueMicrounits: "0",
    privacyLevel: "internal",
    metadata: metadata ?? {},
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/adapter/simulate`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null; // fail-open on network error (hook should not block if TFA unreachable)
  }
}

// ─── Main hook logic ──────────────────────────────────────────────────────────

async function main() {
  // Read stdin (Claude Code sends one JSON line per invocation)
  let inputJson = "";
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    inputJson += line;
  }

  let hookInput;
  try {
    hookInput = JSON.parse(inputJson || "{}");
  } catch {
    // Malformed input — fail-open (never block on hook error)
    process.stdout.write(JSON.stringify({ action: "allow", message: "[TFA hook] Could not parse hook input — allowing" }));
    process.exit(0);
  }

  const toolName = hookInput.tool_name ?? hookInput.toolName ?? "";
  const toolInput = hookInput.tool_input ?? hookInput.toolInput ?? {};

  const { tier, riskClass, reasoning, toolId } = classifyToolCall(toolName, toolInput);

  if (VERBOSE) {
    process.stderr.write(`[TFA hook] tool=${toolName} tier=${tier} riskClass=${riskClass}\n`);
  }

  // Tier 0: always allow immediately, no TFA latency
  if (tier === 0) {
    process.stdout.write(JSON.stringify({ action: "allow" }));
    process.exit(0);
  }

  // Tier 1: allow with optional advisory
  if (tier === 1 && !DRY_RUN) {
    process.stdout.write(JSON.stringify({ action: "allow" }));
    process.exit(0);
  }

  // DRY_RUN mode: log and allow without calling TFA network
  if (DRY_RUN) {
    const dryMsg = `[TFA dry-run] Would check ${toolName} (tier=${tier}, ${riskClass}) — allowing in dry-run mode. Set TFA_DRY_RUN=false to enforce.`;
    process.stdout.write(JSON.stringify({ action: "allow", message: dryMsg }));
    process.exit(0);
  }

  // Tier 2+: call TFA simulate
  const tfaResult = await callTfaSimulate(toolId, riskClass, {
    originalTool: toolName,
    reasoning,
    hookTier: tier,
  });

  // TFA unreachable — fail-open with advisory (don't block if TFA is down)
  if (!tfaResult) {
    const advisory = `[TFA hook] TFA unreachable — proceeding without trust gate (${toolName}). Consider checking TFA_BASE_URL=${BASE_URL}.`;
    if (VERBOSE) process.stderr.write(advisory + "\n");
    process.stdout.write(JSON.stringify({ action: "allow", message: advisory }));
    process.exit(0);
  }

  const decision = tfaResult.decision ?? tfaResult.result?.decision;
  const simulation = tfaResult.simulation ?? tfaResult.result?.simulation ?? {};

  if (decision === "allowed") {
    const msg = tier >= 3
      ? `[TFA] ✓ allowed — ${toolName} (${riskClass}, blast_radius: ${simulation.blastRadius ?? "?"})`
      : undefined;
    process.stdout.write(JSON.stringify(msg ? { action: "allow", message: msg } : { action: "allow" }));
    process.exit(0);
  }

  // Blocked by TFA
  const blockMsg = [
    `[TFA] 🚫 ${decision?.toUpperCase() ?? "BLOCKED"}: ${toolName}`,
    `  Risk class: ${riskClass}`,
    `  Reason: ${reasoning}`,
    `  Blast radius: ${simulation.blastRadius ?? "unknown"}`,
    `  Reversible: ${simulation.reversible ?? "unknown"}`,
    simulation.warnings?.length ? `  Warnings: ${simulation.warnings.join("; ")}` : null,
    `  To proceed: call tfa_approve_execution with the returned approvalToken,`,
    `  or set TFA_DRY_RUN=true to run in advisory-only mode.`,
  ].filter(Boolean).join("\n");

  process.stdout.write(JSON.stringify({ action: "block", message: blockMsg }));
  process.exit(0);
}

// Only run main() when executed directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("tfa-pre-tool-use.mjs")) {
  main().catch(err => {
    // Never let the hook crash Claude Code — fail-open
    process.stdout.write(JSON.stringify({
      action: "allow",
      message: `[TFA hook] unexpected error: ${err.message} — allowing`,
    }));
    process.exit(0);
  });
}
