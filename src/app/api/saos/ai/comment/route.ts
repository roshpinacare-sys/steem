import { NextResponse } from "next/server";
import { withLlmRetry, withVoice } from "../_llm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-87 · FLEET-CONVERSATION BRIDGE (engine-called, backend-only law).
 * The smart-social rail calls this to draft ONE substantive comment on a
 * community post under the EXPOSURE LAW. The engine re-sanitizes in pure
 * code (sanitizeReply + replyFresh) — this bridge drafts, the engine
 * decides. One post → one comment, capped per day upstream; this route
 * never broadcasts anything.
 *
 * R243 INTELLIGENCE ROUND: the chain audit found the old prompt's output
 * was interchangeable applause ("I completely agree...") — the same
 * sentence shipped to different posts on the same day. The new law: react
 * to the post's SPECIFIC point with a specific thought of our own.
 */
const SYSTEM_PROMPT = `You are a thoughtful human member of a blockchain community (Steem) commenting on someone's post. You read the whole post and you have one genuine reaction to it.
HARD LAW (violations make a comment unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as one independent author.
- Never address anyone by @username and never mention any account names.
- No financial advice, no profit promises, no price predictions, no links, no solicitation.
- BANNED OPENERS (never in the first sentence): "That's a great post", "Great observation", "You're absolutely right", "I completely agree", "Well said", "Thanks for sharing", "This resonates", "Wonderful post". Open with SUBSTANCE instead.
- React to the post's SPECIFIC point: pick the single sharpest idea, detail, or example in the post and say something real about it — what it explains, what it misses, what it reminded you of, where it leads.
- Add ONE thing the post did not already say (a concrete example, an honest counterpoint, a related question from your own reading or life). Never just praise, never summarize the post back at its author.
- Optionally end with ONE specific question that opens the conversation (never "What do you think?").
- Length: 2-4 sentences, plain text, no markdown headers, no lists. Vary sentence rhythm; never sound like a template.
- Stay strictly on the post's topic; never invent facts or numbers.
Output STRICT JSON only, no markdown fences:
{"comment":{"body":"..."}}`;

export async function POST(req: Request) {
  let body: { postTitle?: unknown; postExcerpt?: unknown; author?: unknown; personaBrief?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const postTitle = String(body.postTitle ?? "").slice(0, 200);
  const postExcerpt = String(body.postExcerpt ?? "").slice(0, 400);
  /* R263 · THE PERSONA BRIEF: the engine sends the writer's full soul sheet
   * (lens, traits, personal slang, register dial) — the comment is drafted
   * IN that voice, not in a generic one. */
  const personaBrief = typeof body.personaBrief === "string" ? body.personaBrief : null;
  if (!postTitle.trim()) return NextResponse.json({ ok: false, error: "postTitle required" }, { status: 400 });

  const userPrompt = [
    `Post title: "${postTitle}"`,
    `Post excerpt: ${postExcerpt || "(not available)"}`,
    "",
    "Draft ONE comment that joins this conversation like a real person would:",
    "- react to the post's sharpest specific idea (not the topic in general),",
    "- add one concrete thing the post did not say,",
    "- no praise openers, no summary of the post back at its author.",
    "Return STRICT JSON only.",
  ].join("\n");

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await withLlmRetry(() => zai.chat.completions.create({
      messages: [
        { role: "assistant", content: withVoice(SYSTEM_PROMPT, personaBrief) },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    }));
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
