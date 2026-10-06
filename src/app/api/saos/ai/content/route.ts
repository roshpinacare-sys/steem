import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-22 · CONTENT-OPS BRIDGE (engine-called, backend-only law).
 * The engine's content team calls this route every 12h with its own measured
 * telemetry + the web-intel findings; the LLM drafts discussion topics under
 * an EXPOSURE LAW (no coordinated-account revelation, no financial advice,
 * supportive community tone, SEO-aware). The engine re-checks every draft in
 * pure code (content.sanitizeDraft) — this bridge drafts, the engine decides.
 */
const SYSTEM_PROMPT = `You are a careful content strategist for a blockchain-technology research initiative that publishes on the Steem community.
HARD LAW (violations make a draft unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation collectives, internal codenames, or that any accounts are connected. Write as an independent author.
- No financial advice, no profit promises, no price predictions or targets, no solicitation.
- Supportive public-knowledge tone: teach, ask, answer. Welcome newcomers.
- SEO-aware: concrete self-standing title, first paragraph must stand alone, natural topical keywords, no keyword stuffing.
- Grounded: build ONLY on the telemetry/findings provided; when citing facts, keep them general and verifiable — never invent numbers.
Output STRICT JSON only, no markdown fences:
{"drafts":[{"title":"...","body":"...","tags":["tag1","tag2"],"angle":"...","seoNote":"...","groundedOn":["..."]}]}`;

export async function POST(req: Request) {
  let body: { findings?: unknown; telemetry?: unknown; exposureLaw?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const findings = Array.isArray(body.findings) ? body.findings.slice(0, 8) : [];
  const telemetry = body.telemetry && typeof body.telemetry === "object" ? body.telemetry : {};
  const law = Array.isArray(body.exposureLaw) ? body.exposureLaw : [];
  /* T-87: day-seeded angle rotation from the engine — each draft takes one */
  const angles = Array.isArray(body.angles)
    ? body.angles.map((a) => String(a).slice(0, 60)).filter(Boolean).slice(0, 3)
    : [];

  const userPrompt = [
    "Draft 3 distinct discussion-post ideas for a blockchain community (Steem).",
    "Each: engaging title (≤100 chars), body 180-350 words, 3-5 lowercase hyphenated tags.",
    "Angle must differ across drafts (e.g. educational explainer / open question / tooling-or-workflow tip).",
    ...(angles.length
      ? ["THIS ROUND'S ANGLE ROTATION (draft #1, #2, #3 take these angles IN ORDER):", ...angles.map((a, i) => `${i + 1}. ${a}`), ""]
      : []),
    "",
    "EXPOSURE LAW (hard):",
    ...(law.length ? law.map((l) => `- ${l}`) : []),
    "",
    "EXTERNAL FINDINGS (sourced context you may reference generally):",
    findings.map((f) => `- ${(f as { title?: string })?.title ?? "?"} (${(f as { host?: string })?.host ?? "?"})`).join("\n") || "- none this round",
    "",
    "MACHINE TELEMETRY (measured, general facts you may discuss WITHOUT internal details):",
    JSON.stringify(telemetry).slice(0, 800),
    "",
    "Return STRICT JSON only.",
  ].join("\n");

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let drafts: unknown = [];
    try {
      const parsed = JSON.parse(jsonText);
      drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    } catch {
      return NextResponse.json({ ok: false, error: "unparseable LLM output", raw: raw.slice(0, 400) }, { status: 502 });
    }
    return NextResponse.json({ ok: true, drafts, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
