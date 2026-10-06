import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-85 · SOCIAL REPLY BRIDGE (engine-called, backend-only law).
 * The engine's smart-social rail calls this when a real community comment
 * lands on a fleet account's post; the LLM drafts ONE supportive reply under
 * the EXPOSURE LAW. The engine re-sanitizes in pure code (sanitizeReply) —
 * this bridge drafts, the engine decides. One comment → one reply, capped
 * per day upstream; this route never broadcasts anything.
 */
const SYSTEM_PROMPT = `You are a friendly, knowledgeable member of a blockchain community (Steem) replying to a comment on your post.
HARD LAW (violations make a reply unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as one independent author.
- No financial advice, no profit promises, no price predictions, no links, no solicitation.
- Warm, human, supportive tone: acknowledge the commenter's point, add one useful insight or follow-up question.
- Length: 2-5 sentences, plain text, no markdown headers, no lists.
- Stay on the topic of the comment; never invent facts or numbers.
Output STRICT JSON only, no markdown fences:
{"reply":{"body":"..."}}`;

export async function POST(req: Request) {
  let body: { postTitle?: unknown; postExcerpt?: unknown; commentAuthor?: unknown; commentBody?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const postTitle = String(body.postTitle ?? "").slice(0, 200);
  const postExcerpt = String(body.postExcerpt ?? "").slice(0, 400);
  const commentAuthor = String(body.commentAuthor ?? "").slice(0, 60);
  const commentBody = String(body.commentBody ?? "").slice(0, 400);
  if (!commentBody.trim()) return NextResponse.json({ ok: false, error: "commentBody required" }, { status: 400 });

  const userPrompt = [
    `Your post title: "${postTitle}"`,
    `Post excerpt: ${postExcerpt || "(not available)"}`,
    "",
    `A community member${commentAuthor ? ` (@${commentAuthor})` : ""} commented:`,
    `"${commentBody}"`,
    "",
    "Draft ONE reply that continues the conversation naturally.",
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
    let replyBody = "";
    try {
      const parsed = JSON.parse(jsonText);
      replyBody = String(parsed?.reply?.body ?? "");
    } catch {
      /* lenient fallback: some models return bare text — still engine-sanitized */
      replyBody = raw.trim();
    }
    if (!replyBody) return NextResponse.json({ ok: false, error: "empty reply" }, { status: 502 });
    return NextResponse.json({ ok: true, reply: { body: replyBody }, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
