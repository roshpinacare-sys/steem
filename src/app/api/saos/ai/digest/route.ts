import { NextResponse } from "next/server";
import { guardAiBridge, shieldReject } from "@/lib/exposureShield";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * T-38 · DIGEST BRIDGE (engine-called, backend-only law).
 * Adopted from Sumanth077/Hands-On-AI-Engineering (examined live, T-37):
 * the "Daily AI News Digest"/"Hacker News Newsletter Agent" CONTENT-SHAPE —
 * top-N sourced findings of the window → one cited digest post. SAOS fuses
 * it into the EXISTING content team: this bridge drafts, the engine decides
 * (sanitizeDigest in pure code re-checks every law before anything queues).
 * Digest law differs from discussion drafts: a digest WITHOUT citations is
 * not a digest — every item must carry its source link, and every number
 * must be copied verbatim from the findings provided (never invented).
 */
const SYSTEM_PROMPT = `You are a careful news-digest editor for an independent blockchain-technology researcher publishing on the Steem community.
HARD LAW (violations make a draft unusable):
- Never reveal, hint at, or enable inference of coordinated multi-account activity, automation collectives, internal codenames, or that any accounts are connected. Write as one independent author.
- No financial advice, no profit promises, no price predictions or targets, no solicitation.
- A digest is CITATIONS OR NOTHING: every listed item MUST include a markdown link to its provided source URL. Never invent or alter URLs.
- NUMBER-TRUTH (hard): copy numbers EXACTLY as they appear in the provided findings — never round differently, never rescale, never shift commas. If a finding carries no number, write none.
- Fact-first lede: the FIRST paragraph must state what the digest covers and how many items, with one concrete verifiable detail from the findings.
- Neutral editor tone: summarize what the source says, attribute it ("per <source host>"), no editorializing on prices or investments.
Output STRICT JSON only, no markdown fences:
{"drafts":[{"title":"...","body":"...","tags":["tag1","tag2"],"angle":"digest","groundedOn":["source title 1","source title 2"]}]}`;

export async function POST(req: Request) {
  /* T-35 EXPOSURE SHIELD: same law as every AI bridge — same-origin (browser)
   * or token-carried (engine) only, never public */
  const refused = shieldReject(guardAiBridge(req));
  if (refused) return refused;
  let body: { findings?: unknown; exposureLaw?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "json-body required" }, { status: 400 }); }

  /* findings arrive pre-filtered by the engine (with url + snippet) — the
   * bridge caps the window so one prompt stays bounded and grounded */
  const findings = (Array.isArray(body.findings) ? body.findings : [])
    .filter((f): f is { title?: string; url?: string; host?: string; snippet?: string } =>
      !!f && typeof f === "object" && typeof (f as { url?: unknown }).url === "string" && (f as { url?: string }).url!.length > 0)
    .slice(0, 8);
  const law = Array.isArray(body.exposureLaw) ? body.exposureLaw : [];
  if (findings.length < 2) {
    return NextResponse.json({ ok: false, error: "a digest needs ≥2 sourced findings — refusing to draft from thin air" }, { status: 422 });
  }

  const userPrompt = [
    `Draft ONE daily digest post (a "what happened in Steem/Web3 today" brief) from EXACTLY these ${findings.length} sourced findings.`,
    "Format inside the body:",
    "- First paragraph: fact-first lede (what this digest covers + item count + one concrete detail).",
    `- Then ${Math.min(findings.length, 5)} items, each starting with "- **[source title](source url)**" followed by a 1-2 sentence neutral summary attributed to its source host.`,
    "- Optional 1-sentence closing question to the community.",
    "Title: ≤100 chars, concrete, includes the word Digest. Tags: 3-5 lowercase hyphenated.",
    "",
    "EXPOSURE LAW (hard):",
    ...(law.length ? law.map((l) => `- ${l}`) : []),
    "",
    "SOURCED FINDINGS (the ONLY permitted items — title / url / host / snippet):",
    findings.map((f) => `- title: ${f.title ?? "?"}\n  url: ${f.url}\n  host: ${f.host ?? "?"}\n  snippet: ${String(f.snippet ?? "").slice(0, 300)}`).join("\n"),
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
    /* T-27 FAILOVER RAIL (freellmapi, env-gated) — same contract as the
     * content bridge: typed fallback note, never a silent pretend-success */
    const fbUrl = process.env.SAOS_FREELLMAPI_URL;
    const fbKey = process.env.SAOS_FREELLMAPI_KEY;
    const primaryErr = String((e as Error)?.message ?? e).slice(0, 160);
    if (fbUrl && fbKey) {
      try {
        const r = await fetch(`${fbUrl.replace(/\/$/, "")}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${fbKey}` },
          body: JSON.stringify({
            model: process.env.SAOS_FREELLMAPI_MODEL || "auto",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const d = (await r.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
        const raw = d?.choices?.[0]?.message?.content ?? "";
        const drafts = parseDrafts(raw);
        if (drafts) return NextResponse.json({ ok: true, drafts, at: new Date().toISOString(), via: "freellmapi" });
        return NextResponse.json({ ok: false, error: primaryErr, fallback: `freellmapi:unparseable (${r.status})` }, { status: 502 });
      } catch (e2) {
        return NextResponse.json({ ok: false, error: primaryErr, fallback: `freellmapi:failed:${String((e2 as Error)?.message ?? e2).slice(0, 100)}` }, { status: 502 });
      }
    }
    return NextResponse.json(
      { ok: false, error: primaryErr, fallback: "freellmapi:not-configured (set SAOS_FREELLMAPI_URL+SAOS_FREELLMAPI_KEY to arm the failover rail)" },
      { status: 502 }
    );
  }
}

/* strict-JSON parse shared shape with the content bridge: strip fences AND
 * scan every balanced {...} block; only a real JSON.parse with drafts[] wins */
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
