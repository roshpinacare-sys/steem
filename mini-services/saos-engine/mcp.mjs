/**
 * mcp.mjs — שער-MCP של-הריבונות: כלי-אחד שכל-סוכן בעולם מדבר.
 *
 * דפוס-ההזרקה (מ-REA/morluto — "One MCP", 13,365 כוכבים): הריבונות נרשמת
 * בכל-סוכן (Claude Code, Cursor, Codex, ...) כשרת-MCP-סטנדרטי על-stdio.
 * JSON-RPC 2.0 · protocolVersion 2024-11-05 · אפס-dependencies · אפס-סודות.
 *
 * כלים (read-only, fail-closed, ראיות-קודם):
 *   saos_law      — חוקי-הפתיחה (AGENTS.md) + חוק-אי-האמון-בסנדבוקס
 *   saos_status   — /status חי של-המנוע (או כנות: offline + remedy)
 *   saos_doctor   — פסק-כשירות מדוד (doctor.mjs)
 *   saos_anchors  — עוגני-custody אחרונים מ-state (ראיות-שרשרת, מנוקה-סודות)
 *   saos_join     — איך סוכן-חדש מצטרף לגוף (bootstrap, ענף, שער-דחיפה)
 *
 * RUN (דוגמת-רישום לסוכן):
 *   { "command": "bun", "args": ["mini-services/saos-engine/mcp.mjs"], "cwd": "<repo-root>" }
 */

import path from "node:path";
import { readFile } from "node:fs/promises";
import { runDoctor } from "./doctor.mjs";

export const SERVER_INFO = { name: "saos-mcp", version: "1.0.0" };
export const PROTOCOL_VERSION = "2024-11-05";

/* ── pure: היגיינת-סודות — שום-כלי לעולם לא מוציא חומר-מפתח, בשום-פורמט */
export function scrubText(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/\b5[HJK][1-9A-HJ-NP-Za-km-z]{46,51}\b/g, "[REDACTED-WIF]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED-PAT]")
    .replace(/ghp_[A-Za-z0-9]{20,}/g, "[REDACTED-TOKEN]")
    .replace(/gho_[A-Za-z0-9]{20,}/g, "[REDACTED-TOKEN]")
    .replace(/\b(P\d{1,2})\b\/[A-Za-z0-9._-]{6,}/g, "$1/[REDACTED]");
}

/* ── pure: קטלוג-הכלים (inputSchema מלא לכל-כלי — חוזה-MCP) */
export function toolCatalog() {
  return [
    {
      name: "saos_law",
      description: "חוקי-הפתיחה-החובה של-הריבונות (AGENTS.md + חוק-אי-האמון-בסנדבוקס). חובה לפני כל-פעולה.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "saos_status",
      description: "מצב-חי של-המנוע (:3040) — parity, band, inventory, orders. כנות fail-closed כשהמנוע לא-נגיש.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "saos_doctor",
      description: "פסק-כשירות מדוד (scope: git/selftest/engine/actions/chain/all) — structured, remedy ניתן-לפעולה.",
      inputSchema: { type: "object", properties: { scope: { type: "string", enum: ["git", "selftest", "engine", "actions", "chain", "all"], default: "all" } }, additionalProperties: false },
    },
    {
      name: "saos_anchors",
      description: "עוגני-custody אחרונים מ-state (custodian/head) — ראיות-שרשרת. אין-סודות (scrubbed).",
      inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20, default: 5 } }, additionalProperties: false },
    },
    {
      name: "saos_join",
      description: "איך סוכן-חדש מצטרף לגוף-הריבוני: bootstrap מהגיט, ענף-האמת, שער-הדחיפה, חוקי-החתימה.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "saos_pnl",
      description: "מדידת-תשואה-ציבורית (דפוס-Alpha-Arena): מדוד-מול-מוערך מופרדים-בברזל, תיוג-אמון לכל-מסילה; stale/blocked = כנות fail-closed, אין-המצאת-מספרים.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

/* ── pure: מנוע-JSON-RPC עם-כלים-מוזרקים (ה-selftest מריץ אופליין-טהור) */
export function makeHandler(tools) {
  return async function handle(msg) {
    if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
      return { id: null, error: { code: -32600, message: "invalid request" } };
    }
    const { id, method } = msg;
    const respond = (result) => ({ id, result });
    const rpcError = (code, message) => ({ id, error: { code, message } });

    switch (method) {
      case "initialize":
        return respond({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
      case "ping":
        return respond({});
      case "notifications/initialized":
      case "notifications/cancelled":
        return null; // התראה: אין-תשובה (חוזה-JSON-RPC)
      case "tools/list":
        return respond({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const name = msg?.params?.name;
        const args = msg?.params?.arguments ?? {};
        const tool = tools.find((t) => t.name === name);
        if (!tool) return rpcError(-32601, `unknown tool: ${String(name)}`);
        try {
          const out = await tool.run(args);
          return respond({ content: [{ type: "text", text: scrubText(typeof out === "string" ? out : JSON.stringify(out, null, 2)) }] });
        } catch (e) {
          // fail-closed-כנה: שגיאה = תוצאה-ישרה עם-remedy, לעולם לא זריקה-חוצה
          return respond({ content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2) }], isError: true });
        }
      }
      default:
        return rpcError(-32601, `unknown method: ${method}`);
    }
  };
}

