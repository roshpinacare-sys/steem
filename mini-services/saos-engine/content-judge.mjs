/**
 * content-judge.mjs — R302 · THE CONTENT JUDGE (T-83, trace 1a138763fa0a8fe9)
 *
 * Owner order 2026-10-14 (Autonomous Media & Content Agents): adopt the
 * industry architectures measured in T-83 — LangGraph's stateful quality
 * flow (social-media-agent), the SoMe benchmark's internal judge, and the
 * market-ldr Git-as-Memory loop — WITHOUT importing their clouds:
 * no FireCrawl, no LangSmith, no MuAPI, no paid-ad credits. The judge is
 * local, deterministic, and fail-closed on HARD laws (slop / persona /
 * memory) while the QUALITY score runs OBSERVE-ONLY (the policy-engine
 * pattern: rateMode=observe first, enforcement needs measured evidence).
 *
 * Composition with the existing law stack — the judge is ADDITIVE, it does
 * not duplicate: title/tag/body mechanics stay in spamgate.mjs (R243),
 * chain-truth uniqueness stays in fleet-ledger.mjs (R297), cadence stays in
 * army-social/socialPolicy (R301). This module owns the axes those laws do
 * not see: AI-slop phrasing (the "это slop" class market-ldr refuses),
 * persona voice collisions, and Git-as-Memory penalties (R303).
 */
import fs from "node:fs";
import path from "node:path";
import { memoryPenalty, winBoost } from "./content-memory.mjs";
import { ticVerdict } from "./content-tics.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
export const DNA_FILE = path.join(DIR, "content-dna.json");

/* THE SLOP LEXICON — the measured fingerprint of machine-slop prose (the
 * class that got the roster shelled: 75 duplicated bodies, 47 twin titles).
 * Plain literal phrases, case-insensitive; regex-safe by construction
 * (letters/apostrophes/spaces only — escape() below guards anyway). */
export const SLOP_PHRASES = [
  "are you tired of", "in today's fast-paced world", "in the ever-evolving",
  "ever-evolving landscape", "in conclusion", "it is important to note",
  "it's important to note", "delve into", "delves into", "delving into",
  "rich tapestry", "tapestry of", "navigating the complexities",
  "navigate the complexities", "game-changer", "game changer",
  "revolutionize the", "revolutionizing the", "unlock the power of",
  "harness the power of", "unleash the power of", "embark on a journey",
  "testament to the", "in the realm of", "seamless integration",
  "elevate your", "take it to the next level", "look no further",
  "read on to discover", "stay tuned for more", "cutting-edge solutions",
  "state-of-the-art solutions", "paradigm shift", "best-in-class",
  "next-generation platform", "at the end of the day,", "the bottom line is",
  "in this digital age", "digital landscape", "the world of today",
  "one thing is for certain", "buckle up", "let's dive in",
];

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function buildLexicon(list) {
  return list.map((p) => ({ phrase: p, re: new RegExp(escapeRe(p), "i") }));
}

/* DEFAULT DNA — the committed content-dna.json is authoritative; this
 * embedded copy is the offline/fallback contract (loadDNA merges over it,
 * so a corrupted/missing file degrades to law, never to silence). */
export const DEFAULT_DNA = {
  version: 1,
  law: "R302",
  voice: {
    pillars: ["measured truth", "plain checklists", "human register", "numbers over adjectives"],
    bannedGenres: ["ai-slop", "clickbait", "empty-inspirational"],
  },
  slopLexicon: SLOP_PHRASES,
  fleetForbidden: [],
  personaForbidden: {},
  quality: {
    weights: { hook: 25, specificity: 20, structure: 20, brevity: 20, register: 15 },
    enforce: false, /* R302 observe-first: enforcement needs measured evidence */
  },
  memory: { jaccard: 0.5, windowDays: 90 },
};

/** shallow merge over DEFAULT_DNA; file wins on scalars/arrays it defines */
export function mergeDNA(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = mergeDNA(base[k], v);
    } else out[k] = v;
  }
  return out;
}
export function loadDNA(dnaPath = DNA_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(dnaPath, "utf8"));
    return mergeDNA(DEFAULT_DNA, parsed);
  } catch { return DEFAULT_DNA; }
}

export function slopVerdict(title, body, lexicon = SLOP_PHRASES) {
  const hay = `${String(title ?? "")}\n${String(body ?? "").slice(0, 4000)}`.toLowerCase();
  const hits = [];
  for (const { phrase, re } of buildLexicon(lexicon)) {
    if (re.test(hay)) hits.push(phrase);
    if (hits.length >= 6) break;
  }
  return { ok: hits.length === 0, reasons: hits.map((h) => `slop:"${h}"`), hits };
}

/** persona voice collision: fleetForbidden + per-persona forbidden fragments */
export function personaVerdict(dna, persona, { title, body } = {}) {
  const hay = `${String(title ?? "")}\n${String(body ?? "").slice(0, 4000)}`.toLowerCase();
  const reasons = [];
  for (const p of dna?.fleetForbidden ?? []) {
    if (hay.includes(String(p).toLowerCase())) reasons.push(`fleet-forbidden:"${String(p).slice(0, 40)}"`);
  }
  const pid = persona?.id ?? null;
  const list = (pid ? (dna?.personaForbidden?.[pid] ?? []) : []);
  for (const p of list) {
    if (hay.includes(String(p).toLowerCase())) reasons.push(`persona-forbidden(${pid}):"${String(p).slice(0, 40)}"`);
  }
  return { ok: reasons.length === 0, reasons };
}

