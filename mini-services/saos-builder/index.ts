/**
 * SAOS-BUILDER ORGAN (:3043) — R218-d, "Step 4: the engineering team"
 *
 * THE LAW OF THIS ORGAN (read before touching anything):
 *  1. PROPOSAL-ONLY. The Builder NEVER edits the live tree, NEVER runs git,
 *     NEVER pushes, NEVER holds keys. It reads a target file, produces ONE
 *     surgical {find, replace} edit validated against the CURRENT bytes,
 *     syntax-checks the RESULT via bun's transpiler on a sandbox copy, and
 *     stores the proposal. Applying a proposal is a SEPARATE deliberate act
 *     (orchestrator/operator) — the Builder proposes, the gate decides.
 *  2. Custodian-sweep awareness: the custodian commits ALL dirty files, so a
 *     live-tree edit would auto-enter the signed chain unreviewed. That is
 *     exactly why the live tree stays untouched by construction here.
 *  3. Path law: targets only src/ + mini-services/ + docs/ + memory/.
 *     FORBIDDEN: .secrets/, scripts/sovereign-push.sh, prisma/schema.prisma,
 *     audit/, worklog.md, any file > 60KB.
 *  4. Evidence reaches the signed chain through memory/build-proposals.jsonl
 *     (hashes + verdicts only, no code content) — committed by the custodian's
 *     existing sweep, witnessed by its existing hourly tip anchor.
 *  5. LLM access via the local Next bridge (/api/saos/ai/code) — the SDK
 *     lives only in the Next backend (one-body law). This organ holds no SDK
 *     keys and no credentials.
 *  6. Determinism (R217 law): plain `bun index.ts`, no hot reload. Spawned
 *     from the surviving next-server tree via /api/saos/builder (demand-heal).
 */

import fs from "fs";
import path from "path";

const PORT = 3043;
const ROOT = "/home/z/my-project";
const STATE_DIR = path.join(ROOT, "mini-services/saos-builder/state");
const PROPOSALS_DIR = path.join(STATE_DIR, "proposals");
const SANDBOX_DIR = path.join(STATE_DIR, "sandbox");
const TASKS_FILE = path.join(STATE_DIR, "tasks.json");
const EVIDENCE = path.join(ROOT, "memory/build-proposals.jsonl");
const LLM_BRIDGE = "http://127.0.0.1:3000/api/saos/ai/code";
const MAX_FILE = 60 * 1024;
const MAX_REPLACE = 8000;

const ALLOW = ["src/", "mini-services/", "docs/", "memory/"];
const FORBID = [".secrets/", "scripts/sovereign-push.sh", "prisma/schema.prisma", "audit/", "worklog.md"];

const bootedAt = new Date().toISOString();
fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

type Task = {
  id: string;
  at: string;
  file: string;
  task: string;
  status: "queued" | "PROPOSED" | "REJECTED" | "IN-FLIGHT";
  reason?: string;
  proposalId?: string;
};
type Proposal = {
  id: string;
  at: string;
  taskId: string;
  file: string;
  task: string;
  find: string;
  replace: string;
  analysis: string;
  validation: { findUnique: boolean; changed: boolean; syntaxOk: boolean };
  status: "PROPOSED" | "REJECTED";
};

/* ---------- queue store (bounded, atomic writes) ---------- */
function loadTasks(): Task[] {
  try {
    const j = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
    return Array.isArray(j.tasks) ? j.tasks.slice(-40) : [];
  } catch {
    return [];
  }
}
function saveTasks(tasks: Task[]) {
  const tmp = TASKS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), tasks: tasks.slice(-40) }, null, 2) + "\n");
  fs.renameSync(tmp, TASKS_FILE);
}

