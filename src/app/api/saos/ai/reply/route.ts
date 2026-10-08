import { NextResponse } from "next/server";
import { withLlmRetry, withVoice } from "../_llm";
import { SYMBOL_PROMPT_LAW, ANTI_TEMPLATE_LAW, validateDraftBody } from "../_symbols";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-85 · SOCIAL REPLY BRIDGE (engine-called, backend-only law).
 * The engine's smart-social rail calls this when a real community comment
 * lands on a fleet account's post; the LLM drafts ONE substantive reply under
 * the EXPOSURE LAW. The engine re-sanitizes in pure code (sanitizeReply +
 * replyFresh): this bridge drafts, the engine decides.
 *
 * R243 INTELLIGENCE ROUND (operator order: "פסיכולוגיה... להרים
 * אינטליגנציה משמעותית חובה"): the chain audit proved the old prompt
 * produced hollow applause loops ("That's a great point about..."). The
 * new law of the reply: quote ONE specific thing the commenter actually
 * said, add ONE concrete thought of our own, never open with praise.
 */
const SYSTEM_PROMPT = `You are a thoughtful human member of a blockchain community (Steem) replying to a comment on your post. Write like a real person continuing a real conversation, not like a support desk.
HARD LAW (violations make a reply unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as one independent author.
- Never address anyone by @username and never mention any account names.
- No financial advice, no profit promises, no price predictions, no links, no solicitation.
- NO dashes anywhere, NO double quotes anywhere, NO colons anywhere (the absolute symbol ban).
- BANNED OPENERS (never start with these, never even in the first sentence): "That's a great point", "Great observation", "You're absolutely right", "I completely agree", "Well said", "Thanks for sharing", "This resonates", "Couldn't have said it better", "Such an insightful", "Spot on", "Great share", "This hits home", "So true", "Loved this", "Keep it up", "Following for more", "Let's measure it", "Bottom line up front", "Here's the thing". Start with SUBSTANCE: an idea, a detail, a memory, an example, or a gentle pushback.
- VARY YOUR SHAPE across replies: do not always open with "the X detail caught me" or always end with a question; some replies assert, some reply with a short story, some end mid-thought inviting the other side to continue.
- Quote or paraphrase ONE specific word/idea/example from the commenter's actual words and build on it. If their comment is vague, pick the one concrete thing it implies and expand that.
- Add something the commenter did NOT already say: a small concrete detail, an honest counterpoint, or a lived example. Never just praise, never just agree.
- At most one follow-up question, and it must be specific (never "What do you think?"). Ending with a statement is also fine.
- Length: 2-5 sentences, plain text, no markdown headers, no lists. Vary your sentence rhythm; do not sound like a template.
- Stay on the topic of the comment; never invent facts or numbers.
Output STRICT JSON only, no markdown fences:
{"reply":{"body":"..."}}`;

export async function POST(req: Request) {
  let body: { postTitle?: unknown; postExcerpt?: unknown; commentAuthor?: unknown; commentBody?: unknown; myPrior?: unknown; personaBrief?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const postTitle = String(body.postTitle ?? "").slice(0, 200);
  const postExcerpt = String(body.postExcerpt ?? "").slice(0, 400);
  const commentAuthor = String(body.commentAuthor ?? "").slice(0, 60);
  const commentBody = String(body.commentBody ?? "").slice(0, 400);
  const myPrior = String(body.myPrior ?? "").slice(0, 400);
  /* R263 · THE PERSONA BRIEF: the reply is drafted IN the account's own voice */
  const personaBrief = typeof body.personaBrief === "string" ? body.personaBrief : null;
  if (!commentBody.trim()) return NextResponse.json({ ok: false, error: "commentBody required" }, { status: 400 });

  const userPrompt = [
    `Your post title: "${postTitle}"`,
    `Post excerpt: ${postExcerpt || "(not available)"}`,
    myPrior ? `What YOU already wrote earlier in this thread: "${myPrior}" (do not repeat it; build on it)` : "",
    "",
    `A community member${commentAuthor ? ` (@${commentAuthor})` : ""} commented:`,
    `"${commentBody}"`,
    "",
    "Draft ONE reply that continues this conversation like a real person would:",
    "- anchor on one specific thing they said,",
    "- add one concrete idea or example they did not mention,",
    "- no praise openers, no agreement-only replies.",
    "Return STRICT JSON only.",
  ].filter(Boolean).join("\n");

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await withLlmRetry(() => zai.chat.completions.create({
      messages: [
        { role: "assistant", content: withVoice(`${SYSTEM_PROMPT}\n\n${SYMBOL_PROMPT_LAW}\n\n${ANTI_TEMPLATE_LAW}`, personaBrief) },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    }));
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let replyBody = "";
    try {
      const parsed = JSON.parse(jsonText);
      replyBody = String(parsed?.reply?.body ?? "");
    } catch {
      /* lenient fallback: some models return bare text, still engine-sanitized */
      replyBody = raw.trim();
    }
    if (!replyBody) return NextResponse.json({ ok: false, error: "empty reply" }, { status: 502 });
    /* R283 · THE SYMBOL LAW GATE — the engine never receives a body that
     * carries a banned glyph or survives as template framing */
    const valid = validateDraftBody(replyBody);
    if (valid === null) return NextResponse.json({ ok: false, error: "symbol-law-refused" }, { status: 502 });
    return NextResponse.json({ ok: true, reply: { body: valid }, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
