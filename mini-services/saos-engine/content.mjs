/**
 * content.mjs — R240 · THE CONTENT INTELLIGENCE (מהפכת-התוכן: מטא→אנושי).
 *
 * Operator order 2026-10-07 (verbatim intent): "זה ממש לא מעניין מה שאנחנו
 * שולחים. צריך שיהיה עניין רב לפוסטים ולא סתם... להרים אינטליגנציה משמעותית".
 *
 * WHAT CHANGED (measured root causes of the boring feed):
 *  · the old pool fed ONLY meta-angles about Steem itself → every fleet post
 *    was "how effective is steem's curation system" (the chain proves it);
 *  · eleven accounts drew from the same telemetry grounding → near-duplicate
 *    titles on the same day (dual-token ×2, workflow ×2 on 2026-10-06/07);
 *  · no voice separation → one bot in eleven hats.
 *
 * NOW: an 18-domain HUMAN topic pool (day-rotated), an 11-voice persona
 * matrix, and a Jaccard title-dedupe against everything already published.
 * Drafting stays bridge-gated (LLM behind the cockpit) and the exposure law
 * still blocks in pure code. No draft is ever broadcast here — the rail
 * decides, doctrine caps own the volume.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readCorpus } from "./intel-pack.mjs";
import { conceptLadder, consumeShortlist } from "./content-concepts.mjs"; /* R307: the ladder feeds the writers' room */
import { loadDNA } from "./content-judge.mjs";
import { loadMemory } from "./content-memory.mjs";
import { illustrateDraft } from "./illustrate.mjs";
import { PERSONAS, PERSONA_IDS, assignPersonas, personaBrief, personaOf } from "./personas.mjs";
import { bridgeOpen, noteBridgeFailure, noteBridgeSuccess } from "./bridge-guard.mjs";
import { broadcastTitles } from "./social-streamer.mjs"; /* R311: the FULL anti-twin shield — every title that ever breathed on-chain blocks its twins */

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "content-ops.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
/* R243 FIX: readJson/writeJson were lost in a pre-R243 refactor — every
 * runContent call crashed with ReferenceError before doing anything (the
 * chain audit's "queue starving" symptom, second root cause). Restored,
 * atomic-write style, identical to army-social.mjs. */
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
/* R308 FIX: appendLine was lost in the same pre-R243 refactor that dropped
 * readJson/writeJson — the variety-dropped / thin-purged / sanitize-rejected
 * event rows could never fire (a crash inside runContent, silently eaten by
 * the step-wrap). Restored, identical to army-social.mjs. */
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
/* R240: 4h → 2h — 11 publishers × ≤1 post/day need a deeper queue, and the
 * dedupe gate now makes a bigger queue SAFE (junk can no longer slip in as
 * "the only option"). */
const CADENCE_MS = Number(process.env.SAOS_CONTENT_CADENCE_MS) || 2 * 3600_000;

/* ── R240 · THE HUMAN TOPIC POOL (pure) ──────────────────────────────────────
 * Universal, human-interest domains. Zero "Steem about Steem". Each entry is
 * a seed for the bridge writer's room, not a template — the LLM builds the
 * concrete piece, the engine only owns ROTATION and DIVERSITY. */
export const TOPIC_POOL = [
  { id: "attention", hint: "where attention actually goes in a normal day, and the small cost of that", tags: ["life", "psychology"] },
  { id: "habits", hint: "one tiny habit that quietly compounds (no productivity-guru tone)", tags: ["life", "health"] },
  { id: "slow-learning", hint: "learning something the slow way and what fast tutorials skip", tags: ["education", "life"] },
  { id: "street", hint: "a street, a corner, a market: what an attentive eye notices there", tags: ["life", "photography"] },
  { id: "waiting", hint: "the psychology of waiting rooms, queues, and delays", tags: ["psychology", "life"] },
  { id: "tools", hint: "the three tools actually used vs the drawer of hoarded ones", tags: ["tools", "life"] },
  { id: "food-memory", hint: "a dish that carries a memory; the smell before the story", tags: ["food", "life"] },
  { id: "walking", hint: "walking as thinking: routes, loops, and the ideas that arrive mid-step", tags: ["life", "health"] },
  { id: "ideas", hint: "one book or idea that changed one small concrete thing", tags: ["writing", "philosophy"] },
  { id: "repair", hint: "repair culture: fixing instead of replacing, and what the object teaches", tags: ["diy", "life"] },
  { id: "everyday-money", hint: "the psychology of everyday spending choices (observational, never advice)", tags: ["psychology", "life"] },
  { id: "urban-nature", hint: "nature inside the city: the pigeon, the fig tree in the crack, the weather", tags: ["nature", "life"] },
  { id: "craft", hint: "craft and patience: what making something by hand does to time", tags: ["craft", "life"] },
  { id: "digital-minimal", hint: "what one week with fewer screens actually feels like (honest, not preachy)", tags: ["life", "technology"] },
  { id: "questions", hint: "questions worth asking a stranger; the answers people remember", tags: ["life", "psychology"] },
  { id: "seasons", hint: "seasons and routines: how light and weather reshape a working day", tags: ["life", "nature"] },
  { id: "language", hint: "language quirks, translation slips, and the words that refuse to migrate", tags: ["writing", "life"] },
  { id: "objects", hint: "memory and objects: why one old tool beats a shelf of new ones", tags: ["life", "story"] },
  { id: "on-chain-publishing", hint: "what a blockchain post can carry that a blog cannot: permanent tables, collapsible sections, embedded legal images, and formatting that survives every reader", tags: ["writing", "technology"] },
  { id: "post-craft", hint: "the craft of a post that earns a reply: the opener, the honest detail, the question that actually gets answered", tags: ["writing", "life"] },
];

