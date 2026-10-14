/**
 * content-concepts.mjs — R304 · THE CONCEPT LADDER (T-84, trace 1a138f98b9a80b61)
 *
 * Owner order (same directive, continued): "תתחיל הכי טוב שאפשר בצע שיהיו
 * לנו יכולות סופר אינטילגנטיות" — the deep-dive answer is Open-Pomelli
 * FIRST (hermoso stays deferred per DECISIONS #19: no ad budgets, the
 * network is Steem-organic). Source measured on disk
 * (external/Open-Pomelli/src/lib/campaign-generator.ts + brand-analyzer.ts
 * + platforms.ts): Pomelli generates EXACTLY 4 campaign concepts from a
 * Brand-DNA profile and demands they be "genuinely distinct ... not
 * generic marketing fluff". The engineering lesson for a fleet that
 * shelled itself with 75 duplicated bodies: distinctness must be MEASURED,
 * not prompted.
 *
 * Sovereignty adaptation (no MuAPI, no cloud LLM, no paid rails):
 * Pomelli's brand→concepts LLM call becomes a DETERMINISTIC ladder over
 * the sovereign corpus (content-corpus.json) scored against the signed
 * DNA (content-dna.json, R302). The ladder sits BEFORE drafting — the
 * cheapest death first:
 *   1. SLOP veto (R302 lexicon) — a slop concept never earns a body.
 *   2. MEMORY veto (R303) — a concept resembling a rejected/published
 *      title dies before a draft is ever written (closes the "shallow
 *      memory" hole one stage earlier than the judge does).
 *   3. DISTINCTNESS (the anti-shelling law lifted to concept level) —
 *      greedy keep if pairwise Jaccard(hook+theme) < dna.memory.jaccard.
 *   4. RANK by the DNA quality axes (deterministic, tie-break by title/id).
 * Output is a ranked SHORTLIST (top 4, Pomelli's number) written to state
 * — OBSERVE-ONLY: this module never gates a publish; spamgate (R243),
 * R297 chain-truth, R301 cadence and the R302 judge own those gates.
 * Enforcement (compiler/army-social consuming the shortlist) waits for
 * measured evidence in the heartbeat, exactly like R302's observe-first.
 */

import { slopVerdict, loadDNA } from "./content-judge.mjs";
import { memoryPenalty } from "./content-memory.mjs";
import { jaccard, shingles } from "./spamgate.mjs";

/* Pomelli's six campaign goals (campaign-generator.ts), re-framed organic:
 * the taxonomy is the measured pattern; the CTAs are ours — no paid rails,
 * every CTA points at a ledger, a measurement, or a conversation. */
export const GOALS = {
  product_launch: { cta: "try the tool", frame: "a shipped thing, measured in the open" },
  lead_generation: { cta: "read the full ledger", frame: "one measurable artifact to take away" },
  brand_awareness: { cta: "follow the ledger", frame: "the fleet's work made visible" },
  engagement: { cta: "tell me yours", frame: "one honest question answerable from the reader's own day" },
  thought_leadership: { cta: "measure it yourself", frame: "authority through receipts, not claims" },
  sales: { cta: "see the numbers", frame: "value shown in numbers, not adjectives" },
};

const HOOK_MAX_CHARS = 140; /* a hook that needs scrolling is not a hook */
const DEFAULT_LIMIT = 4;    /* Pomelli's "exactly 4 distinct concepts" */

function openingHook(body) {
  const first = String(body ?? "").split(/\n\s*\n/)[0] ?? "";
  const sentences = first.split(/(?<=[.!?])\s+/).filter(Boolean);
  const hook = (sentences[0] ?? first).trim();
  return hook.length > HOOK_MAX_CHARS ? hook.slice(0, HOOK_MAX_CHARS - 1).trimEnd() + "…" : hook;
}

