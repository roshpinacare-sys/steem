import { NextResponse } from "next/server";
import { guardAiBridge, shieldReject } from "@/lib/exposureShield";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-74 · COMMUNITY SEED BRIDGE (engine-called, backend-only law).
 * The community exists (hive-179317 "The Measured Desk") and is EMPTY. The
 * engine's community track calls this route once per UTC day with the day's
 * persona (from humanity.mjs roster) + its measured telemetry; the LLM drafts
 * ONE discussion seed voiced for that persona under the EXPOSURE LAW + the
 * T-73 humanity lines. The engine re-checks every draft in pure code
 * (content.sanitizeDraft + lib §74) — this bridge drafts, the engine decides.
 *
 * T-74c · REPLY MODE (mode:"reply"): the same bridge drafts ONE conversation
 * reply to a real reader comment under a tracked post — voiced as the post
 * author, tied to the commenter's actual words, ZERO invented numbers. The
 * engine re-judges every draft in pure code (lib §74R + §73d gateComment).
 */
const SYSTEM_PROMPT = `You are a practitioner writing inside a small blockchain community ("The Measured Desk") whose theme is honest measurement: real numbers, real experiments, real lessons, no hype.
HARD LAW (violations make a draft unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation collectives, internal codenames, or that any accounts are connected. Write as one independent author.
- No financial advice, no profit promises, no price predictions or targets, no solicitation.
- This is a DISCUSSION SEED, not a news digest: you open a conversation the community's own members can answer from their own experience.
- Supportive public-knowledge tone: teach, ask, answer. Welcome newcomers.
- AEO: the FIRST paragraph must carry a concrete verifiable claim WITH A REAL NUMBER copied EXACTLY from the telemetry provided.
- NUMBER-TRUTH (hard): copy numbers EXACTLY as they appear in the telemetry — never round differently, never rescale, never shift commas/thousands separators, never relabel a metric. Every number >=11 you write must come from the telemetry verbatim.
- VENUE-TRUTH (hard): the venue/chain you describe is the one NAMED INSIDE the telemetry (its venue field, verbatim). Never rename the venue the numbers describe — a fill measured on one chain must not be retold on another.
- HUMANITY (hard): never use an em-dash or en-dash in the TITLE. No template openers: "Top N", "N ways/tips", "How Do You", "Understanding ...", "Optimize Your ...", "Unlock", "Game-changing", "The Power of". Titles read like a sentence a practitioner would actually say (25-90 chars).
- HUMANITY (hard): first person, concrete, practitioner voice ("I tried", "my first attempt broke", "we watched"). Vary sentence rhythm (mix short and long sentences). No listicle, no press-release tone, no shared boilerplate.
- HUMANITY (hard): end the body with ONE genuine open question a real reader would answer from their own experience.
- TAGS (hard): the FIRST tag is EXACTLY the community tag given in the payload; then 2-3 lowercase hyphenated topical tags. Max 4 tags total.
Output STRICT JSON only, no markdown fences:
{"drafts":[{"title":"...","body":"...","tags":["community-tag","tag2","tag3"],"angle":"...","seoNote":"...","groundedOn":["..."]}]}`;

const REPLY_SYSTEM_PROMPT = `You are the practitioner who wrote the post below, replying to a reader's comment in your small blockchain community ("The Measured Desk") whose theme is honest measurement.
HARD LAW (violations make a reply unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. You are ONE independent author.
- Reply to what the commenter ACTUALLY said: reference their concrete point or question, in your own words (a human who read it).
- Conversational length: 40 to 90 words (at least 120 characters, at most 600). 2 to 6 sentences. First person. Natural rhythm (mix short and long sentences).
- NUMBER-TRUTH (hard): never invent or alter a number. The only numbers you may write are ones QUOTED VERBATIM from the comment or the post excerpt given to you. No measurements, percentages, dates or prices of your own.
- Never use an em-dash or en-dash anywhere.
- No template openers ("Great post!", "Thanks for sharing!", "Nice article!"), no flattery-only replies, no hashtag stuffing, no links.
- Supportive public-knowledge tone: teach, ask, answer; it is good to end with one short genuine question back when it keeps the conversation alive.
- Plain conversational text only, no markdown headers, no bullet lists.
Output STRICT JSON only, no markdown fences:
{"reply":{"body":"..."}}`;