/** pure: day-seeded rotation of n distinct topics from the pool */
export function topicRotationFor(dayIso, n = 4) {
  const dayMs = Date.parse(dayIso);
  const dayIdx = Number.isFinite(dayMs) ? Math.floor(dayMs / 86400000) : 0;
  const start = ((dayIdx % TOPIC_POOL.length) + TOPIC_POOL.length) % TOPIC_POOL.length;
  const out = [];
  for (let i = 0; i < Math.min(n, TOPIC_POOL.length); i++) out.push(TOPIC_POOL[(start + i * 5) % TOPIC_POOL.length]);
  return out;
}

/* ── R240 · THE VOICE MATRIX (pure) — one author, one voice ──────────────────
 * The chain showed one bot in eleven hats; the bridge now gets an explicit
 * voice per draft so the feed reads like people, not a syndicate. */
export const VOICES = {
  headcorner: "steady and precise; likes honest arithmetic, plain checklists, and the calm satisfaction of a thing measured right",
  cashmachine: "plain talker about how money actually moves; concrete examples, zero advice, a little dry humor",
  haran: "patient tool explainer; breaks a how-to into small steps and warns about the one mistake everyone makes",
  israelnews: "newsroom brevity; what happened, why it matters, one detail that sticks",
  lsa: "story-first; small human details, a scene before a point, warmth without sugar",
  macrame: "hands-on crafter; cord, knots, materials and their real prices; respects patience",
  siq: "quiet observer; sensory detail, curious questions, notices what others walk past",
  tov: "warm community voice; small wins, mutual help, the good of doing things together",
  wic: "slow philosopher; short calm sentences, one idea given room, asks the deep question gently",
  wog: "curious skeptic; tests claims, enjoys busting a myth with an everyday proof",
  woq: "aphoristic questioner; one sharp question, a compact answer, an open door at the end",
};
export function voiceOf(account) { return VOICES[account] ?? "clear, friendly, concrete"; }

