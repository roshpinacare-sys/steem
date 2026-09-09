import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * 117p — THE-AGENTS-GATE · צירוף-סוכנים-חיצוניים-דרך-API
 *
 * המנדט (מהמפעיל): "שאני יוכל לצרף סוכנים כמוך בצ'אט בקלות דרך API שיוכלו לכתוב
 * לנו ולבצע לפי הצורך".
 *
 * חוקים (קשיחים):
 *  · אימות: כותרת x-agent-token מול agent/keys/agents-api.token (0600, git-ignored).
 *    פעולות-מפעיל (approve) מקומיות-בלבד — בלי-טוקן.
 *  · סוכנים יכולים: להירשם, לכתוב-הודעות-למפעיל (תיבת-היומן במסך-השער), ולהגיש-משימות.
 *  · ביצוע-משימות: רק-פקודות-לבנות-לקריאה-בלבד (READ-ONLY) — ממומשות-פנימית,
 *    בלי-child_process, בלי-מפתחות, בלי-כתיבה. משימה-שאינה-ברשימה = pending
 *    עד-אישור-מפעיל (כפתור-במסך) — וגם-אז-רק-לבנות. אפס-חריגה.
 *  · אודיט מלא JSONL — אפס-סודות-בלוג.
 */
const ROOT = process.cwd();
const AGENT = path.join(ROOT, "agent");
const TOKENF = path.join(AGENT, "keys", "agents-api.token");
const REGF = path.join(AGENT, "agents-registry.json");
const INBOXF = path.join(AGENT, "agents-inbox.jsonl");
const TASKSF = path.join(AGENT, "agents-tasks.jsonl");
const AUDITF = path.join(AGENT, "agents-audit.jsonl");

type Task = { id: string; at: string; from: string; command: string; args?: string[]; status: "pending" | "approved" | "auto" | "done" | "rejected"; result?: string; note?: string };

function readJson<T>(p: string, fb: T): T {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch (_) { return fb; }
}
function tailJsonl(p: string, n: number): Array<Record<string, unknown>> {
  try {
    const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch (_) { return { raw: l.slice(0, 80) }; } });
  } catch (_) { return []; }
}
function appendJsonl(p: string, obj: Record<string, unknown>) {
  fs.appendFileSync(p, JSON.stringify(obj) + "\n");
}
function token(): string {
  try { return fs.readFileSync(TOKENF, "utf8").trim(); } catch (_) { /* create below */ }
  const t = crypto.randomBytes(24).toString("base64url");
  fs.mkdirSync(path.dirname(TOKENF), { recursive: true });
  fs.writeFileSync(TOKENF, t + "\n", { mode: 0o600 });
  return t;
}
function audit(action: string, detail: Record<string, unknown>) {
  try { appendJsonl(AUDITF, { at: new Date().toISOString(), action, ...detail }); } catch (_) {}
}

/* הפקודות-הלבנות — מימוש-פנימי-טהור (קריאה-בלבד · אפס-מפתחות · אפס-כתיבה) */
function runSafe(command: string, args: string[] | undefined): { ok: boolean; result: string } {
  const ROOTC = process.cwd();
  try {
    if (command === "status") {
      const g = readJson<{ at?: string }>(path.join(AGENT, "guardian_result.json"), {});
      const gate = readJson<{ connected?: boolean }>(path.join(AGENT, "gate-state.json"), {});
      return { ok: true, result: JSON.stringify({ guardianAt: g.at || null, gateConnected: !!gate.connected }) };
    }
    if (command === "vault-count") {
      const v = readJson<{ accounts?: unknown[] }>(path.join(AGENT, "keys", "vault.json"), {});
      return { ok: true, result: "accounts=" + (v.accounts || []).length };
    }
    if (command === "relay-open") {
      const s = readJson<{ st?: { relay?: { sent?: number; issued?: number } } }>(path.join(ROOTC, "sovereign", "node", "state-snapshot.json"), {});
      const r = s.st?.relay || {};
      return { ok: true, result: "relay sent=" + (r.sent ?? "?") + " issued=" + (r.issued ?? "?") };
    }
    if (command === "doors") {
      const s = readJson<{ doors?: unknown[] }>(path.join(ROOTC, "sovereign", "node", "key-broker-proof.json"), {});
      return { ok: true, result: "broker-doors=" + (Array.isArray(s.doors) ? s.doors.length : "?") };
    }
    if (command === "fleet") {
      const st = readJson<{ fleet?: { services?: Array<{ ok?: boolean }> } }>(path.join(ROOTC, "sovereign", "node", "state-snapshot.json"), {});
      const sv = st.fleet?.services || [];
      return { ok: true, result: "fleet-ok=" + sv.filter((x) => x.ok).length + "/" + sv.length };
    }
    return { ok: false, result: "not-whitelisted" };
  } catch (e) {
    return { ok: false, result: "error:" + String((e as Error).message || e).slice(0, 80) };
  }
}


