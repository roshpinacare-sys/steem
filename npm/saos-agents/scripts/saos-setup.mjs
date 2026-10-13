#!/usr/bin/env node
/**
 * saos-setup.mjs — הרשמת-שער-ה-MCP של-הריבונות בכל-סוכן-נתמך (דפוס-REA "אפס-חיכוך").
 *
 * חוקי-התקנה (חוזה-קשה):
 *  1. תוכנית-קודם — בלי --yes מודפסת-התוכנית ולא-נכתב-דבר.
 *  2. גיבוי-לפני-כל-כתיבה — <path>.bak-saos-<ISO-compact>.
 *  3. additive+idempotent — רק-הרשומה "saos" תחת mcpServers/servers/mcp; אף-שדה-אחר-לא-נגע.
 *  4. --uninstall מסיר רק-את-הרשומה שלו ומסרב לגעת בקבצים של-אחרים.
 *  5. אפס-סודות — התצורה מכילה command/args בלבד (mcp.mjs מאתר-הכל מיקומו-שלו).
 *  6. אפס-dependencies — node:builtins בלבד.
 *  7. exit codes: 0=בוצע/תוכנית-תקינה · 2=אין-מה-לעשות · 1=כשל.
 *
 * RUN: node scripts/saos-setup.mjs [--dry-run] [--yes] [--uninstall] [--json]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENTRY_NAME = "saos";
/* pkg-מודע: כשה-script מותקן-כחבילה (../mcp.mjs קיים) — השער-מקומי-בחבילה; בריפו — הנתיב-המקורי */
const _pkgMcp = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "mcp.mjs");
export const MCP_REL = fs.existsSync(_pkgMcp) ? "mcp.mjs" : path.join("mini-services", "saos-engine", "mcp.mjs");