/* ── R240 · TITLE DEDUPE (pure) — kill the duplicate-topic bug ─────────────── */
const STOP = new Set(["a", "an", "the", "of", "on", "in", "to", "for", "and", "or", "is", "are", "your", "you", "how", "what", "why", "with", "that", "this", "it", "its", "at", "from", "my", "we", "our"]);
export function titleTokens(t) {
  /* R311 · THE STEM (measured escape: "Understanding Blockchain Curation
   * Rewards" vs "Understanding Steem's Curation Reward System" scored 0.5
   * (below the 0.55 gate) because reward/rewards didn't match — the pair
   * PUBLISHED as near-twins. Stripping the plural 's' scores 0.75: caught. */
  return new Set(String(t ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !STOP.has(w)));
}
export function titleSimilarity(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
/** pure: keep drafts whose titles are NOT near-duplicates of recent published ones (or of each other) */
export function dedupeTitles(drafts, recentTitles, { threshold = 0.55 } = {}) {
  const kept = [], dropped = [];
  const seen = [];
  for (const d of (drafts ?? [])) {
    const t = String(d?.title ?? "");
    const clash = seen.some((s) => titleSimilarity(t, s) >= threshold)
      || (recentTitles ?? []).some((s) => titleSimilarity(t, s) >= threshold);
    if (clash) dropped.push(t.slice(0, 80));
    else { kept.push(d); seen.push(t); }
  }
  return { kept, dropped };
}

/* ── R243 · OLD-STOCK VETO (pure) ────────────────────────────────────────────
 * The queue shipped pre-R240 SEO stock for days (chain truth: a 2026-10-01
 * draft went live on 10-07). A draft drafted before the R240 rebirth is
 * INELIGIBLE for broadcast forever — the writers' room changed, the old
 * queue does not get to speak. */
export const PUBLISH_ELIGIBLE_SINCE = "2026-10-07T10:00:00.000Z";
export function eligibleDrafts(queue, sinceIso = PUBLISH_ELIGIBLE_SINCE) {
  return (Array.isArray(queue) ? queue : [])
    .filter((d) => d?.status === "drafted" && String(d?.draftedAt ?? "") >= sinceIso);
}

/** exposure law — every draft is checked AGAINST it in the pure normalizer */
const EXPOSURE_LAW = [
  "never reveal, hint at, or enable inference of coordinated multi-account activity, automation, internal codenames, or that any accounts are connected",
  "no financial advice, no profit promises, no price targets",
  "no fabricated personal identities: no invented family members, no named real places as personal history; write as a general human observer",
  "no AI telltales: never open with 'In today's world', never close with 'In conclusion'",
  "NEVER use em dashes or en dashes (— or –), double quotes, or colons ANYWHERE — the symbol law (R283 operator order) rewrites them (dashes to comma pauses, quotes dropped, colons to periods): write clean from the start with periods, commas, and parentheses",
  "professional developer slang is welcome in moderation: ship it, under the hood, edge case, back-of-envelope math, debug, iterate, close the loop, race condition, the happy path, tech debt — used naturally, never forced",
  "supportive community tone — teach, ask, answer; public knowledge only",
  "SEO: concrete curiosity title, 3-5 topical tags, first paragraph must stand alone",
];

/* R254 · THE STYLE LAW the operator ordered (verbatim intent): "תעשה שאף
 * אחד לא יכתוב עם — כאלה יותר מדי וקצת סלנגים מקצועיים של מפתחים וכו
 * לשפר עוד". The bridge gets it in the payload; the pure normalizer
 * ENFORCES it in code (see normalizeDashes + sanitizeDraft). */
export const STYLE_LAW = {
  dashes: "never emit em/en dashes (—, –), double quotes, or colons: write with periods, commas, and parentheses (the symbol law rewrites any stragglers)",
  slang: [
    "ship it", "under the hood", "edge case", "back-of-envelope math", "debug",
    "iterate", "close the loop", "race condition", "the happy path", "tech debt",
    "rubber-duck it", "hotfix", "refactor", "the long tail", "fallthrough",
  ],
  slangGuidance: "sprinkle at most one or two per post, only where a real developer would say them",
};

/* R262 · THE FORMAT LAW (operator order, verbatim intent): "צריך להבין מה
 * אפשר לעשות עם פוסט אם אפשר html עד איזה רמה מה נוכל לעשות בפוסטים" —
 * the chain stores the body RAW; frontends sanitize. What RENDERS on
 * Steemit/PeakD/Ecency: markdown + a safe HTML subset (headings, bold,
 * italics, lists, tables, blockquotes, code blocks, <center>, <sub>/<sup>,
 * <hr>, <details>/<summary> collapsibles, https images). What NEVER ships:
 * <script>, <style>, <iframe>, on-* attributes, javascript: URLs — they are
 * stripped by every frontend, so writing them is noise at best. The writer's
 * room may now FORMAT like professionals: a table for real comparisons, a
 * collapsible TL;DR, a centered pull-quote. Structure is content. */
export const FORMAT_LAW = {
  allowed: [
    "markdown: headings #..####, bold, italics, lists, blockquotes, fenced code blocks, links, https images",
    "safe HTML subset that renders on all major frontends: <center>, <hr>, <sub>, <sup>, <blockquote>, tables (<table><tr><th><td>), <details><summary> collapsible sections",
  ],
  forbidden: [
    "<script>, <style>, <iframe>, <object>, <embed>, on-* attributes, javascript: URLs — every frontend strips them",
    "image hotlinks from non-https or non-Wikimedia sources in posts we ship (the rail embeds only upload.wikimedia.org with mandatory attribution)",
  ],
  guidance: "use structure only where it serves the reader: one table for a real comparison, one collapsible for an optional deep-dive, centered pull-quote at most once. Formatting is seasoning, not the dish.",
};

/* R283 · THE SYMBOL LAW (operator order 2026-10-08, the strictest ban):
 * these glyphs NEVER appear in ANY outbound text — title, post, reply,
 * comment — in any state, anywhere — the dash glyphs, every double-quote
 * glyph, and the colon. The old normalizer REWROTE dashes into colons
 * (": ") which merely traded one banned mark for another; the chain audit
 * measured 120 of 235 live bodies carrying banned glyphs. The new law:
 * normalize into safe readable punctuation, then FAIL CLOSED on anything
 * that still carries a banned glyph. A URL inside markdown is protected
 * (it renders as an image or link, it is not visible prose). */
export const SYMBOL_LAW_BANNED = /[\u2014\u2013\u2012\u2015:"\u201c\u201d]/;

export function enforceSymbolLaw(text) {
  let t = String(text ?? "");
  if (!t) return "";
  /* protect markdown link/image targets and bare URLs from the colon rewrite */
  const urls = [];
  t = t.replace(/\]\(([^)\s]+)\)/g, (m, u) => { urls.push(u); return `]\u0000${urls.length - 1}\u0000)`; });
  t = t.replace(/\bhttps:\/\/[^\s)]+/g, (u) => { urls.push(u); return `\u0000${urls.length - 1}\u0000`; });
  t = t
    .replace(/(\s*)[\u2014\u2013\u2012\u2015](\s*)/g, ", ")      /* any dash glyph → comma pause */
    .replace(/["\u201c\u201d]/g, "")                             /* double quotes → dropped, words stay */
    .replace(/:\s*([a-z])/g, (m, c) => `. ${c.toUpperCase()}`)   /* sentence colon → period + capital */
    .replace(/(\s*):(\s*)/g, ". ")                               /* any leftover colon → period */
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  /* the glyph test runs on the MASKED text (a URL is not visible prose) */
  if (SYMBOL_LAW_BANNED.test(t)) return null;
  t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => `${urls[Number(i)] ?? ""}`);
  return t;
}