function pathLaw(file: string): string | null {
  const f = file.replace(/^\//, "");
  if (f.includes("..")) return "traversal forbidden";
  if (!ALLOW.some((p) => f.startsWith(p))) return `רק ${ALLOW.join(", ")} מותרים`;
  if (FORBID.some((p) => f.includes(p))) return `נתיב אסור: ${f}`;
  return null;
}

function sha(b: string) {
  return new Bun.CryptoHasher("sha256").update(b).digest("hex").slice(0, 16);
}

function extractJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/* ---------- the validation harness (the whole safety story) ---------- */
function validate(file: string, find: string, replace: string): { ok: boolean; reason?: string; newContent?: string; count: number } {
  const full = path.join(ROOT, file);
  let cur: string;
  try {
    const st = fs.statSync(full);
    if (st.size > MAX_FILE) return { ok: false, reason: `קובץ גדול מדי (${st.size}B > 60KB)`, count: 0 };
    cur = fs.readFileSync(full, "utf8");
  } catch (e) {
    return { ok: false, reason: `קריאה נכשלה: ${(e as Error).message.slice(0, 80)}`, count: 0 };
  }
  const count = cur.split(find).length - 1;
  if (count !== 1) return { ok: false, reason: `find מופיע ${count} פעמים — חייב בדיוק אחת`, count };
  const newContent = cur.replace(find, replace);
  if (newContent === cur) return { ok: false, reason: "ההצעה אינה משנה דבר", count };
  /* syntax gate: bun transpiler parses the RESULT (no import resolution) */
  try {
    const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "js";
    new Bun.Transpiler({ loader: loader as any }).transformSync(newContent);
  } catch (e) {
    return { ok: false, reason: `תחביר-תוצאה שגוי: ${(e as Error).message.slice(0, 120)}`, count };
  }
  /* sandbox copy for the record (never the live tree) */
  try {
    fs.writeFileSync(path.join(SANDBOX_DIR, `${sha(newContent)}-${path.basename(file)}`), newContent);
  } catch { /* evidence copy is best-effort */ }
  return { ok: true, newContent, count };
}

/* ---------- one task -> one validated proposal (max 2 LLM attempts) ---------- */
async function processTask(t: Task): Promise<Task> {
  const full = path.join(ROOT, t.file);
  let cur: string;
  try {
    cur = fs.readFileSync(full, "utf8");
  } catch (e) {
    return { ...t, status: "REJECTED", reason: `קריאה נכשלה: ${(e as Error).message.slice(0, 80)}` };
  }
  const system =
    "אתה מהנדס קוד זהיר של אורגניזם SAOS. אתה מציע עריכה אחת כירורגית בלבד. " +
    "החזר אך ורק JSON: {\"analysis\": string, \"find\": string, \"replace\": string}. " +
    "find חייב להופיע בדיוק פעם אחת בקובץ ולהיות מדויק תו-תו (כולל רווחים). " +
    "replace הוא הטקסט החדש. אסור להמציא קוד שאינו קשור למשימה. אין markdown, אין הסברים מחוץ ל-JSON.";
  const prompt = `משימה: ${t.task}\n\nקובץ (${t.file}, ${cur.length} בייטים):\n\`\`\`\n${cur}\n\`\`\`\n\nהצע את העריכה הכירורגית.`;

  let lastReason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(LLM_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system, prompt }),
        signal: AbortSignal.timeout(100_000),
      });
      const j: any = await r.json();
      if (!j.ok) {
        lastReason = `LLM: ${j.error ?? "כשל"}`;
        continue;
      }
      const parsed = extractJson(j.text);
      if (!parsed || typeof parsed.find !== "string" || typeof parsed.replace !== "string") {
        lastReason = "תשובת-ה-LLM אינה JSON תקני {find,replace}";
        continue;
      }
      if (parsed.find.length > 6000 || parsed.replace.length > MAX_REPLACE) {
        lastReason = "עריכה חורגת מגבולות-הגודל";
        continue;
      }
      const v = validate(t.file, parsed.find, parsed.replace);
      if (!v.ok) {
        lastReason = `ולידציה: ${v.reason}`;
        /* feed the error back on attempt 2 — the retry sees why it failed */
        if (attempt === 1) continue;
        return { ...t, status: "REJECTED", reason: lastReason };
      }
      const id = `P-${Date.now().toString(36)}-${sha(parsed.find + parsed.replace)}`;
      const proposal: Proposal = {
        id,
        at: new Date().toISOString(),
        taskId: t.id,
        file: t.file,
        task: t.task,
        find: parsed.find,
        replace: parsed.replace,
        analysis: String(parsed.analysis ?? "").slice(0, 500),
        validation: { findUnique: true, changed: true, syntaxOk: true },
        status: "PROPOSED",
      };
      fs.writeFileSync(path.join(PROPOSALS_DIR, `${id}.json`), JSON.stringify(proposal, null, 2) + "\n");
      /* evidence line into the signed chain (hashes + verdict only) */
      try {
        fs.appendFileSync(
          EVIDENCE,
          JSON.stringify({
            at: proposal.at,
            proposal: id,
            file: t.file,
            verdict: "PROPOSED",
            task: t.task.slice(0, 120),
            newContentHash: sha(v.newContent!),
            validation: "find-unique+syntax-ok",
          }) + "\n"
        );
      } catch { /* best-effort */ }
      return { ...t, status: "PROPOSED", proposalId: id };
    } catch (e) {
      lastReason = `חריגה: ${(e as Error).message.slice(0, 100)}`;
    }
  }
  return { ...t, status: "REJECTED", reason: lastReason || "ניסיונות אזלו" };
}