/* ── מימושי-הכלים (עם-פרובות-מוזרקות ל-selftest) */
export function makeTools({ readFile_ = readFile, http_ = null, engineRoot = process.env.SAOS_ENGINE_ROOT ?? path.dirname(new URL(import.meta.url).pathname), repoRoot = process.env.SAOS_REPO_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..") } = {}) {
  const http = http_ || (async (url, ms = 2500) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  });

  const readRepoFile = async (rel) => readFile_(path.join(repoRoot, rel), "utf8");

  return {
    saos_law: async () => {
      const law = await readRepoFile("AGENTS.md").catch(() => "AGENTS.md missing — חקור");
      const distrust = await readRepoFile("docs/SANDBOX-DISTRUST-LAW.md").catch(() => "");
      return { law, distrust: distrust.slice(0, 4000) };
    },
    saos_status: async () => {
      try {
        const body = await http("http://127.0.0.1:3040/status");
        return { ok: true, engine: body };
      } catch (e) {
        return { ok: false, reason: "engine-offline", detail: String(e?.message || e), remedy: "הרץ את מנוע-הריבונות או המשך keyless בהתאם-למשימה" };
      }
    },
    saos_doctor: async (args) => runDoctor({ scope: args?.scope || "all" }),
    saos_anchors: async (args) => {
      const limit = Math.min(Math.max(parseInt(args?.limit, 10) || 5, 1), 20);
      const cust = await readFile_(path.join(engineRoot, "state", "custodian.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!cust) return { ok: false, reason: "no-custody-state", remedy: "העוגן-מתוחזק על-ידי ה-custodian; ריצה-חיה: node scripts/chain-anchor-probe.mjs" };
      return { ok: true, head: cust.head, at: cust.at, divergenceExit: cust.divergenceExit, probe: "node scripts/chain-anchor-probe.mjs — אמת-מצומת-ציבורי" };
    },
    saos_pnl: async () => {
      const { buildPublicPnl } = await import("./pnl-public.mjs");
      const readJson = (p) => readFile_(p, "utf8").then(JSON.parse).catch(() => null);
      const observe = await readJson(path.join(engineRoot, "state", "observe.json"));
      const economics = await readJson(path.join(engineRoot, "state", "economics.json"));
      const custodian = await readJson(path.join(engineRoot, "state", "custodian.json"));
      return buildPublicPnl({ observe, economics, custodian });
    },
    saos_join: async () => ({
      truth: "הגיט הוא האמת. הסנדבוקס הוא מטמון-נמחק.",
      bootstrap: "bash scripts/sovereign-bootstrap.sh",
      session_open: [
        "git fetch origin saos-cockpit && git reset --hard origin/saos-cockpit",
        "bash scripts/divergence-check.sh   # חייב 0/0",
        "node mini-services/saos-engine/selftest.mjs   # חייב N/N PASS",
      ],
      push_law: "scripts/sovereign-push.sh — FF-only, לעולם לא force; דחייה = עצור ותעד",
      branch: "saos-cockpit (לעולם לא main, לעולם לא כתיבה למאגר steem כענף-יעד)",
      dead_soldiers: "חוק T-80: חשבונות-ללא-custody מאומת = קפואים מבנית. אל תפעיל, אל תממן.",
      read_first: "AGENTS.md",
    }),
  };
}

/* ── stdio-רץ: שורה-אחת-JSON ל-request, שורה-אחת-JSON ל-response */
const isMain = process.argv[1] && process.argv[1].endsWith("mcp.mjs");
if (isMain) {
  const handle = makeHandler(Object.entries(makeTools()).map(([name, run]) => {
    const cat = toolCatalog().find((t) => t.name === name);
    return { name, description: cat.description, inputSchema: cat.inputSchema, run };
  }));
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch { msg = { id: null, method: "__malformed__" }; }
      handle(msg)
        .then((res) => { if (res !== null) process.stdout.write(JSON.stringify(res) + "\n"); })
        .catch((e) => process.stdout.write(JSON.stringify({ id: msg?.id ?? null, error: { code: -32603, message: scrubText(String(e?.message || e)) } }) + "\n"));
    }
  });
  process.stdin.resume();
}