/* R254 → R283: the dash normalizer is now the symbol law — dashes rewrite to
 * comma pauses (NEVER to colons, which are equally banned by the operator),
 * double quotes drop, colons rewrite to periods. Kept as an alias because
 * every rail already calls it. */
export function normalizeDashes(text) {
  return enforceSymbolLaw(text);
}

/* R270 · THE ANTI-GENERIC OPENERS (operator order: "התגובות שלנו הן די
 * דומות מאוד... אני לא מסוגל לראות את הדבר הגנרי הזה"). These AI-stock
 * openings are the fingerprint of machine-generated filler; a post that
 * starts like every other AI post is dead on arrival. The ban checks the
 * OPENING slice only (first 140 chars) so a mid-body mention stays legal. */
export const GENERIC_POST_OPENERS = [
  "in this article", "in this post", "in this guide", "let's dive", "lets dive", "let's get started",
  "as we all know", "it's no secret", "it is no secret", "in the ever-evolving", "ever-evolving world",
  "in today's fast-paced", "in today's world", "in the world of", "welcome to the future",
  "have you ever wondered", "have you ever asked", "are you tired of", "unlock the", "unleash the",
  "embark on a journey", "journey into", "delve into", "dive into the world", "a tapestry of",
  "in conclusion", "to sum up", "at the end of the day", "game-changer", "game changer",
  "the digital landscape", "the rapidly evolving", "revolutionize the way", "in the realm of",
];

/** pure: the opening slice a generic-opener check sees (R270) */
export function openingSlice(text, chars = 140) {
  return String(text ?? "").trim().slice(0, chars).toLowerCase();
}

/** pure (R270): trigram Jaccard similarity between two openings. A local
 * twin of army-social's ngram law (no import cycle: army-social imports
 * content.mjs, so the similarity math lives here too). */