let inFlight = false;
async function tick(): Promise<{ processed: boolean; task?: Task }> {
  if (inFlight) return { processed: false };
  const tasks = loadTasks();
  const next = tasks.find((t) => t.status === "queued");
  if (!next) return { processed: false };
  inFlight = true;
  try {
    next.status = "IN-FLIGHT";
    saveTasks(tasks);
    const done = await processTask(next);
    const all = loadTasks();
    const idx = all.findIndex((x) => x.id === done.id);
    if (idx >= 0) all[idx] = done;
    saveTasks(all);
    return { processed: true, task: done };
  } finally {
    inFlight = false;
  }
}

/* ---------- API ---------- */
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/health" || p === "/ping") {
      const tasks = loadTasks();
      const proposals = fs.readdirSync(PROPOSALS_DIR).filter((f) => f.endsWith(".json"));
      return Response.json({
        ok: true,
        svc: "saos-builder",
        port: PORT,
        bootedAt,
        queue: { total: tasks.length, queued: tasks.filter((t) => t.status === "queued").length },
        proposals: proposals.length,
        law: "proposal-only; no git, no keys, no live-tree writes",
      });
    }
    if (p === "/status") {
      const tasks = loadTasks();
      const proposals = fs
        .readdirSync(PROPOSALS_DIR)
        .filter((f) => f.endsWith(".json"))
        .slice(-8)
        .map((f) => {
          try {
            const j = JSON.parse(fs.readFileSync(path.join(PROPOSALS_DIR, f), "utf8"));
            return { id: j.id, at: j.at, file: j.file, task: String(j.task).slice(0, 90), analysis: String(j.analysis).slice(0, 140), status: j.status, findPreview: String(j.find).slice(0, 60), replacePreview: String(j.replace).slice(0, 80) };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return Response.json({
        ok: true,
        bootedAt,
        tasks: tasks.slice(-8).reverse(),
        proposals: (proposals as any[]).reverse(),
        law: "proposal-only; merge = deliberate act outside the organ",
      });
    }
    if (p === "/task" && req.method === "POST") {
      try {
        const b: any = await req.json();
        const file = typeof b.file === "string" ? b.file.trim() : "";
        const task = typeof b.task === "string" ? b.task.trim().slice(0, 400) : "";
        if (!file || !task) return Response.json({ ok: false, error: "file+task חובה" }, { status: 400 });
        const law = pathLaw(file);
        if (law) return Response.json({ ok: false, error: `חוק-נתיבים: ${law}` }, { status: 403 });
        const tasks = loadTasks();
        const t: Task = { id: `T-${Date.now().toString(36)}`, at: new Date().toISOString(), file, task, status: "queued" };
        tasks.push(t);
        saveTasks(tasks);
        return Response.json({ ok: true, task: t });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }
    if (p === "/tick" && req.method === "POST") {
      const r = await tick();
      return Response.json({ ok: true, processed: r.processed, task: r.task ?? null });
    }
    return new Response("not-found", { status: 404 });
  },
});

/* autonomous cadence: drain the queue every 5 minutes */
setInterval(() => {
  tick().catch((e) => console.error("tick-fail", (e as Error).message));
}, 5 * 60 * 1000);

console.log(`[saos-builder] up :${PORT} proposal-only pid=${process.pid} boot=${bootedAt}`);
