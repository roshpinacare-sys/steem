import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R218-d · LLM CODE BRIDGE (backend-only law).
 * The builder organ (:3043) speaks HTTP to this route; the z-ai-web-dev-sdk
 * stays exclusively in the Next backend (same doctrine as T-22 webintel).
 * One body, one language: this route only speaks "chat".
 */
export async function POST(req: Request) {
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
}
