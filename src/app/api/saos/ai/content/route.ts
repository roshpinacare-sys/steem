import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { SYMBOL_PROMPT_LAW, enforceSymbolLaw } from "../_symbols";
import { nvidiaKeyPresent, nvidiaChat } from "../_llm";
import { runLlmChain, compactContext } from "@/lib/llm-chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * R240 · CONTENT-INTELLIGENCE BRIDGE (engine-called, backend-only law).
 * Rewritten after the operator's verdict on the feed: "זה ממש לא מעניין מה
 * שאנחנו שולחים", the chain showed every post was Steem-about-Steem meta,
 * eleven near-duplicate voices. This writers' room now drafts HUMAN pieces
 * from a rotating topic pool, one distinct voice per draft, ending with a
 * reader question (questions earn comments; comments earn a feed).
 * The engine re-checks every draft in pure code (sanitizeDraft + dedupe),
 * this bridge drafts, the engine decides.
 */
const SYSTEM_PROMPT = `You are a small writers' room of independent human authors publishing on the Steem community. Every piece must be worth a stranger's time: something they would finish reading, remember, and answer.
HARD LAW (violations make a draft unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected. Write as an independent author.
- No financial advice, no profit promises, no price predictions or targets, no solicitation.
- NO fabricated personal identities: never invent named family members, specific biographies, or claim a specific hometown/job history. Write as a general human observer ("you know that moment when..." is fine).
- No AI telltales: never start with "In today's world" or similar; never end with "In conclusion"; NO dashes anywhere, NO double quotes anywhere, NO colons anywhere (the absolute symbol ban); avoid "delve", "tapestry", "realm".
- BANNED OPENINGS (any of these in the first sentence makes the draft unusable): "In this article", "In this post", "Let's dive", "As we all know", "It's no secret", "In the ever-evolving", "In the world of", "Have you ever wondered", "Are you tired of", "Unlock the", "In the realm of", "The digital landscape", "Game-changer". Start inside a scene, a question, or a specific claim instead.
- VARIETY: the recent titles listed may share a theme but your piece must NOT reuse their opening move or structure. If three recent posts opened with a question, open with a scene. If they opened with a scene, open with a claim.
- Plain human prose: concrete nouns, specific small details, one clear idea per paragraph. Show, don't lecture.
- TITLE CRAFT: open a curiosity gap with concrete nouns and a real stake. "The drawer of tools I never use" beats "Tips for organizing tools". No listicle vibes, no "Ultimate guide", no colon-stacked SEO titles.
- OPENING CRAFT: the first paragraph starts inside a small scene, a specific question, or a mildly surprising claim. It must never be a meta-introduction about the topic ("X is something we all..." is banned).
- PSYCHOLOGY: write about what people actually feel and do (doubt, habit, curiosity, small victories), not about abstractions. One honest observation beats three generic ones.
- SEO-aware: natural keywords in title and first paragraph, 3-5 topical tags, no stuffing.
- Every draft ENDS with one genuine, specific question to the reader (this is how conversations start).
Output STRICT JSON only, no markdown fences:
{"drafts":[{"title":"...","body":"...","tags":["tag1","tag2"],"angle":"...","voice":"...","seoNote":"...","groundedOn":["..."]}]}`;