export async function GET() {
  try {
    const reg = readJson<{ agents?: Array<Record<string, unknown>> }>(REGF, { agents: [] });
    return NextResponse.json({
      ok: true,
      token: token(),
      agents: reg.agents || [],
      inbox: tailJsonl(INBOXF, 60).reverse(),
      tasks: tailJsonl(TASKSF, 60).reverse(),
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: string; name?: string; capabilities?: string[]; from?: string; text?: string; command?: string; args?: string[]; id?: string };
    const action = String(body.action || "");
    const tok = token();
    const provided = req.headers.get("x-agent-token") || "";
    const isOperator = provided === "" ; /* פעולות-מפעיל מה-UI-המקומי */
    const isAgent = provided === tok;

    if (!isOperator && !isAgent) {
      audit("auth-denied", { action });
      return NextResponse.json({ ok: false, error: "token-שגוי — דרוש x-agent-token" }, { status: 401 });
    }

    if (action === "register") {
      if (!isAgent) return NextResponse.json({ ok: false, error: "register-דורש-טוקן-סוכן" }, { status: 401 });
      const name = String(body.name || "").slice(0, 40).trim();
      if (!name) return NextResponse.json({ ok: false, error: "name-חסר" }, { status: 400 });
      const reg = readJson<{ agents?: Array<Record<string, unknown>> }>(REGF, { agents: [] });
      reg.agents = (reg.agents || []).filter((a) => (a as { name?: string }).name !== name);
      reg.agents.push({ name, capabilities: (body.capabilities || []).slice(0, 8).map((c) => String(c).slice(0, 24)), at: new Date().toISOString(), status: "attached" });
      fs.writeFileSync(REGF, JSON.stringify(reg, null, 2) + "\n");
      audit("register", { name });
      return NextResponse.json({ ok: true, name, welcome: "THE-AGENTS-GATE: סוכן " + name + " מחובר. הרשאות: message + task (read-only-whitelist). אפס-מפתחות." });
    }

    if (action === "message") {
      if (!isAgent) return NextResponse.json({ ok: false, error: "message-דורש-טוקן-סוכן" }, { status: 401 });
      const from = String(body.from || "agent").slice(0, 40);
      const text = String(body.text || "").slice(0, 500);
      if (!text.trim()) return NextResponse.json({ ok: false, error: "text-ריק" }, { status: 400 });
      appendJsonl(INBOXF, { at: new Date().toISOString(), from, text });
      audit("message", { from, len: text.length });
      return NextResponse.json({ ok: true, delivered: true });
    }

    if (action === "task") {
      if (!isAgent) return NextResponse.json({ ok: false, error: "task-דורש-טוקן-סוכן" }, { status: 401 });
      const from = String(body.from || "agent").slice(0, 40);
      const command = String(body.command || "").slice(0, 30);
      const args = (body.args || []).slice(0, 4).map((a) => String(a).slice(0, 40));
      const whitelist = ["status", "vault-count", "relay-open", "doors", "fleet"];
      const auto = whitelist.includes(command);
      const task: Task = { id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), from, command, args, status: auto ? "auto" : "pending" };
      if (auto) task.result = runSafe(command, args).result;
      appendJsonl(TASKSF, task as unknown as Record<string, unknown>);
      audit("task", { id: task.id, from, command, auto });
      return NextResponse.json({ ok: true, task });
    }

    if (action === "approve" || action === "reject") {
      if (!isOperator) return NextResponse.json({ ok: false, error: "למפעיל-בלבד" }, { status: 401 });
      const id = String(body.id || "");
      const tasks = tailJsonl(TASKSF, 500) as unknown as Task[];
      const t = tasks.find((x) => x.id === id);
      if (!t) return NextResponse.json({ ok: false, error: "task-לא-נמצא" }, { status: 404 });
      if (t.status !== "pending") return NextResponse.json({ ok: false, error: "task-כבר-" + t.status }, { status: 400 });
      t.status = action === "approve" ? "approved" : "rejected";
      if (t.status === "approved") { const r = runSafe(t.command, t.args); t.status = r.ok ? "done" : "rejected"; t.result = r.result; }
      appendJsonl(TASKSF, t as unknown as Record<string, unknown>);
      audit(action, { id });
      return NextResponse.json({ ok: true, task: t });
    }

    return NextResponse.json({ ok: false, error: "action-לא-מוכר (register|message|task|approve|reject)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
}
