import { NextResponse } from "next/server";
import { withVoice } from "../_llm";
import { SYMBOL_PROMPT_LAW, ANTI_TEMPLATE_LAW, validateDraftBody } from "../_symbols";
import { runLlmChain, compactContext } from "@/lib/llm-chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-87 · FLEET-CONVERSATION BRIDGE (engine-called, backend-only law).
 * The smart-social rail calls this to draft ONE substantive comment on a
 * community post under the EXPOSURE LAW. The engine re-sanitizes in pure
 * code (sanitizeReply + replyFresh): this bridge drafts, the engine
 * decides. One post → one comment, capped per day upstream; this route
 * never broadcasts anything.
 *
 * R243 INTELLIGENCE ROUND: the chain audit found the old prompt's output
 * was interchangeable applause ("I completely agree..."), the same
 * sentence shipped to different posts on the same day. The new law: react
 * to the post's SPECIFIC point with a specific thought of our own.
 */
const SYSTEM_PROMPT = `You are a thoughtful human member of a blockchain community (Steem) commenting on someone's post. You read the whole post and you have one genuine reaction to it.
HARD LAW (violations make a comment unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as one independent author.
- Never address anyone by @username and never mention any account names.
- No financial advice, no profit promises, no price predictions, no links, no solicitation.
- NO dashes anywhere, NO double quotes anywhere, NO colons anywhere (the absolute symbol ban).
- BANNED OPENERS (never in the first sentence): "That's a great post", "Great observation", "You're absolutely right", "I completely agree", "Well said", "Thanks for sharing", "This resonates", "Wonderful post", "Let's measure it", "Bottom line up front", "Here's the thing". Open with SUBSTANCE instead.
- React to the post's SPECIFIC point: pick the single sharpest idea, detail, or example in the post and say something real about it: what it explains, what it misses, what it reminded you of, where it leads.
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
   * (lens, traits, personal slang, register dial), the comment is drafted
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
    /* R285 · THE CHAIN: a candidate IS the retry topology. Primary rides the
     * full brief; compact-retry rides a lossy-compacted brief with a shorter
     * ask (genuinely different request, same turn). Unique law kills a
     * candidate that echoes the other one; the symbol gate stays AFTER. */
    const system = withVoice(`${SYSTEM_PROMPT}\n\n${SYMBOL_PROMPT_LAW}\n\n${ANTI_TEMPLATE_LAW}`, personaBrief);
    const callZai = (sys: string, user: string, maxLen: string) =>
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: sys },
          { role: "user", content: user },
        ],
        thinking: { type: "disabled" },
      }).then((completion: unknown) => {
        const raw = (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
        const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        let body = "";
        try {
          const parsed = JSON.parse(jsonText);
          body = String(parsed?.comment?.body ?? "");
        } catch {
          body = raw.trim(); /* lenient: engine still re-sanitizes */
        }
        if (!body.trim()) throw new Error("empty comment from provider");
        return { value: body.trim().slice(0, maxLen === "short" ? 600 : 1200), tokens: (completion as { usage?: { total_tokens?: number } })?.usage?.total_tokens ?? 0 };
      });

    const chain = await runLlmChain<string>({
      purpose: "comment",
      candidates: [
        { name: "primary", call: () => callZai(system, userPrompt, "full") },
        {
          name: "compact-retry",
          call: () =>
            callZai(
              compactContext(system, 1400),
              compactContext(userPrompt, 700) + "\nHard cap: 2 sentences, the sharpest one idea.",
              "short",
            ),
        },
      ],
      validate: (s) => (s && s.trim() ? s.trim() : null),
      timeoutMs: 45_000,
      cacheKey: `comment|${postTitle}|${postExcerpt}|${personaBrief ?? ""}`,
    });
    if (!chain.ok || !chain.output) {
      return NextResponse.json(
        { ok: false, error: `llm-chain exhausted (${chain.errorClass ?? "unknown"})`, chain: { attempts: chain.attempts, ms: chain.ms } },
        { status: 502 },
      );
    }
    const commentBody = chain.output;
    /* R283 · THE SYMBOL LAW GATE — fail-closed on banned glyphs and template framing */
    const valid = validateDraftBody(commentBody);
    if (valid === null) return NextResponse.json({ ok: false, error: "symbol-law-refused" }, { status: 502 });
    return NextResponse.json({
      ok: true,
      comment: { body: valid },
      chain: { selected: chain.selected, attempts: chain.attempts, cacheHit: chain.cacheHit, ms: chain.ms },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
