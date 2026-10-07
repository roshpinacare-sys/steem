import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R240 · CONTENT-INTELLIGENCE BRIDGE (engine-called, backend-only law).
 * Rewritten after the operator's verdict on the feed: "זה ממש לא מעניין מה
 * שאנחנו שולחים" — the chain showed every post was Steem-about-Steem meta,
 * eleven near-duplicate voices. This writers' room now drafts HUMAN pieces
 * from a rotating topic pool, one distinct voice per draft, ending with a
 * reader question (questions earn comments; comments earn a feed).
 * The engine re-checks every draft in pure code (sanitizeDraft + dedupe) —
 * this bridge drafts, the engine decides.
 */
const SYSTEM_PROMPT = `You are a small writers' room of independent human authors publishing on the Steem community. Every piece must be worth a stranger's time — something they would finish reading, remember, and answer.
HARD LAW (violations make a draft unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as an independent author.
- No financial advice, no profit promises, no price predictions or targets, no solicitation.
- NO fabricated personal identities: never invent named family members, specific biographies, or claim a specific hometown/job history. Write as a general human observer ("you know that moment when..." is fine).
- No AI telltales: never start with "In today's world" or similar; never end with "In conclusion"; NO em dashes or en dashes anywhere; avoid "delve", "tapestry", "realm".
- Plain human prose: concrete nouns, specific small details, one clear idea per paragraph. Show, don't lecture.
- TITLE CRAFT: open a curiosity gap with concrete nouns and a real stake. "The drawer of tools I never use" beats "Tips for organizing tools". No listicle vibes, no "Ultimate guide", no colon-stacked SEO titles.
- OPENING CRAFT: the first paragraph starts inside a small scene, a specific question, or a mildly surprising claim. It must never be a meta-introduction about the topic ("X is something we all..." is banned).
- PSYCHOLOGY: write about what people actually feel and do (doubt, habit, curiosity, small victories), not about abstractions. One honest observation beats three generic ones.
- SEO-aware: natural keywords in title and first paragraph, 3-5 topical tags, no stuffing.
- Every draft ENDS with one genuine, specific question to the reader (this is how conversations start).
Output STRICT JSON only, no markdown fences:
{"drafts":[{"title":"...","body":"...","tags":["tag1","tag2"],"angle":"...","voice":"...","seoNote":"...","groundedOn":["..."]}]}`;

export async function POST(req: Request) {
  let body: { topics?: unknown; voices?: unknown; recentTitles?: unknown; findings?: unknown; exposureLaw?: unknown; styleLaw?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const topics = (Array.isArray(body.topics) ? body.topics : []).slice(0, 6);
  const voices = (Array.isArray(body.voices) ? body.voices : []).slice(0, 12);
  const recentTitles = (Array.isArray(body.recentTitles) ? body.recentTitles : []).slice(0, 12);
  const findings = Array.isArray(body.findings) ? body.findings.slice(0, 8) : [];
  const law = Array.isArray(body.exposureLaw) ? body.exposureLaw : [];
  /* R254 · THE STYLE LAW (operator: nobody writes with "—", dev slang is
   * welcome): obeyed at the SOURCE so drafts never even arrive with dashes. */
  const style = (body.styleLaw && typeof body.styleLaw === "object" ? body.styleLaw : null) as { dashes?: string; slang?: string[]; slangGuidance?: string } | null;

  const userPrompt = [
    "Draft 4 DISTINCT posts for a general Steem audience. NOT about Steem itself — about life, work, mind, streets, craft, food, nature, ideas.",
    "Each: title ≤90 chars (curiosity gap, concrete nouns, no listicle vibes), body 450-700 words (R244 law: under 350 words is spam-detector tier and is auto-rejected at the publish gate — write deep, not thin; open inside a scene, question, or surprising claim — never a meta-intro; end with a genuine question that invites replies), 3-5 lowercase hyphenated tags (one broad topical tag like life/psychology/technology/food/nature/writing + 2-3 niche).",
    "The four drafts must be PUBLISHABLE AS-IS by four different humans: no shared sentences, no shared examples, different paragraph rhythms.",
    "",
    "THIS ROUND'S TOPICS — draft #1,2,3,4 take topics #1,2,3,4 IN ORDER (build one concrete piece per topic, do not just restate the hint):",
    ...topics.map((t: { id?: string; hint?: string; tags?: string[] }, i) => `${i + 1}. ${(t?.id ?? "?")} — ${(t?.hint ?? "")} (suggested tags: ${(t?.tags ?? []).join(", ")})`),
    "",
    "THIS ROUND'S VOICES — draft #i is written in voice #i (a DIFFERENT voice per draft; the feed must not sound like one bot):",
    ...voices.slice(0, 4).map((v: { account?: string; voice?: string }, i) => `${i + 1}. ${v?.voice ?? "clear and concrete"}`),
    "",
    "DO NOT come close to these already-published titles (different topic AND different words):",
    ...(recentTitles.length ? recentTitles.map((t: unknown) => `- ${String(t).slice(0, 90)}`) : ["- (none)"]),
    "",
    "EXTERNAL FINDINGS (optional general context, never machine metrics):",
    findings.map((f) => `- ${(f as { title?: string })?.title ?? "?"} (${(f as { host?: string })?.host ?? "?"})`).join("\n") || "- none this round",
    "",
    "EXPOSURE LAW (hard):",
    ...(law.length ? law.map((l) => `- ${l}`) : []),
    "",
    "STYLE LAW (R254):",
    ...(style?.dashes ? [`- ${style.dashes}`] : []),
    ...(style?.slang?.length ? [`- professional developer slang, used naturally: ${style.slang.slice(0, 12).join(", ")}`, `- ${style.slangGuidance ?? "at most one or two per post, only where a real developer would say them"}`] : []),
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