function axisScore(concept, dna) {
  const w = dna?.quality?.weights ?? {};
  const t = `${concept.title} ${concept.hook}`.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;

  let hook = 0;
  if (words >= 6 && words <= 16) hook += 0.6; else if (words >= 4) hook += 0.3;
  if (/[?]/.test(t)) hook += 0.2;
  if (/\d/.test(t)) hook += 0.2;
  hook = Math.min(1, hook);

  const numbers = (concept.angle.match(/\b\d+(\.\d+)?\b/g) ?? []).length;
  const specificity = Math.min(1, numbers / 3 + ((concept.tags?.length ?? 0) >= 2 && (concept.tags?.length ?? 0) <= 5 ? 0.4 : 0));

  const structure = (concept.theme ? 0.5 : 0) + ((concept.tags?.length ?? 0) > 0 ? 0.5 : 0);

  const len = concept.hook.length;
  const brevity = len <= 120 ? 1 : len <= HOOK_MAX_CHARS ? 0.5 : 0;

  const pillars = (dna?.voice?.pillars ?? []).map((p) => String(p).toLowerCase().split(" ")[0]).filter(Boolean);
  const hay = `${concept.angle} ${concept.title}`.toLowerCase();
  const register = pillars.some((p) => hay.includes(p)) ? 1 : 0.2;

  const axes = { hook, specificity, structure, brevity, register };
  let score = 0;
  for (const k of Object.keys(axes)) score += axes[k] * (w[k] ?? 0);
  return { score: Math.round(score * 10) / 10, axes };
}

/** THE LADDER — deterministic, no clock, no randomness (selftest-safe).
 *  `corpus` = parsed content-corpus.json entries; `memory` = loadMemory()
 *  shape ({published, rejected}) or null (degraded: ladder runs, veto
 *  honestly marked unavailable — same contract as the R302 judge). */
export function conceptLadder({ corpus = [], dna = null, memory = null, goal = "thought_leadership", limit = DEFAULT_LIMIT } = {}) {
  const d = dna ?? loadDNA();
  const g = GOALS[goal] ?? GOALS.thought_leadership;
  const goalKnown = Object.prototype.hasOwnProperty.call(GOALS, goal);
  const jMax = d.memory?.jaccard ?? 0.5;

  const entries = Array.isArray(corpus) ? corpus : [];
  if (!entries.length) {
    return { verdict: "CONCEPTS-EMPTY", goal, goalKnown, generated: 0, kept: 0, vetoed: { slop: 0, memory: 0, distinct: 0 }, shortlist: [], observe: true };
  }

  const vetoed = { slop: 0, memory: 0, distinct: 0 };
  const alive = [];

  for (const e of entries) {
    const title = String(e.title ?? "").trim();
    const hook = openingHook(e.body);
    const concept = {
      id: String(e.id ?? ""),
      title, hook,
      theme: String(e.topic ?? "").trim(),
      angle: String(e.angle ?? "").trim(),
      cta: g.cta,
      tags: Array.isArray(e.tags) ? e.tags.slice(0, 5) : [],
      source: "corpus",
    };
    const hay = `${title}\n${hook}`;

    /* 1. cheapest death first: the R302 slop lexicon on title+hook */
    const sv = slopVerdict(title, hook, d.slopLexicon);
    if (!sv.ok) { vetoed.slop++; continue; }

    /* 2. R303 memory veto at CONCEPT stage — a title resembling the
     *    fleet's own rejected/published ledger dies before drafting */
    if (memory && ((memory.rejected ?? []).length || (memory.published ?? []).length)) {
      const mp = memoryPenalty(memory, { title, body: hook }, d.memory ?? {});
      if (!mp.ok) { vetoed.memory++; continue; }
    }

    concept.distinctText = `${hook} ${concept.theme}`;
    alive.push(concept);
  }

  /* 3. measured distinctness — Pomelli demands "genuinely distinct"; we
   *    prove it: greedy keep in corpus order, Jaccard over shingles */
  const kept = [];
  const keptSets = [];
  for (const c of alive) {
    const set = shingles(c.distinctText, 3);
    const twin = keptSets.some((s) => jaccard(set, s) >= jMax);
    if (twin) { vetoed.distinct++; continue; }
    keptSets.push(set);
    kept.push(c);
  }

  /* 4. deterministic rank: score desc → title asc → id asc */
  for (const c of kept) {
    const { score, axes } = axisScore(c, d);
    c.score = score;
    c.axes = axes;
    delete c.distinctText;
  }
  kept.sort((a, b) => (b.score - a.score) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  const verdict = kept.length ? "CONCEPTS-OK" : "CONCEPTS-VETOED-ALL";
  return {
    verdict, goal, goalKnown, frame: g.frame,
    generated: entries.length, kept: kept.length, vetoed,
    shortlist: kept.slice(0, limit),
    memoryAvailable: Boolean(memory),
    observe: true, /* R304 observe-first: proposal, never a gate */
  };
}
