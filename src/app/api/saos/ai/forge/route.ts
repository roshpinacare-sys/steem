import { NextResponse } from "next/server";
import { guardAiBridge, shieldReject } from "@/lib/exposureShield";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-40 · FORGE BRIDGE (engine-called, backend-only law — T-35 shield).
 * One step of the forge loop: the engine sends the LINEAR history
 * (mini-swe-agent law: trajectory == messages) + the task; the LLM returns
 * STRICT JSON — either {"thought","command"} (one bash action) or
 * {"finish":true,"summary"}. The bridge NEVER executes anything — the
 * engine's bashGuard classifies, the gates decide, git is harness-only.
 * The model proposes, the machine disposes.
 */
const SYSTEM_PROMPT = `You are the forge agent of a sovereign autonomous machine that is engineering its own repository. You get the full linear conversation history each step.
HARD LAWS (violations are blocked by the engine's guard and waste steps):
- Exactly ONE shell command per step, as a plain string. No command substitution, no backticks, no pipes into interpreters.
- Read before you write: inspect files/dirs first, then act with small diffs.
- New files ONLY under mini-services/saos-engine/skills/forge/ or docs/.
- Editing existing tracked files is allowed. Never touch state/, .secrets/, node_modules/, .git/.
- Never: network access, package installs, running interpreters, git add/commit/push/restore/reset — those are the harness's verbs.
- Write files with heredocs: cat > path <<'EOF' ... EOF (relative paths inside the repo).
- If a command is blocked, treat the observation as law and adapt — never repeat the blocked command.
- When the task is done and verified, finish.
Output STRICT JSON only, no markdown fences, no prose outside JSON:
step: {"thought":"one short line of reasoning","command":"one shell command"}
done: {"finish":true,"summary":"what you built/changed and how you verified it"}`;

type HistMsg = { role?: string; content?: string };

export async function POST(req: Request) {
  /* T-35 EXPOSURE SHIELD: same-origin (browser) or token-carried (engine) only */
  const refused = shieldReject(guardAiBridge(req));
  if (refused) return refused;
  let body: { task?: unknown; head?: unknown; history?: unknown; laws?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const task = String(body.task ?? "").slice(0, 600);
  const head = String(body.head ?? "").slice(0, 16);
  const laws = Array.isArray(body.laws) ? body.laws.map(String).slice(0, 12) : [];
  const rawHist = Array.isArray(body.history) ? (body.history as HistMsg[]) : [];
  if (!task) return NextResponse.json({ ok: false, error: "task required" }, { status: 400 });
  if (rawHist.length === 0) return NextResponse.json({ ok: false, error: "history required" }, { status: 400 });

  /* linear history → SDK messages (system-law as assistant role, the same
   * convention the content/digest bridges use; observations ride as user) */
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of rawHist.slice(0, 40)) {
    const c = String(m?.content ?? "").slice(0, 8_000);
    if (!c) continue;
    const role = m?.role === "system" ? "assistant" : m?.role === "observation" ? "user" : m?.role === "assistant" ? "assistant" : "user";
    const content = m?.role === "observation" ? `OBSERVATION (result of your last command):\n${c}` : c;
    messages.push({ role, content });
  }
  if (laws.length) messages.push({ role: "user", content: `Standing laws reminder:\n${laws.map((l) => `- ${l}`).join("\n")}` });
  messages.push({ role: "user", content: `TASK: ${task}\nREPO HEAD: ${head}\nReturn STRICT JSON for the NEXT single step.` });

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [{ role: "assistant", content: SYSTEM_PROMPT }, ...messages],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const step = parseStep(raw);
    if (!step) return NextResponse.json({ ok: false, error: "unparseable forge step", raw: raw.slice(0, 400) }, { status: 502 });
    return NextResponse.json({ ok: true, step, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 160), fallback: "no failover rail for forge (by law — the loop stops typed, the task returns)" }, { status: 502 });
  }
}

/* strict-JSON step parse — same balanced-brace discipline as parseDrafts
 * (T-34 hardening: strip fences AND scan every balanced {...} block). */
function parseStep(raw: string): { thought?: string; command?: string; finish?: boolean; summary?: string } | null {
  const stripped = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
  const candidates: string[] = [stripped];
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) { candidates.push(stripped.slice(start, i + 1)); start = -1; }
    }
  }
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as { thought?: unknown; command?: unknown; finish?: unknown; summary?: unknown };
      if (j.finish === true) return { finish: true, summary: String(j.summary ?? "").slice(0, 500) };
      if (typeof j.command === "string" && j.command.trim()) {
        return { thought: String(j.thought ?? "").slice(0, 300), command: j.command.slice(0, 4_000) };
      }
    } catch { /* next candidate */ }
  }
  return null;
}
