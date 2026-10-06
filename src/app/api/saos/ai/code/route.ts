import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R218-d · LLM CODE BRIDGE (backend-only law).
 * The builder organ (:3043) speaks HTTP to this route; the z-ai-web-dev-sdk
 * stays exclusively in the Next backend (same doctrine as T-22 webintel).
 * One body, one language: this route only speaks "chat".
 *
 * R220 hardening (operator order "תתקן הכל בכל זאת"): the route is reachable
 * from the operator preview, so it now carries its own honest bounds —
 * a sliding-window rate limit + an in-flight cap. In-memory (resets on
 * process restart) is deliberate: this is abuse dampening, not accounting.
 * Rejected callers get 429 with a truthful reason, never a fake success.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12; /* the builder drains 1 task/~5min; 12/min is generous headroom */
const MAX_INFLIGHT = 2; /* LLM round-trips are heavy — cap concurrent calls */

let windowStart = 0;
let windowCount = 0;
let inflight = 0;

function rateLimited(): { limited: boolean; reason: string } {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (inflight >= MAX_INFLIGHT) return { limited: true, reason: "busy — קריאת-LLM בעיצומה, נסו שוב בעוד רגע" };
  if (windowCount >= MAX_PER_WINDOW) return { limited: true, reason: `rate-limit — מקסימום ${MAX_PER_WINDOW} קריאות/דק` };
  return { limited: false, reason: "" };
}

export async function POST(req: Request) {
  const rl = rateLimited();
  if (rl.limited) {
    return NextResponse.json({ ok: false, error: rl.reason, verdict: "RATE-LIMITED" }, { status: 429 });
  }
  windowCount++;
  inflight++;
  try {
    let body: { system?: unknown; prompt?: unknown; temperature?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      /* empty body handled below */
    }
    const system = typeof body.system === "string" ? body.system.slice(0, 4000) : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 60_000) : "";
    if (prompt.length < 5) {
      return NextResponse.json({ ok: false, error: "prompt missing" }, { status: 400 });
    }
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const res = await zai.chat.completions.create({
        messages: [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          { role: "user" as const, content: prompt },
        ],
        temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
      });
      const text = res?.choices?.[0]?.message?.content ?? null;
      if (!text) throw new Error("empty completion");
      return NextResponse.json({ ok: true, text, at: new Date().toISOString() });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: (e as Error).message.slice(0, 300) },
        { status: 502 }
      );
    }
  } finally {
    inflight--;
  }
}