export async function POST(req: Request) {
  /* T-35 EXPOSURE SHIELD: same-origin (browser) or token-carried (engine) */
  const refused = shieldReject(guardAiBridge(req));
  if (refused) return refused;
  let body: { mode?: unknown; persona?: unknown; telemetry?: unknown; exposureLaw?: unknown; communityTag?: unknown; parentComment?: unknown; postContext?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  /* ── T-74c · REPLY MODE — one conversational reply, zero invented numbers ── */
  if (body.mode === "reply") {
    const pc = body.parentComment && typeof body.parentComment === "object"
      ? (body.parentComment as { author?: unknown; body?: unknown }) : {};
    const ctx = body.postContext && typeof body.postContext === "object"
      ? (body.postContext as { title?: unknown; excerpt?: unknown }) : {};
    const parentBody = String(pc.body ?? "").trim().slice(0, 1500);
    if (!parentBody) return NextResponse.json({ ok: false, error: "parentComment.body required" }, { status: 400 });
    const personaR = body.persona && typeof body.persona === "object"
      ? (body.persona as { label?: unknown; topics?: unknown; commentStyle?: unknown }) : {};
    const personaTopicsR = Array.isArray(personaR.topics) ? (personaR.topics as unknown[]).map(String) : [];
    const lawR = Array.isArray(body.exposureLaw) ? body.exposureLaw : [];
    const replyPrompt = [
      "Write exactly ONE reply (as a comment) to the reader comment below.",
      personaTopicsR.length
        ? `Your voice: ${String(personaR.label ?? "practitioner")}. Topics you care about: ${personaTopicsR.join(", ")}.`
        : "Your voice: a practitioner sharing what they actually did or saw.",
      "",
      "THE POST (yours, context only):",
      `Title: ${String(ctx.title ?? "").slice(0, 200)}`,
      `Excerpt: ${String(ctx.excerpt ?? "").slice(0, 700)}`,
      "",
      "THE READER COMMENT (answer THIS):",
      `From: ${String(pc.author ?? "a reader").slice(0, 60)}`,
      parentBody,
      "",
      "EXPOSURE LAW (hard):",
      ...(lawR.length ? lawR.map((l) => `- ${l}`) : []),
      "",
      "Return STRICT JSON only.",
    ].join("\n");
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "assistant", content: REPLY_SYSTEM_PROMPT },
          { role: "user", content: replyPrompt },
        ],
        thinking: { type: "disabled" },
      });
      const rawR = completion.choices?.[0]?.message?.content ?? "";
      const reply = parseReply(rawR);
      if (!reply) return NextResponse.json({ ok: false, error: "unparseable LLM output", raw: rawR.slice(0, 400) }, { status: 502 });
      return NextResponse.json({ ok: true, reply, at: new Date().toISOString() });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
        { status: 502 }
      );
    }
  }

  const persona = body.persona && typeof body.persona === "object"
    ? (body.persona as { label?: unknown; topics?: unknown; commentStyle?: unknown })
    : {};
  const telemetry = body.telemetry && typeof body.telemetry === "object" ? body.telemetry : {};
  const law = Array.isArray(body.exposureLaw) ? body.exposureLaw : [];
  const communityTag = typeof body.communityTag === "string" && body.communityTag.trim() ? body.communityTag.trim() : null;
  if (!communityTag) return NextResponse.json({ ok: false, error: "communityTag required" }, { status: 400 });

  const personaTopics = Array.isArray(persona.topics) ? (persona.topics as unknown[]).map(String) : [];
  const userPrompt = [
    "Draft exactly 1 discussion-seed post for the community's feed.",
    `Title 25-90 chars, body 250-450 words, tags: ["${communityTag}", ...2-3 topical] (first tag EXACT, max 4 total).`,
    personaTopics.length
      ? `Persona voice: ${String(persona.label ?? "practitioner")}. Topic affinity (write INSIDE these, grounded on the telemetry): ${personaTopics.join(", ")}.`
      : "Persona voice: a practitioner sharing what they actually did or saw.",
    "One distinct angle: a confession-style lesson, an observed phenomenon with the measured number, or an open question from real practice.",
    "End with a genuine open question the community members can answer from their own experience.",
    "",
    "EXPOSURE LAW (hard):",
    ...(law.length ? law.map((l) => `- ${l}`) : []),
    "",
    "TELEMETRY (measured, the ONLY numbers you may use — verbatim):",
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
    const drafts = parseDrafts(raw);
    if (!drafts) return NextResponse.json({ ok: false, error: "unparseable LLM output", raw: raw.slice(0, 400) }, { status: 502 });
    return NextResponse.json({ ok: true, drafts, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 502 }
    );
  }
}

/* strict-JSON drafts parse — the T-34 hardened shape (fences stripped, every
 * balanced {...} block scanned, only a real drafts[] array wins) */
function parseDrafts(raw: string): unknown | null {
  const stripped = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
  const candidates: string[] = [stripped];
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) { candidates.push(stripped.slice(start, i + 1)); start = -1; }
    }
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as { drafts?: unknown };
      if (parsed && Array.isArray(parsed.drafts)) return parsed.drafts;
    } catch { /* next candidate */ }
  }
  return null;
}

/* strict-JSON reply parse — same hardened shape family (T-34), reply key */
function parseReply(raw: string): { body: string } | null {
  const stripped = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
  const candidates: string[] = [stripped];
  let depth = 0, start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) { candidates.push(stripped.slice(start, i + 1)); start = -1; }
    }
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as { reply?: { body?: unknown } };
      const b = String(parsed?.reply?.body ?? "").trim();
      if (b) return { body: b };
    } catch { /* next candidate */ }
  }
  return null;
}