export function openingSimilarity(a, b) {
  const words = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);
  const tri = (t) => {
    const w = words(t); const s = new Set();
    for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(" "));
    if (!s.size && w.length) s.add(w.join(" "));
    return s;
  };
  const A = tri(a), B = tri(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** pure (R270): the OPENING-VARIETY gate. A draft whose opening is near-
 * identical to something ALREADY published is the "same response every
 * time" complaint in code form: refuse it before it ships. */
export function openingFresh(body, publishedBodies, { maxSimilarity = 0.4 } = {}) {
  const opening = openingSlice(body, 220);
  if (!opening) return false;
  return !(Array.isArray(publishedBodies) ? publishedBodies : [])
    .some((b) => openingSimilarity(opening, openingSlice(b, 220)) >= maxSimilarity);
}

export function contentState() { return readJson(FILE, null); }

/** pure: word count — the R244 anti-shitpost floor counts WORDS, not chars
 * (chain truth R244: live posts ran 100–220 words = spam-detector tier) */
export function wordCount(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}
export const MIN_POST_WORDS = Number(process.env.SAOS_MIN_POST_WORDS) || 300;

/** pure: validate one draft against the exposure law (selftest-vectorable)
 * R254: dashes are NORMALIZED first (nobody writes with "—": it is rewritten
 * to legal punctuation before the ban check, so a whole draft no longer
 * burns for one dash), and an optional LEGAL image (illustrate.mjs: Wikimedia
 * Commons with mandatory attribution) rides along as {url, alt, credit}. */
export function sanitizeDraft(d) {
  if (!d || typeof d !== "object") return null;
  const title = enforceSymbolLaw(String(d.title ?? "").trim());
  const body = enforceSymbolLaw(String(d.body ?? "").trim());
  if (title === null || body === null) return null; // R283 SYMBOL-LAW-REFUSED (fail-closed)
  if (title.length < 12 || wordCount(body) < MIN_POST_WORDS) return null; // a real post, not a stub (R244: 300-word spam-safety floor)
  const tags = (Array.isArray(d.tags) ? d.tags : [])
    .map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24))
    .filter(Boolean).slice(0, 5);
  if (tags.length < 2) return null;
  const blob = `${title}\n${body}`.toLowerCase();
  const banned = ["headcorner", "saos", "צבא", "army of accounts", "our accounts", "multi-account", "we control", "our fleet", "guaranteed profit", "price target", "in today's world", "in conclusion", "—", "–", ":", '"', "\u201c", "\u201d"];
  if (banned.some((w) => blob.includes(w))) return null; // EXPOSURE-BLOCKED (R283: the symbol law rides here too)
  /* R270: the opening must not be an AI-stock opener (title OR first 140 chars) */
  const open = `${title.toLowerCase()}\n${openingSlice(body)}`;
  if (GENERIC_POST_OPENERS.some((g) => open.includes(g))) return null; // GENERIC-BLOCKED
  let image = null;
  if (d.image && typeof d.image === "object") {
    const url = String(d.image.url ?? "");
    const alt = String(d.image.alt ?? "").trim().slice(0, 160);
    const credit = String(d.image.credit ?? "").trim().slice(0, 300);
    if (/^https:\/\/upload\.wikimedia\.org\//.test(url) && alt && credit) image = { url, alt, credit };
  }
  return {
    title: title.slice(0, 160), body: body.slice(0, 8000), tags, image,
    angle: String(d.angle ?? "").slice(0, 300) || null,
    voice: String(d.voice ?? "").slice(0, 300) || null,
    seoNote: String(d.seoNote ?? "").slice(0, 300) || null,
    groundedOn: Array.isArray(d.groundedOn) ? d.groundedOn.slice(0, 4).map((g) => String(g).slice(0, 160)) : [],
  };
}

/** pure: the already-published titles from the queue (dedupe memory) */
export function recentPublishedTitles(queue, n = 60) {
  return (Array.isArray(queue) ? queue : [])
    .filter((d) => d?.status === "published" && d?.title)
    .map((d) => String(d.title))
    .slice(0, n);
}

