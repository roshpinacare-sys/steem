#!/usr/bin/env node
/**
 * saos-agents bin — REA-pattern zero-friction CLI for the SAOS sovereignty gate.
 * Commands:
 *   saos-agents setup [--yes|--dry-run|--uninstall|--json]  register the gate into every supported agent
 *   saos-agents mcp-config                                   print the agent-ready MCP JSON snippet
 *   saos-agents doctor                                       fail-closed install self-check
 * Law: plan-before-action; backup-before-write; removes only its own entry; zero secrets in config.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.join(PKG, "mcp.mjs");
const SETUP = path.join(PKG, "scripts", "saos-setup.mjs");
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";

function die(msg, code = 1) { console.error(msg); process.exit(code); }

function doctor() {
  const checks = [];
  const exists = (p) => fs.existsSync(p);
  checks.push({ id: "mcp-entry", ok: exists(MCP), detail: MCP, remedy: exists(MCP) ? null : "reinstall: npm i -g saos-agents" });
  checks.push({ id: "setup-script", ok: exists(SETUP), detail: SETUP, remedy: exists(SETUP) ? null : "reinstall: npm i -g saos-agents" });
  let nodeOk = false, nodeVer = process.version;
  try { nodeOk = Number(process.versions.node.split(".")[0]) >= 18; } catch {}
  checks.push({ id: "node>=18", ok: nodeOk, detail: nodeVer, remedy: nodeOk ? null : "upgrade node to >=18" });
  let syntaxOk = false;
  if (exists(MCP)) { const r = spawnSync(process.execPath, ["--check", MCP], { encoding: "utf8" }); syntaxOk = r.status === 0; }
  checks.push({ id: "mcp-syntax", ok: syntaxOk, detail: syntaxOk ? "parse-ok" : "parse-FAILED", remedy: syntaxOk ? null : "corrupt install — reinstall" });
  const healthy = checks.every((c) => c.ok);
  for (const c of checks) console.log(`  [${c.ok ? "OK " : "FAIL"}] ${c.id} — ${c.detail}${c.remedy ? ` · remedy: ${c.remedy}` : ""}`);
  console.log(`\nSAOS-AGENTS doctor: healthy=${healthy ? "true" : "false"}`);
  process.exit(healthy ? 0 : 1);
}

function mcpConfig() {
  const snippet = { mcpServers: { saos: { command: "node", args: [MCP] } } };
  console.log(JSON.stringify(snippet, null, 2));
  console.log(`\n# paste into your agent's MCP config (or run: saos-agents setup --yes)`);
}

switch (cmd) {
  case "setup": {
    const args = argv.slice(1);
    const r = spawnSync(process.execPath, [SETUP, ...args], { stdio: "inherit" });
    process.exit(r.status ?? 1);
    break;
  }
  case "mcp-config": mcpConfig(); break;
  case "doctor": doctor(); break;
  default:
    console.log(`saos-agents — SAOS sovereignty gate for every agent (v0.1.0)

  saos-agents setup [--yes] [--dry-run] [--uninstall] [--json]   register the gate (plan-first; --yes to apply)
  saos-agents mcp-config                                         print the agent-ready MCP JSON snippet
  saos-agents doctor                                             fail-closed install self-check

Gate tools (6): saos_law · saos_status · saos_doctor · saos_anchors · saos_pnl · saos_join
Evidence-first · fail-closed · zero secrets in config · removes only its own entry.`);
}