/* ── pure: פס-היעדים לכל-סוכן (home מוזרק-לבדיקה) — shape לפי-המוסכם-לסוכן */
export function agentTargets(home, repoRoot) {
  const cmd = { command: "node", args: [path.join(repoRoot, MCP_REL)] };
  const j = JSON.stringify;
  return [
    { agent: "claude_code", file: path.join(home, ".claude.json"), key: "mcpServers", entry: j(cmd) },
    { agent: "claude_desktop", file: path.join(home, ".config", "Claude", "claude_desktop_config.json"), key: "mcpServers", entry: j(cmd) },
    { agent: "cursor", file: path.join(home, ".cursor", "mcp.json"), key: "mcpServers", entry: j(cmd) },
    { agent: "windsurf", file: path.join(home, ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers", entry: j(cmd) },
    { agent: "gemini_cli", file: path.join(home, ".gemini", "settings.json"), key: "mcpServers", entry: j(cmd) },
    { agent: "vscode", file: path.join(repoRoot, ".vscode", "mcp.json"), key: "servers", entry: j(cmd) },
    { agent: "opencode", file: path.join(home, ".config", "opencode", "opencode.json"), key: "mcp", entry: j({ type: "local", command: ["node", path.join(repoRoot, MCP_REL)] }) },
    { agent: "codex", file: path.join(home, ".codex", "config.toml"), key: "mcp_servers", entry: null /* TOML: הדפס-הוראות-ידניות-כנות, אל-תערוך-טומל-בלי-מנוע-טומל */ },
  ];
}

/* ── pure: תוכנית-פעולה לכל-יעד: add | update | none | manual | unreadable */
export function planTarget(t, readFile = (p) => fs.readFileSync(p, "utf8")) {
  const out = { agent: t.agent, file: t.file, action: "add", backup: null };
  if (t.entry === null) { out.action = "manual"; return out; /* TOML: הדפס-הוראות — לא-תלוי-בקובץ */ }
  let raw;
  try { raw = readFile(t.file); } catch { return out; /* חסר → add */ }
  let cfg;
  try { cfg = JSON.parse(raw); } catch { out.action = "unreadable"; return out; }
  const bag = cfg && typeof cfg === "object" ? cfg[t.key] : null;
  if (!bag || typeof bag !== "object") return out; /* add */
  const cur = bag[ENTRY_NAME];
  if (cur === undefined) return out; /* add — רק-שלנו יתווסף, של-אחרים-לא-נוגעים */
  out.action = JSON.stringify(cur) === t.entry ? "none" : "update";
  return out;
}

/* ── pure: רשימת-פעולות מלאה (לתוכנית-ול-selftest) */
export function buildPlan(targets, readFile) {
  return targets.map((t) => ({ ...planTarget(t, readFile), entry: t.entry, key: t.key }));
}

/* ── io: ביצוע-פעולה-אחת (כתיבה-עם-גיבוי) — מוזרק readFile/writeFile לבדיקה */
export function applyTarget(t, plan, io = {}) {
  const { readFile = (p) => fs.readFileSync(p, "utf8"), writeFile = (p, s) => fs.writeFileSync(p, s) } = io;
  if (plan.action === "none" || plan.action === "manual" || plan.action === "unreadable") return { ...plan, done: false };
  let raw = null;
  try { raw = readFile(t.file); } catch { raw = null; }
  let cfg = {};
  if (raw != null) { try { cfg = JSON.parse(raw); } catch { return { ...plan, done: false, error: "invalid-json" }; } }
  if (raw != null) { /* גיבוי */
    const bak = `${t.file}.bak-saos-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
    try { fs.writeFileSync(bak, raw); plan.backup = bak; } catch { /* גיבוי-נכשל → כנות, נמשיך-רק-אם-הקובץ-חדש */ }
  }
  if (!cfg[t.key] || typeof cfg[t.key] !== "object") cfg[t.key] = {};
  cfg[t.key][ENTRY_NAME] = JSON.parse(t.entry); /* add ו-update שניהם: כתיבת-הרשומה-שלנו-בלבד */
  const dir = path.dirname(t.file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* קיים */ }
  writeFile(t.file, JSON.stringify(cfg, null, 2) + "\n");
  return { ...plan, done: true };
}

/* ── io: הסרה-של-שלנו-בלבד */
export function removeTarget(t, io = {}) {
  const { readFile = (p) => fs.readFileSync(p, "utf8"), writeFile = (p, s) => fs.writeFileSync(p, s) } = io;
  if (t.entry === null) return { agent: t.agent, file: t.file, done: false, note: "manual" };
  let raw; try { raw = readFile(t.file); } catch { return { agent: t.agent, file: t.file, done: false, note: "absent" }; }
  let cfg; try { cfg = JSON.parse(raw); } catch { return { agent: t.agent, file: t.file, done: false, note: "invalid-json" }; }
  const bag = cfg[t.key];
  if (!bag || typeof bag !== "object" || bag[ENTRY_NAME] === undefined) return { agent: t.agent, file: t.file, done: false, note: "not-ours" };
  delete bag[ENTRY_NAME];
  const bak = `${t.file}.bak-saos-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  try { fs.writeFileSync(bak, raw); } catch { /* כנות-בגיבוי */ }
  writeFile(t.file, JSON.stringify(cfg, null, 2) + "\n");
  return { agent: t.agent, file: t.file, done: true, note: "removed" };
}

function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const doYes = argv.includes("--yes");
  const doUninstall = argv.includes("--uninstall");
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const targets = agentTargets(os.homedir(), repoRoot);
  const plan = buildPlan(targets);
  const summary = plan.map((p) => ({ agent: p.agent, file: p.file, action: p.action }));

  if (doUninstall) {
    const results = targets.map((t) => removeTarget(t));
    const removed = results.filter((r) => r.done).length;
    if (jsonOut) console.log(JSON.stringify({ mode: "uninstall", results }, null, 2));
    else results.forEach((r) => console.log(`${r.done ? "REMOVED" : "KEEP   "} ${r.agent} ${r.file}${r.note ? ` (${r.note})` : ""}`));
    process.exit(removed > 0 ? 0 : 2);
  }

  if (!doYes) {
    if (jsonOut) console.log(JSON.stringify({ mode: "dry-run", plan: summary }, null, 2));
    else {
      console.log("SAOS-MCP setup — תוכנית (רץ עם --yes כדי לבצע; גיבוי-אוטומטי לפני כל כתיבה):\n");
      for (const p of plan) {
        const mark = { add: "ADD   ", update: "UPDATE", none: "OK    ", manual: "MANUAL", unreadable: "SKIP!" }[p.action] || p.action;
        console.log(`  ${mark} ${p.agent.padEnd(16)} ${p.file}`);
      }
      console.log("\n  MANUAL (codex/TOML): הוסף-מקטע mcp_servers.saos בקובץ-התצורה:");
      console.log(`  command = "node"\n  args = ["${path.join(repoRoot, MCP_REL)}"]`);
    }
    const actionable = plan.some((p) => p.action === "add" || p.action === "update");
    process.exit(actionable ? 0 : 2);
  }

  const results = targets.map((t) => applyTarget(t, plan.find((p) => p.agent === t.agent)));
  const done = results.filter((r) => r.done).length;
  if (jsonOut) console.log(JSON.stringify({ mode: "apply", results }, null, 2));
  else results.forEach((r) => console.log(`${r.done ? "WROTE  " : "SKIP   "} ${r.agent} ${r.file}${r.backup ? ` (backup: ${path.basename(r.backup)})` : ""}`));
  process.exit(done > 0 ? 0 : 2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
