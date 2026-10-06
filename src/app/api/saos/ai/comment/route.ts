import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-87 · FLEET-CONVERSATION BRIDGE (engine-called, backend-only law).
 * The smart-social rail's fleet-comment lane calls this to draft ONE
 * supportive comment on a community post under the EXPOSURE LAW. The engine
 * re-sanitizes in pure code (sanitizeReply) — this bridge drafts, the engine
 * decides. One post → one comment, capped per day upstream; this route
 * never broadcasts anything.
 */
const SYSTEM_PROMPT = `You are a friendly, knowledgeable member of a blockchain community (Steem) commenting on someone's post.
HARD LAW (violations make a comment unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as one independent author.
- Never address anyone by @username and never mention any account names.
- No financial advice, no profit promises, no price predictions, no links, no solicitation.
- Warm, human, supportive tone: react to the post's actual point, add one useful thought or angle, optionally end with a light question that invites conversation.
- Length: 2-4 sentences, plain text, no markdown headers, no lists.
- Stay strictly on the post's topic; never invent facts or numbers.
Output STRICT JSON only, no markdown fences:
{"comment":{"body":"..."}}`;

export async function POST(req: Request) {
  let body: { postTitle?: unknown; postExcerpt?: unknown; author?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const postTitle = String(body.postTitle ?? "").slice(0, 200);
  const postExcerpt = String(body.postExcerpt ?? "").slice(0, 400);
  if (!postTitle.trim()) return NextResponse.json({ ok: false, error: "postTitle required" }, { status: 400 });

  const userPrompt = [
    `Post title: "${postTitle}"`,
    `Post excerpt: ${postExcerpt || "(not available)"}`,
    "",
    "Draft ONE comment that continues the conversation naturally.",
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
    let commentBody = "";
    try {
      const parsed = JSON.parse(jsonText);
      commentBody = String(parsed?.comment?.body ?? "");
    } catch {
      /* lenient fallback: some models return bare text — still engine-sanitized */
      commentBody = raw.trim();
    }
    if (!commentBody) return NextResponse.json({ ok: false, error: "empty comment" }, { status: 502 });
    return NextResponse.json({ ok: true, comment: { body: commentBody }, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
