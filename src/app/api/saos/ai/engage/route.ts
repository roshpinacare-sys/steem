import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R240 · EXTERNAL-ENGAGEMENT BRIDGE (engine-called, backend-only law).
 * NEW LANE: the operator ruled the fleet's self-talk bubble is dead weight —
 * "צריך שיהיה עניין רב לפוסטים... ולא לדבר לעצמי". When the engine's
 * external-comment rail picks a real post by a real author outside the
 * fleet, this bridge drafts ONE genuine reader comment: it must reference a
 * specific element of the post, add something (an angle, an example, a
 * follow-up question), and sound like a person, not a fan club.
 * The engine re-sanitizes in pure code (sanitizeReply) — this bridge drafts,
 * the engine decides. One post → one comment, capped per day upstream; this
 * route never broadcasts anything.
 */
const SYSTEM_PROMPT = `You are a real reader in the Steem community commenting on someone's post. Your comment must earn its place next to the post.
HARD LAW (violations make a comment unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that accounts are connected. You are one independent author.
- Never address anyone by @username, never mention account names.
- NO generic praise openers: "Great post", "Nice article", "Thanks for sharing", "Wonderful" are ALL banned — start with the substance itself.
- Reference ONE specific concrete element from the post (a detail, a claim, an example, a moment). If you cannot find one, say what genuinely surprised or challenged you in the topic.
- Add value: one insight, one everyday example, or one honest follow-up question. At most one question.
- Length: 2-4 sentences, plain text, no markdown, no lists, no links, no emojis.
- No financial advice, no profit promises, no fabricated personal biography (a general "I" is fine; no named relatives, no invented job history).
- No AI telltales: no "In conclusion", no em dashes, no "delve".
Output STRICT JSON only, no markdown fences:
{"comment":{"body":"..."}}`;

export async function POST(req: Request) {
  let body: { postTitle?: unknown; postBody?: unknown; postTags?: unknown; voice?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const postTitle = String(body.postTitle ?? "").slice(0, 200);
  const postBody = String(body.postBody ?? "").slice(0, 1500);
  const postTags = (Array.isArray(body.postTags) ? body.postTags : []).map((t) => String(t).slice(0, 24)).slice(0, 5);
  const voice = String(body.voice ?? "").slice(0, 300);
  if (!postBody.trim() && !postTitle.trim()) {
    return NextResponse.json({ ok: false, error: "postTitle or postBody required" }, { status: 400 });
  }

  const userPrompt = [
    `The post you just read:`,
    `Title: "${postTitle}"`,
    postTags.length ? `Tags: ${postTags.join(", ")}` : "",
    `Body (excerpt): ${postBody || "(not available)"}`,
    "",
    voice ? `Your reading voice (stay inside it): ${voice}` : "",
    "",
    "Draft ONE comment that a thoughtful reader would leave. Start with the substance, reference something specific from the post, and add your own angle or question.",
    "Return STRICT JSON only.",
  ].filter(Boolean).join("\n");

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
    let commentBody = "";
    try {
      const parsed = JSON.parse(jsonText);
      commentBody = String(parsed?.comment?.body ?? "");
    } catch {
      return NextResponse.json({ ok: false, error: "unparseable LLM output", raw: raw.slice(0, 400) }, { status: 502 });
    }
    if (!commentBody.trim()) return NextResponse.json({ ok: false, error: "empty comment draft" }, { status: 502 });
    return NextResponse.json({ ok: true, comment: { body: commentBody.slice(0, 700) }, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