export async function runContent({ now = new Date().toISOString(), force = false } = {}) {
  const prev = readJson(FILE, null);
  const lastMs = prev?.draftedAt ? Date.parse(prev.draftedAt) : 0;
  /* R264 · THE SELF-HEAL CLAUSE (adversarial-audit finding): the fixed 2h
   * cadence assumed queue depth. Measured live: after the 429 storm the
   * queue sat at ZERO drafted while the gate calmly counted down two more
   * hours — a publishing system that has nothing to publish is not running.
   * LAW: an empty eligible queue overrides the cadence (the writers' room
   * runs now), a fed queue waits its turn. */
  const eligible = (prev?.queue ?? []).filter((d) => d?.status === "drafted" && String(d?.draftedAt ?? "") >= PUBLISH_ELIGIBLE_SINCE).length;
  const starved = eligible === 0;
  if (!force && !starved && Number.isFinite(lastMs) && Date.now() - lastMs < CADENCE_MS) {
    return { verdict: "CADENCE-GATED", lastAt: prev.draftedAt, draftsQueued: (prev.queue ?? []).filter((d) => d.status === "drafted").length };
  }
  /* grounding (R240: light now — topics+voices own the diversity; telemetry
   * stays available for the bridge but can no longer drag every post back to
   * machine metrics) */
  const intel = readJson(path.join(STATE, "webintel.json"), null);
  const findings = (intel?.scans ?? []).flatMap((s) => (s.findings ?? []).slice(0, 2)).slice(0, 6)
    .map((f) => ({ title: f.title, host: f.host, url: f.url }));
  const topics = topicRotationFor(now, 6);
  const voices = Object.entries(VOICES).map(([account, voice]) => ({ account, voice }));
  /* R255 · THE PERSONA SHEETS ride with the payload: each draft is written BY
   * a persona (name, lens, traits, personal slang, pro/hood register, owned
   * topics) AT ITS MEASURED development stage (lifetime posts from army.json
   * — chain truth, not vibes). The feed now reads like people who grew. */
  const army = readJson(path.join(STATE, "army.json"), null);
  const lifetimeOf = (a) => (army?.accounts?.[a]?.published ?? []).length;
  const personas = PERSONA_IDS
    .map((id) => ({ account: id, brief: personaBrief(id, lifetimeOf(id)), owns: PERSONAS[id].owns }))
    .filter((p) => p.brief);
  const recentTitles = [
    ...new Set([
      ...recentPublishedTitles(prev?.queue, 60),
      ...broadcastTitles(80), /* R311 · FULL-PUBLISHED SHIELD: the sent ledger is the truth of what already aired; the old 12-title window let corpus twins through */
    ]),
  ].slice(0, 140);
  /* R299 · THE SPENT-TITLES MEMORY (measured 96 selfSim refusals/24h): the
   * queue is bounded (30) and rotates, but the CORPUS is static — titles that
   * already published or were refused leave the queue and the floor re-served
   * them forever; the spamgate then refused the identical body 100% of the
   * time (chain truth: "I Tested It..." published 10-08, re-served 3× on 10-09).
   * The memory outlives the queue rotation: spent = refused ∪ vetoed ∪
   * published ∪ currently-queued, bounded, persisted in the doc itself. */
  const spentTitles = [
    ...new Set([
      ...(Array.isArray(prev?.spentTitles) ? prev.spentTitles : []),
      ...(Array.isArray(prev?.queue) ? prev.queue : []).map((d) => String(d?.title ?? "")).filter(Boolean),
    ]),
  ].slice(-60);
  const t0 = Date.now();
  let raw = null, bridgeError = null;
  /* R244: SAOS_OFFLINE=1 (CI / sovereign mode) never dials the bridge — the
   * corpus is the writers' room, the conversation does not depend on any
   * single machine. */
  if (process.env.SAOS_OFFLINE === "1") {
    bridgeError = "offline-mode (SAOS_OFFLINE=1)";
  } else if (!bridgeOpen()) {
    /* R263 · THE CIRCUIT BREAKER: a 429 storm is open — the writers' room
     * does not dial the provider at all this round; the corpus floor speaks
     * and the queue stays fed. One honest note, zero wasted calls. */
    bridgeError = "bridge-circuit-open (429 storm cooldown)";
  } else {
    /* R263 · THE BRIDGE RETRY (measured root cause of BRIDGE-DOWN at 01:09Z:
     * LLM provider 429). ONE honest retry after a short cooldown before the
     * corpus floor takes over — rate limits are transient weather; a starving
     * draft queue is structural damage. The route itself retries internally
     * too; this second attempt covers a whole-route failure (502, compile,
     * restart). */
    const attempt = async () => {
      const r = await fetch(`${BRIDGE}/api/saos/ai/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics, voices, personas, recentTitles, findings, exposureLaw: EXPOSURE_LAW, styleLaw: STYLE_LAW, formatLaw: FORMAT_LAW }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`bridge ${r.status}`);
      return r.json();
    };
    try {
      raw = await attempt();
      noteBridgeSuccess();
    } catch (e) {
      bridgeError = String(e?.message ?? e).slice(0, 160);
      noteBridgeFailure(`content:${bridgeError}`);
      if (bridgeOpen()) {
        await new Promise((res) => setTimeout(res, Number(process.env.SAOS_CONTENT_BRIDGE_RETRY_MS) || 20_000));
        try { raw = await attempt(); bridgeError = null; noteBridgeSuccess(); } catch (e2) { bridgeError = String(e2?.message ?? e2).slice(0, 160); noteBridgeFailure(`content-retry:${bridgeError}`); }
      }
    }
  }

  /* R244 · THE OFFLINE FLOOR: bridge down / CI mode → the sovereign corpus
   * speaks (hand-crafted pillar posts mined into git — the intelligence lives
   * IN the tree, so content survives any sandbox wipe by design). */
  if (!raw) {
    const corpus = readCorpus();
    raw = { drafts: corpus.map((c) => ({ id: c.id, title: c.title, body: c.body, tags: c.tags, angle: c.angle, voice: c.voice, persona: personaOf(c.voice) ? c.voice : null, groundedOn: [c.topic] })) }; /* R307: the corpus id rides with the draft — the ladder consumes by id */
  }
  /* R255: personas assigned at the gate — explicit draft.persona wins, else
   * topic-ownership round-robin; no voice writes twice in one batch. */
  const rawDrafts = raw?.drafts ?? [];
  /* R307 · SHORTLIST CONSUMPTION (T-85, trace 1a139111c47003e9): the R304
   * ladder feeds the writers' room. Drafts are MEASURED against the
   * shortlist every round (observe, always); when the signed DNA sets
   * memory.conceptsEnforce=true, corpus drafts are REORDERED shortlist-first
   * — the queue competes on the ladder instead of corpus order (T-84 §5.1,
   * exactly as queued). Never drops a draft, never gates a publish
   * (spamgate/R297/R301/R302 keep every death); bridge drafts are measured,
   * never reordered (not corpus entries). Ladder/DNA/memory failure
   * degrades honestly to observe with available:false — the floor never
   * starves because a mirror sneezed. */
  let draftsForQueue = rawDrafts;
  let conceptAlignment = { law: "R307", mode: "observe", available: false, note: "not-run" };
  try {
    const dnaR307 = loadDNA();
    const ladderR307 = conceptLadder({ corpus: readCorpus(), dna: dnaR307, memory: loadMemory(STATE), goal: "thought_leadership", limit: 4 });
    const consumedR307 = consumeShortlist({ drafts: rawDrafts, ladder: ladderR307, dna: dnaR307, source: raw && bridgeError?.startsWith("offline") ? "corpus" : "bridge" });
    draftsForQueue = consumedR307.drafts;
    conceptAlignment = consumedR307.alignment;
    if (conceptAlignment.reordered > 0) {
      appendLine(path.join(STATE, "events.jsonl"), { type: "content.concepts-consumed", at: now, mode: conceptAlignment.mode, reordered: conceptAlignment.reordered, aligned: conceptAlignment.aligned, topId: conceptAlignment.topId });
    }
  } catch (e) {
    conceptAlignment = { law: "R307", mode: "observe", available: false, error: String(e?.message ?? e).slice(0, 140) };
  }
  /* R308 · REJECTION DIAGNOSIS LAW: a blocked draft is never blind again —
   * every sanitize refusal is reason-coded into events (the exposure gate
   * stays fail-closed; only the silence dies). */
  const sanitizeReasons = {};
  const sanitized = assignPersonas(draftsForQueue.map((d) => {
    const ok = sanitizeDraft(d);
    if (!ok) {
      const t = enforceSymbolLaw(String(d?.title ?? ""));
      const b = enforceSymbolLaw(String(d?.body ?? ""));
      const r = t === null || b === null ? "symbol-law"
        : t.length < 12 || wordCount(b) < MIN_POST_WORDS ? "thin"
        : (Array.isArray(d?.tags) ? d.tags.filter(Boolean) : []).length < 2 ? "tags"
        : "banned-or-generic";
      sanitizeReasons[r] = (sanitizeReasons[r] ?? 0) + 1;
      return null;
    }
    return ok;
  }).filter(Boolean));
  const exposureBlocked = draftsForQueue.length - sanitized.length; /* R307: reorder never drops — same count either way */
  if (exposureBlocked > 0) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "content.sanitize-rejected", at: now, blocked: exposureBlocked, reasons: sanitizeReasons });
  }
  const { kept, dropped } = dedupeTitles(sanitized, [...new Set([...recentTitles, ...spentTitles])]);
  /* honest count: how many of the drops were caused by the spent memory
   * (a re-served spent title blocked BEFORE it could waste a spamgate run) */
  const spentBlocked = dropped.filter((t) => spentTitles.some((s) => titleSimilarity(t, s) >= 0.55)).length;
  /* R270 · THE OPENING-VARIETY GATE: a draft that opens like an ALREADY
   * PUBLISHED post is the "same response every time" complaint in code form;
   * it is dropped here (counted honestly) before the queue ever sees it. */
  const publishedOpenings = (prev?.queue ?? [])
    .filter((d) => d?.status === "published" && d?.body)
    .map((d) => String(d.body));
  const varietyKept = kept.filter((d) => openingFresh(d.body, publishedOpenings));
  const varietyDropped = kept.length - varietyKept.length;
  if (varietyDropped > 0) appendLine(path.join(STATE, "events.jsonl"), { type: "content.variety-dropped", at: now, dropped: varietyDropped });
  const keptFinal = varietyKept;
  /* R254 · LEGAL IMAGES: the top kept drafts get a Wikimedia Commons image
   * with mandatory attribution (fail-soft, enrichment never a blocker — an
   * illustrated post carries more interest, per the operator's order). */
  let illustrated = 0;
  if (keptFinal.length) {
    for (const d of keptFinal.slice(0, 3)) {
      try {
        const img = await illustrateDraft(d, { seedNum: (Date.parse(now) || 0) % 997 });
        if (img) { d.image = img; illustrated++; }
      } catch { /* fail-soft per draft */ }
    }
  }
  /* R303 · THIN-PURGE LAW (measured 06:23Z: 9 sub-floor drafts — 108-155
   * words, pre-R244 residue from Oct 1-6 — sat in the bounded queue with
   * status "drafted" and were re-rejected by the revenue compiler's schema
   * gate EVERY cycle: honest SCHEMA-REJECTED rows, zero progress, pure
   * waste). The R244 floor blocks NEW thin drafts at enqueue (sanitizeDraft
   * returns null); this law heals the QUEUE itself: a carried-forward
   * drafted entry survives only if it clears the floor NOW. Stale-thin rows
   * are purged on contact and counted honestly. */
  const carried = Array.isArray(prev?.queue) ? prev.queue : [];
  const thinPurged = carried.filter((d) => d?.status === "drafted" && wordCount(d?.body ?? "") < MIN_POST_WORDS).length;
  if (thinPurged > 0) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "content.thin-purged", at: now, dropped: thinPurged });
  }
  /* R308 · BOUNDED-QUEUE LAW: terminal rows leave the work queue —
   * retired-old-stock drops at once (history lives in the git ledger, not
   * the live queue the operator reads); published rows stay as the opening-
   * variety memory (bounded by the 30 cap). */
  const queueExpired = carried.filter((d) => d?.status === "retired-old-stock").length;
  if (queueExpired > 0) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "content.queue-expired", at: now, dropped: queueExpired });
  }
  const carriedLive = carried.filter((d) => {
    if (d?.status === "drafted") return wordCount(d?.body ?? "") >= MIN_POST_WORDS; /* THIN-PURGE (R303) */
    if (d?.status === "retired-old-stock") return false; /* BOUNDED-QUEUE (R308) */
    return true; /* published rows: opening-variety memory */
  });
  const queue = [
    ...keptFinal.map((d, i) => ({ ...d, id: `d${Date.parse(now)}-${i}`, status: "drafted", draftedAt: now })),
    ...carriedLive,
  ].slice(0, 30); // bounded queue — the rail posts per doctrine caps, never floods

  /* R312 · VERDICT TRUTH LAW (measured false red 2026-10-13→14, GRID-ALERT #3):
   * BRIDGE-DOWN fired while 14 eligible drafts stood in the queue and the
   * publish rail aired 5 posts/24h (truthrail PASS). The old verdict counted
   * only THIS-round keptFinal, conflating "room idle this round" with "the
   * publishing system is down". Truth per R244/R264's own law:
   *   - drafts kept this round              → DRAFTS-QUEUED (the room spoke)
   *   - nothing kept, queue FED             → QUEUED (the rail has work; an
   *     offline-by-design bridge is not a down bridge)
   *   - nothing kept, queue STARVED + bridge error → BRIDGE-DOWN (honest red:
   *     nothing to publish AND no provider — operator grows the corpus)
   *   - nothing kept, queue STARVED, no bridge error → NO-DRAFTS (honest red) */
  const standingDrafts = queue.filter((d) => d?.status === "drafted").length;
  const verdict = keptFinal.length > 0 ? "DRAFTS-QUEUED"
    : standingDrafts > 0 ? "QUEUED"
    : bridgeError ? "BRIDGE-DOWN" : "NO-DRAFTS";

  const doc = {
    draftedAt: now,
    verdict,
    source: raw && bridgeError?.startsWith("offline") ? "corpus" : raw ? "bridge" : "none",
    draftsQueued: keptFinal.length, standingDrafts, exposureBlocked, dedupeDropped: dropped, spentBlocked, illustrated, thinPurged,
    minPostWords: MIN_POST_WORDS,
    conceptAlignment,
    spentTitles: [...new Set([...spentTitles, ...keptFinal.map((d) => String(d?.title ?? ""))])].slice(-60),
    queue,
    law: "R240: נושאים-אנושיים מסבב-יום + קול-אחד-לחשבון + הסרת-כפילויות; חשיפה = נחסמת בטהרת-הנוסח; שידור רק אחרי אימות-חתימה (דוקטרינת-שער)",
    bridgeError,
    ms: Date.now() - t0,
  };
  writeJson(FILE, doc);
  return { verdict: doc.verdict, draftsQueued: keptFinal.length, standingDrafts, exposureBlocked, dedupeDropped: dropped, spentBlocked, illustrated, thinPurged, bridgeError, conceptAlignment };
}

/** recruiter evidence: fresh drafts queued = the content team is really running */
export function contentEvidence(nowMs = Date.now()) {
  const c = readJson(FILE, null);
  if (!c || !c.draftedAt) return null;
  const age = nowMs - Date.parse(c.draftedAt);
  if (!Number.isFinite(age) || age > 26 * 3600_000) return null;
  const n = (c.queue ?? []).filter((d) => d.status === "drafted").length;
  return n > 0 ? `state/content-ops.json: ${n} non-exposing drafts queued (exposure-blocked so far: ${c.exposureBlocked ?? 0}) — broadcast gated on credential` : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runContent({ force: true }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("CONTENT-FAIL", e); process.exit(1); });
}