/* SoMe-inspired QUALITY axes — deterministic heuristics, observe-only:
 * hook (title band + question/number presence), specificity (numbers,
 * concrete nouns over filler), structure (paragraph/sentence cadence),
 * brevity (word band vs the measured 1/day attention window), register
 * (persona slang presence = the fleet's own voice, not template voice). */
export function qualityScore({ title, body, persona, dna } = {}) {
  const w = dna?.quality?.weights ?? DEFAULT_DNA.quality.weights;
  const t = String(title ?? "").trim();
  const b = String(body ?? "").trim();
  const words = b.split(/\s+/).filter(Boolean);
  const titleWords = t.split(/\s+/).filter(Boolean).length;

  let hook = 0;
  if (titleWords >= 6 && titleWords <= 16) hook += 0.6;
  else if (titleWords >= 4) hook += 0.3;
  if (/[?]/.test(t)) hook += 0.2;
  if (/\d/.test(t)) hook += 0.2;
  hook = Math.min(1, hook);

  const numbers = (b.match(/\b\d+(\.\d+)?\b/g) ?? []).length;
  const filler = (b.toLowerCase().match(/\b(very|really|just|actually|basically|literally|amazing|awesome|incredible)\b/g) ?? []).length;
  const spec = Math.max(0, Math.min(1, numbers / 8) - Math.min(0.5, filler / 10));

  const paras = b.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let structure = 0;
  if (paras.length >= 3 && paras.length <= 12) structure += 0.5;
  const paraLens = paras.map((p) => p.split(/\s+/).filter(Boolean).length);
  if (paraLens.length && paraLens.every((l) => l >= 12 && l <= 120)) structure += 0.3;
  if (/\n[-*#]|\n\d+\./.test(b)) structure += 0.2;
  structure = Math.min(1, structure);

  let brevity = 0;
  if (words.length >= 220 && words.length <= 900) brevity += 0.7;
  else if (words.length >= 120) brevity += 0.35;
  const avgSent = words.length / Math.max(1, (b.match(/[.!?]+/g) ?? []).length);
  if (avgSent >= 8 && avgSent <= 25) brevity += 0.3;
  brevity = Math.min(1, brevity);

  let register = 0.2;
  if (persona) {
    const slang = (persona.slang ?? []).map((s) => String(s).toLowerCase());
    if (slang.some((s) => s && b.toLowerCase().includes(s))) register += 0.5;
    const traits = (persona.traits ?? []).map((s) => String(s).toLowerCase().split(" ")[0]);
    if (traits.some((s) => s && b.toLowerCase().includes(s))) register += 0.15;
    if (persona.neverDo?.length && !b.toLowerCase().includes("you should always")) register += 0.15;
  }
  register = Math.min(1, register);

  const axes = { hook, specificity: spec, structure, brevity, register };
  let score = 0;
  for (const k of Object.keys(axes)) score += axes[k] * (w[k] ?? 0);
  return { score: Math.round(score * 10) / 10, axes };
}

/** THE COMPOSED VERDICT — fail-closed on slop/persona/memory, observe-only
 *  on quality. `memory` may be null (degraded → ok:true with honest reason;
 *  spamgate + R297 still hold — the judge never OPENS a gate the laws closed). */
export function judgeVerdict(draft, { memory = null, persona = null, dna = null } = {}) {
  const d = dna ?? DEFAULT_DNA;
  const title = draft?.title ?? "";
  const body = draft?.body ?? "";
  const reasons = [];
  const axes = {};

  const slop = slopVerdict(title, body, d.slopLexicon ?? SLOP_PHRASES);
  axes.slop = { ok: slop.ok, hits: slop.hits };
  if (!slop.ok) reasons.push(...slop.reasons.slice(0, 4));

  const pv = personaVerdict(d, persona, { title, body });
  axes.persona = { ok: pv.ok, reasons: pv.reasons.slice(0, 3) };
  if (!pv.ok) reasons.push(...pv.reasons.slice(0, 3));

  if (memory && ((memory.rejected ?? []).length || (memory.published ?? []).length)) {
    const mp = memoryPenalty(memory, { title, body }, d.memory ?? {});
    axes.memory = { ok: mp.ok, against: mp.against };
    if (!mp.ok) reasons.push(...mp.reasons.slice(0, 3));
    const wb = winBoost(memory, { title, body });
    axes.memory.winBoost = wb.score;
  } else {
    axes.memory = { ok: true, degraded: true };
  }

  /* R329 · THE TIC AXIS (T-88, owner delegation "יש ריבונות אחראית"): a
   * phrase that ALREADY recurs across our published posts (memory.tics,
   * applied from the sealed R327 proposal) repeats in this draft → observe
   * by default; a hard reason ONLY when the signed DNA arms ticEnforce
   * (the R307 knob pattern — enforcement waits for measured evidence). */
  const tv = ticVerdict(draft, d);
  axes.tics = { ok: tv.ok, hits: tv.hits, mode: tv.mode };
  if (tv.mode === "enforce" && !tv.ok) reasons.push(...tv.reasons.slice(0, 2));

  const q = qualityScore({ title, body, persona, dna: d });
  axes.quality = { score: q.score, enforce: d?.quality?.enforce === true };
  if (d?.quality?.enforce === true && q.score < 40) reasons.push(`quality-below-floor(${q.score}<40)`);
  const observe = { score: q.score, axes: q.axes, mode: d?.quality?.enforce === true ? "enforce" : "observe" };

  return { ok: reasons.length === 0, reasons: reasons.slice(0, 6), axes, observe };
}