export async function POST(req: Request) {
  let body: { topics?: unknown; voices?: unknown; personas?: unknown; recentTitles?: unknown; findings?: unknown; exposureLaw?: unknown; styleLaw?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  const topics = (Array.isArray(body.topics) ? body.topics : []).slice(0, 6);
  const voices = (Array.isArray(body.voices) ? body.voices : []).slice(0, 12);
  /* R255 · PERSONA SHEETS (engine-sent): full soul briefs per author. When
   * present they OWN the voice block: the drafts come back tagged with the
   * persona id so the publish rail can match voices to accounts. */
  const personas = (Array.isArray(body.personas) ? body.personas : [])
    .filter((p: unknown): p is { account: string; brief: string; owns?: string[] } => !!p && typeof (p as { account?: unknown })?.account === "string" && typeof (p as { brief?: unknown })?.brief === "string")
    .slice(0, 4);
  const recentTitles = (Array.isArray(body.recentTitles) ? body.recentTitles : []).slice(0, 12);
  const findings = Array.isArray(body.findings) ? body.findings.slice(0, 8) : [];
  const law = Array.isArray(body.exposureLaw) ? body.exposureLaw : [];
  /* R254 · THE STYLE LAW (operator: nobody writes with "-", dev slang is
   * welcome): obeyed at the SOURCE so drafts never even arrive with dashes. */
  const style = (body.styleLaw && typeof body.styleLaw === "object" ? body.styleLaw : null) as { dashes?: string; slang?: string[]; slangGuidance?: string } | null;
  /* R262 · THE FORMAT LAW (operator: understand what a post can carry, HTML
   * up to what level): safe markdown + HTML subset in, stripping tags out. */
  const format = (body.formatLaw && typeof body.formatLaw === "object" ? body.formatLaw : null) as { allowed?: string[]; forbidden?: string[]; guidance?: string } | null;

  const userPrompt = [
    "Draft 4 DISTINCT posts for a general Steem audience. NOT about Steem itself, but about life, work, mind, streets, craft, food, nature, ideas.",
    "Each: title ≤90 chars (curiosity gap, concrete nouns, no listicle vibes), body 450-700 words (R244 law: under 350 words is spam-detector tier and is auto-rejected at the publish gate: write deep, not thin; open inside a scene, question, or surprising claim, never a meta-intro; end with a genuine question that invites replies), 3-5 lowercase hyphenated tags (one broad topical tag like life/psychology/technology/food/nature/writing + 2-3 niche).",
    "The four drafts must be PUBLISHABLE AS-IS by four different humans: no shared sentences, no shared examples, different paragraph rhythms.",
    "",
    "THIS ROUND'S TOPICS: draft #1,2,3,4 take topics #1,2,3,4 IN ORDER (build one concrete piece per topic, do not just restate the hint):",
    ...topics.map((t: { id?: string; hint?: string; tags?: string[] }, i) => `${i + 1}. ${(t?.id ?? "?")}: ${(t?.hint ?? "")} (suggested tags: ${(t?.tags ?? []).join(", ")})`),
    "",
    personas.length
      ? "THIS ROUND'S AUTHORS: draft #i is written BY author #i, IN their voice, AT their development stage (a voice that grew; honor the slang but never force it; keep the register dial: professional lean stays crisp, neighborhood lean stays warm):"
      : "THIS ROUND'S VOICES: draft #i is written in voice #i (a DIFFERENT voice per draft; the feed must not sound like one bot):",
    ...(personas.length
      ? personas.map((p, i) => `${i + 1}. [persona:${p.account}]\n${p.brief}`)
      : voices.slice(0, 4).map((v: { account?: string; voice?: string }, i) => `${i + 1}. ${v?.voice ?? "clear and concrete"}`)),
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
    "FORMAT LAW (R262):",
    ...(format?.allowed?.length ? [`- MAY use: ${format.allowed.join("; ")}`] : []),
    ...(format?.forbidden?.length ? [`- MUST NOT use: ${format.forbidden.join("; ")}`] : []),
    ...(format?.guidance ? [`- ${format.guidance}`] : []),
    "",
    personas.length ? 'Return each draft with "persona": "<the account id from [persona:...]>".' : "",
    "Return STRICT JSON only.",
  ].filter(Boolean).join("\n");

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    /* R285 · THE CHAIN (satisfy mode): the 4-draft ask is the bar. Primary
     * rides the full brief; when its VALID drafts fall short, compact-retry
     * tops up 2 more from a lossy-compacted brief (Execution-Forking law,
     * budget-honest: the second candidate runs ONLY on shortfall). Titles
     * merge with a token-overlap guard so the queue never fills with twins.
     * The heaviest call keeps 2 attempts inside maxDuration 120. */
    const callZai = (user: string, sys: string) =>
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: sys },
          { role: "user", content: user },
        ],
        thinking: { type: "disabled" },
        /* R309 · THE TOKEN BUDGET MATCHES THE ASK (measured 15:2xZ: both
         * chain candidates returned "invalid" — parseable JSON, thin bodies —
         * because the SDK's implicit output cap made 4×450-700-word bodies
         * physically impossible; the model compressed to fit. 8192 tokens
         * fits 4 full drafts with room for the JSON envelope). */
        max_tokens: 8192,
      }).then((completion: unknown) => {
        const raw = (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
        const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        let drafts: unknown = [];
        try {
          const parsed = JSON.parse(jsonText);
          drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
        } catch {
          throw new Error("unparseable LLM output");
        }
        const arr = Array.isArray(drafts) ? (drafts as Record<string, unknown>[]).filter((d) => d && typeof d === "object") : [];
        if (!arr.length) throw new Error("empty drafts from provider");
        return { value: arr, tokens: (completion as { usage?: { total_tokens?: number } })?.usage?.total_tokens ?? 0 };
      });

    /* R309 · THE SINGLE-DRAFT UNIT (measured 15:2x-15:3xZ: the 4-draft ask
     * returns thin bodies from the primary provider even with a full token
     * budget, while the single-draft ask returned a full 450-700-word piece
     * — the bench proof. The chain now runs ONE candidate per topic, every
     * unit the proven-reliable shape; thin has nowhere to hide). */
    const singleDraftUser = (topic: { id?: string; hint?: string; tags?: string[] } | undefined, personaBrief: string | null | undefined, n: number) => [
      `Write ONE post (exactly one draft) for a general Steem audience. NOT about Steem itself: about life, work, mind, streets, craft, food, nature, ideas.`,
      `TOPIC #${n}: ${topic?.id ?? "?"}: ${topic?.hint ?? ""} (suggested tags: ${(topic?.tags ?? []).join(", ")})`,
      personaBrief ? `THIS ROUND'S AUTHOR (write IN this voice, AT this development stage, slang honored at most once and never forced):\n${personaBrief}` : ``,
      `Body 450-700 words (under 300 words is auto-rejected at the publish gate: write deep, not thin). Title ≤90 chars, curiosity gap, concrete nouns, no listicle vibes. 3-5 lowercase hyphenated tags (one broad topical + 2-3 niche). Open inside a scene, a question, or a mildly surprising claim; never a meta-introduction. End with one genuine, specific question to the reader.`,
      `Return STRICT JSON only, no markdown fences: {"drafts":[{...one draft...}]}`,
    ].filter(Boolean).join("\n");

    const titleTokens = (t: string) => String(t ?? "").toLowerCase().split(/[^a-z0-9\u0590-\u05ff]+/).filter(Boolean);
    const titleSim = (a: string, b: string) => {
      const A = new Set(titleTokens(a));
      const B = new Set(titleTokens(b));
      if (!A.size || !B.size) return 0;
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      return inter / (A.size + B.size - inter);
    };

    const chain = await runLlmChain<Record<string, unknown>[]>({
      purpose: "content",
      /* R309 · ONE CANDIDATE PER TOPIC: every unit is the single-draft
       * shape the provider provably writes fat; the merge collects distinct
       * survivors and satisfied stops as soon as the round is healthy. */
      candidates: [
        ...topics.slice(0, 4).map((t: { id?: string; hint?: string; tags?: string[] }, i) => ({
          name: `single-${i + 1}`,
          call: () => callZai(singleDraftUser(t, personas[i]?.brief ?? null, i + 1), `${SYSTEM_PROMPT}\n\n${SYMBOL_PROMPT_LAW}`),
        })),
        /* R298 · SECOND PROVIDER (env-gated, last): never delays the happy path. */
        ...(nvidiaKeyPresent() && topics.length
          ? [
              {
                name: "nvidia-fallback",
                call: async () => {
                  const raw = await nvidiaChat({
                    system: `${SYSTEM_PROMPT}\n\n${SYMBOL_PROMPT_LAW}`,
                    user: singleDraftUser(topics[0] as { id?: string; hint?: string; tags?: string[] }, null, 1),
                    maxTokens: 2500,
                  });
                  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
                  let drafts: unknown = [];
                  try {
                    const parsed = JSON.parse(jsonText);
                    drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
                  } catch {
                    throw new Error("unparseable nvidia output");
                  }
                  const arr = Array.isArray(drafts) ? (drafts as Record<string, unknown>[]).filter((d) => d && typeof d === "object") : [];
                  if (!arr.length) throw new Error("empty drafts from nvidia provider");
                  return { value: arr, tokens: 0 };
                },
              },
            ]
          : []),
      ],
      /* R309 · THE WORD FLOOR AT THE SOURCE (the measured root cause of the
       * thin-forever loop: the chain was "satisfied" with drafts the engine
       * then rejected as thin — a gate that healed nothing, every cycle).
       * The same law the engine enforces (MIN_POST_WORDS 300) now binds the
       * providers — but as a FILTER, not a poison: the fat drafts of every
       * candidate survive, thin ones die here, and if a candidate is all
       * thin the chain re-asks. Self-healing instead of silent death. */
      validate: (arr) => {
        if (!Array.isArray(arr) || !arr.length) return null;
        const fat = (arr as Record<string, unknown>[]).filter((d) => {
          const o = d as { title?: unknown; body?: unknown };
          if (typeof o?.title !== "string" || typeof o?.body !== "string") return false;
          return String(o.body).trim().split(/\s+/).filter(Boolean).length >= 300;
        });
        return fat.length ? (fat as Record<string, unknown>[]) : null;
      },
      satisfied: (merged) => ((merged?.length ?? 0)) >= 3,
      merge: (acc, next) => {
        const out = [...(acc ?? [])];
        for (const d of next) {
          const twin = out.some((x) => titleSim(String((x as { title?: unknown })?.title), String((d as { title?: unknown })?.title)) >= 0.6);
          if (!twin) out.push(d);
        }
        return out;
      },
      timeoutMs: 30_000,
      /* R299 · FRESHNESS IN THE KEY (measured 96 selfSim refusals/24h): the
       * old key was static across runs (topics rotate by DAY, personas fixed),
       * so a fastpath hit served the IDENTICAL drafts while the queue starved.
       * The key now rotates when the engine's anti-duplicate memory moves
       * (recentTitles) and at least every 30 minutes — a genuine same-tick
       * retry still hits the fastpath, a next-round ask cannot. */
      cacheKey: `content|${topics.map((t) => (t as { id?: string })?.id ?? "").join(",")}|${personas.map((p) => p.account).join(",")}|${createHash("sha256").update(`${recentTitles.join("\u0000")}|${Math.floor(Date.now() / (30 * 60_000))}`).digest("hex").slice(0, 12)}`,
    });
    if (!chain.ok || !chain.output) {
      return NextResponse.json(
        { ok: false, error: `llm-chain exhausted (${chain.errorClass ?? "unknown"})`, chain: { attempts: chain.attempts, ms: chain.ms } },
        { status: 502 },
      );
    }
    let drafts: unknown = chain.output;
    /* R283 · THE SYMBOL LAW GATE — every draft's title and body ride the
     * normalizer, a draft that still carries a banned glyph is dropped here
     * so the queue never fills with text the operator has banned */
    if (Array.isArray(drafts)) {
      drafts = drafts
        .map((d) => {
          const o = d as { title?: unknown; body?: unknown };
          const title = enforceSymbolLaw(String(o?.title ?? ""));
          const body = enforceSymbolLaw(String(o?.body ?? ""));
          if (title === null || body === null) return null;
          return { ...(o as object), title, body };
        })
        .filter(Boolean);
    }
    return NextResponse.json({
      ok: true,
      drafts,
      chain: { selected: chain.selected, attempts: chain.attempts, cacheHit: chain.cacheHit, ms: chain.ms, draftsRaw: chain.output.length },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 502 }
    );
  }
}
