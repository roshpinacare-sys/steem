/**
 * content-drift.mjs — R327 · THE DNA DRIFT REPORT (T-86, trace 1a1393f245a1f659)
 *
 * Queue item #2 of the Open-Pomelli deep-dive (intel/open-pomelli-deep-dive,
 * §5.2, T-84): the brand-analyzer TWO-CHANNEL pattern made sovereignty-native.
 * Channel A = DECLARED identity (the signed content-dna.json — what we SAY we
 * are). Channel B = OBSERVED voice (what we ACTUALLY published — R303 books +
 * chain truth via the heartbeat). The gap between the two is DRIFT — the same
 * class of rot that shelled the roster once (75 duplicated bodies, 47 twin
 * titles): nobody notices a voice decaying one post at a time.
 *
 *   R334 CLOSURE (T-89): R329 applied R327's signed proposal — the DNA now
 *   carries memory.tics. A monitor blind to its own applied proposal would
 *   re-mine "the difference is" and re-propose the SAME refresh every beat
 *   (the R297 shallow-memory class, reborn on the monitor itself). Closure:
 *   (a) mining excludes applied tics — an adopted tic is voice-LAW, not a
 *   discovery; (b) the proposal carries refreshOf provenance from
 *   memory.applied — the owner reads a post-apply measurement, not a stale
 *   duplicate; (c) ticsEvidence measures each tic's recurrence in the
 *   OBSERVED corpus — the accumulated evidence the owner-gated ticEnforce
 *   arming decision (R302 pattern) awaits (DNA v2 shipped hits:null).
 *
 *   observe — pure `analyzeDrift({ dna, posts })`: deterministic, no clock,
 *             no randomness, no network (the R304/R306 purity law).
 *
 *   measure — per-pillar proxies, repeated-phrase mining (candidate lexicon
 *             additions — the slop channel), register stats, forbidden-voice
 *             hits (fleetForbidden/personaForbidden in REAL published text).
 *   propose — a REFRESH PROPOSAL (addLexicon / pillarGaps) sealed into
 *             state/dna-drift-latest.json … and NOTHING else. The signed DNA
 *             file is authoritative; applying a proposal is OWNER-GATED by
 *             design (intel §5.2). This module never writes content-dna.json,
 *             never gates a publish, never opens a gate the hard laws closed.
 *
 * LAWS (measured, not aspirational):
 *  - OBSERVE-ONLY: verdicts land in the heartbeat + one state file. spamgate/
 *    R297/R301/R302 own publishing; this is an instrument, not a gate.
 *  - DEGRADED is honest: zero observed posts ⇒ DNA-DRIFT-DEGRADED samples:0 —
 *    never a fake all-clear, never a crash (the R302/R306 fail-honest law).
 *  - Zero npm deps (node builtins + global fetch only). RPC calls are
 *    READ-ONLY get_content, 3-node failover, gentle spacing — the R306
 *    posture exactly; SOCIAL-STANDBY-safe (reading our own history is
 *    observation, not action).
 *  - Deterministic ids/signatures: sha256 canonical JSON, no clock inside the
 *    pure core (the step stamps `at` once, outside the analysis).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { STEEM_NODES, RPC_TIMEOUT_MS, SPACING_MS } from "./content-engagement.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);

export const DRIFT_MAX_POSTS = 20;     // per beat, newest first
export const DRIFT_MIN_HITS = 3;       // a phrase must recur ≥3 times …
export const DRIFT_MIN_POSTS = 2;      // … across ≥2 DISTINCT posts (the R297 lesson: one post is a voice, two is a habit)
export const DRIFT_MIN_LEN = 12;       // candidate phrase length floor (chars)
export const DRIFT_PILLAR_GAP = 0.25;  // pillar score below this = gap
export const SLOP_HITS_PER_POST_CAP = 8;

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, Number(ms) || 0));

/* ── canonical JSON + signature (R306 pattern) ───────────────────────────── */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export function signDrift(doc) {
  const { signature, ...rest } = doc ?? {};
  return "sig:" + createHash("sha256").update(stableStringify(rest)).digest("hex").slice(0, 8);
}

/* ── light markdown strip (the observed text should be prose, not syntax) ── */
export function stripMarkdown(s) {
  return String(s ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── pure: per-pillar observable proxies (measured, honest-by-construction) ─
 * Each KNOWN pillar maps to a countable surface signal of the corpus.
 * An UNKNOWN pillar degrades to literal-phrase presence (never faked). */
export function pillarProxies(posts) {
  const texts = (posts ?? []).map((p) => stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`));
  const chars = texts.reduce((a, t) => a + t.length, 0);
  const per1k = (n) => (chars > 0 ? (n * 1000) / chars : 0);
  let digits = 0, measured = 0, personal = 0;
  let listPosts = 0, seenPosts = 0;
  const measuredRe = /\b(measur|percent|%|baseline|delta|counted|logged|audit|baseline|median|average)\b/gi;
  const personalRe = /\b(i|we|our|my|you|your)\b|\bn't\b|\bwo -?n't\b/gi;
  for (const t of texts) {
    if (!t) continue;
    seenPosts++;
    digits += (t.match(/\d/g) ?? []).length;
    measured += (t.match(measuredRe) ?? []).length;
    personal += (t.match(personalRe) ?? []).length;
    const listLines = (t.match(/(?:^|\s)[-•*]\s|\s\d+\.\s/g) ?? []).length;
    if (listLines >= 3) listPosts++;
  }
  return {
    digitsPer1k: r2(per1k(digits)),
    measuredPer1k: r2(per1k(measured)),
    personalPer1k: r2(per1k(personal)),
    listPostRatio: seenPosts > 0 ? r2(listPosts / seenPosts) : 0,
    chars,
  };
}
const PILLAR_SCORES = {
  "numbers over adjectives": (px) => clamp01((px.digitsPer1k ?? 0) / 5),      // 5 digits/1k chars ≈ saturated
  "measured truth": (px) => clamp01((px.measuredPer1k ?? 0) / 3),             // 3 markers/1k ≈ saturated
  "human register": (px) => clamp01((px.personalPer1k ?? 0) / 15),            // 15 personal hits/1k ≈ saturated
  "plain checklists": (px) => clamp01((px.listPostRatio ?? 0) / 0.5),         // half the posts listed ≈ saturated
};

/* ── pure: repeated-phrase mining (candidate lexicon additions) ────────────
 * The channel that matters most: the corpus developing ITS OWN slop —
 * phrases that recur like the measured fingerprint did, but that the current
 * lexicon does NOT know yet. Stopword-only n-grams never count. */
const STOP = new Set(("a,an,the,and,or,but,if,then,else,when,while,of,to,in,on,at,by,for,with,from,as,is,are,was," +
  "were,be,been,being,it,its,this,that,these,those,i,we,our,you,your,they,he,she,his,her,them,us,me,my,mine," +
  "do,does,did,done,have,has,had,having,will,would,can,could,should,shall,may,might,must,not,no,yes,so,than," +
  "too,very,just,also,there,here,what,which,who,whom,whose,why,how,all,any,both,each,few,more,most,other,some," +
  "such,only,own,same,s1,s2,one,two").split(","));
export function mineDriftPhrases(posts, knownLexicon = [], { minHits = DRIFT_MIN_HITS, minPosts = DRIFT_MIN_POSTS, minLen = DRIFT_MIN_LEN } = {}) {
  const known = new Set((knownLexicon ?? []).map((p) => String(p).toLowerCase()));
  const freq = new Map(); // phrase -> { hits, posts:Set }
  let pi = 0;
  for (const p of posts ?? []) {
    const pidKey = p?.id ?? p?.permlink ?? `idx:${pi++}`;
    const text = stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`).toLowerCase();
    const words = text.split(/[^a-z0-9']+/).filter(Boolean);
    const seenInPost = new Set();
    for (let n = 5; n >= 3; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (gram.every((w) => STOP.has(w))) continue;          // pure glue never counts
        const phrase = gram.join(" ");
        if (phrase.length < minLen || known.has(phrase)) continue;
        seenInPost.add(phrase);
        const rec = freq.get(phrase) ?? { hits: 0, posts: new Set() };
        rec.hits++;
        rec.posts.add(pidKey);
        freq.set(phrase, rec);
      }
    }
  }
  const out = [];
  for (const [phrase, rec] of freq) {
    if (rec.hits >= minHits && rec.posts.size >= minPosts) out.push({ phrase, hits: rec.hits, posts: rec.posts.size });
  }
  out.sort((a, b) => (b.hits - a.hits) || (b.posts - a.posts) || a.phrase.localeCompare(b.phrase));
  return out.slice(0, 8);
}

/* ── pure: the APPLIED tic phrases (R334) ───────────────────────────
 * Robust to both shapes the applier may store: {phrase, hits, posts}
 * objects (what R329 wrote) or plain strings. Lowercased for mining.
 * An applied tic is the DNA's OWN voice law — never a drift discovery. */
export function appliedTicPhrases(dna) {
  const tics = dna?.memory?.tics;
  if (!Array.isArray(tics)) return [];
  return tics
    .map((t) => (typeof t === "string" ? t : t?.phrase))
    .filter((p) => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.toLowerCase());
}

/* ── pure: per-tic recurrence in the OBSERVED corpus (R334 ticsEvidence) ──
 * The evidence slots DNA v2 shipped as hits:null/posts:null, measured.
 * This is what accumulates in the heartbeat so the owner-gated ticEnforce
 * arming decision (R302 observe→enforce pattern) rides MEASURED evidence.
 * Honest zeros count: a tic absent from the observed corpus is evidence too. */
export function ticsEvidence(posts, dna) {
  const tics = appliedTicPhrases(dna);
  if (!tics.length) return [];
  const docs = (posts ?? [])
    .map((p, i) => ({ idx: i, id: p?.id ?? p?.permlink ?? null, text: stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`).toLowerCase() }))
    .filter((d) => d.text.length >= 40);
  return tics.map((tic) => {
    let hits = 0;
    const seen = new Set();
    for (const d of docs) {
      let n = 0;
      let idx = d.text.indexOf(tic);
      while (idx !== -1) { n++; idx = d.text.indexOf(tic, idx + tic.length); }
      if (n > 0) { hits += n; seen.add(d.id ?? `idx:${d.idx}`); }
    }
    return { phrase: tic, hits, posts: seen.size };
  });
}

/* ── pure: forbidden-voice hits in the OBSERVED corpus ───────────────────── */
export function forbiddenHits(posts, dna) {
  const hits = [];
  const scan = (list, tag) => {
    for (const p of posts ?? []) {
      const hay = stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`).toLowerCase();
      for (const frag of list ?? []) {
        const f = String(frag).toLowerCase();
        if (f && hay.includes(f)) hits.push({ tag, fragment: String(frag).slice(0, 40), post: p?.permlink ?? p?.id ?? null });
      }
    }
  };
  scan(dna?.fleetForbidden ?? [], "fleet");
  for (const [pid, list] of Object.entries(dna?.personaForbidden ?? {})) scan(list, `persona:${pid}`);
  return hits.slice(0, SLOP_HITS_PER_POST_CAP);
}

/* ── the pure core ────────────────────────────────────────────────────────── */
export function analyzeDrift({ dna, posts }) {
  const real = (posts ?? []).filter((p) => stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`).length >= 40);
  if (!real.length) {
    return { verdict: "DNA-DRIFT-DEGRADED", observe: true, samples: 0, degraded: true,
      pillars: [], driftPhrases: [], forbiddenHits: [], register: null, proposal: null,
      ticsEvidence: [], ticsObserved: null,
      reason: "no observed posts (books empty + chain read yielded nothing)" };
  }
  const px = pillarProxies(real);
  const pillars = [];
  for (const pillar of dna?.voice?.pillars ?? []) {
    const fn = PILLAR_SCORES[String(pillar).toLowerCase()];
    const score = fn ? fn(px) : clamp01(real.filter((p) => stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`).toLowerCase().includes(String(pillar).toLowerCase())).length / real.length);
    pillars.push({ pillar, score, exhibited: score >= DRIFT_PILLAR_GAP });
  }
  const tics = appliedTicPhrases(dna);            // R334: applied tics are law, not discovery
  const lexicon = [...(dna?.slopLexicon ?? []), ...tics];
  const inTicFamily = (phrase) => tics.some((t) => t === phrase || t.includes(phrase) || phrase.includes(t));  // overlapping variants are the same voice-law (R329 shape)
  const driftPhrases = mineDriftPhrases(real, lexicon).filter((d) => !inTicFamily(d.phrase));
  const ticEv = ticsEvidence(real, dna);          // R334: measured evidence for the arming decision
  const forbidden = forbiddenHits(real, dna);
  const sentences = real.map((p) => stripMarkdown(`${p?.title ?? ""} ${p?.body ?? ""}`).split(/[.!?]+/).filter((s) => s.trim().split(/\s+/).length >= 3)).flat();
  const lens = sentences.map((s) => s.trim().split(/\s+/).length);
  const meanSentenceLen = lens.length ? r1(lens.reduce((a, b) => a + b, 0) / lens.length) : null;
  const longRatio = lens.length ? r2(lens.filter((l) => l > 25).length / lens.length) : null;
  const register = { meanSentenceLen, longRatio, listPostRatio: px.listPostRatio, digitsPer1k: px.digitsPer1k, measuredPer1k: px.measuredPer1k, personalPer1k: px.personalPer1k };
  const pillarGaps = pillars.filter((p) => !p.exhibited).map((p) => p.pillar);
  const verdict = (forbidden.length > 0 || pillarGaps.length >= 2 || driftPhrases.length >= 3) ? "DNA-DRIFT-DETECTED" : "DNA-DRIFT-OK";
  const applied = Array.isArray(dna?.memory?.applied) && dna.memory.applied.length > 0
    ? dna.memory.applied[dna.memory.applied.length - 1] : null;
  const proposal = {
    addLexicon: driftPhrases.map((d) => d.phrase).filter((p) => !inTicFamily(p)),  // R334 belt+braces: never re-propose a tic or its overlapping variants
    pillarGaps,
    forbidden: forbidden.map((f) => `${f.tag}:"${f.fragment}"`),
    refreshOf: applied ? { fromSig: applied.fromSig ?? null, at: applied.at ?? null, trace: applied.trace ?? null } : null,  // R334: measured AFTER the last applied refresh
    rationale: forbidden.length > 0 ? "observed text hit forbidden voice — refresh persona/fleet bans"
      : driftPhrases.length >= 3 ? "recurring phrases not in the lexicon — the corpus is growing its own slop"
      : pillarGaps.length >= 2 ? "declared pillars not exhibited in the observed corpus"
      : "no structural drift measured",
    ownerGated: true, /* the signed file is authoritative — application is owner-gated (intel §5.2) */
  };
  return { verdict, observe: true, samples: real.length, degraded: false, pillars, driftPhrases, forbiddenHits: forbidden, register, proposal, ticsEvidence: ticEv, ticsObserved: ticEv.filter((e) => e.posts > 0).length, reason: null };
}

/* ── seal: one state file, rides the state-churn commits (R303 law) ──────── */
export function sealDrift(doc, stateDir, { now } = {}) {
  const file = path.join(stateDir, "dna-drift-latest.json");
  fs.mkdirSync(stateDir, { recursive: true });
  const sealed = { ...doc, at: now ?? new Date().toISOString(), signature: signDrift(doc) };
  fs.writeFileSync(file, JSON.stringify(sealed, null, 2));
  return file;
}

/* ── read-only chain fetch of OUR post bodies (R306 posture, nothing more) ── */
async function rpc(fetchImpl, method, params, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  let lastErr = null;
  for (const node of STEEM_NODES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ctrl.signal });
      const j = await res.json();
      if (j?.result) return j.result;
      lastErr = new Error(String(j?.error?.message ?? "no result"));
    } catch (e) { lastErr = e; } finally { clearTimeout(t); }
    await sleep(SPACING_MS);
  }
  throw lastErr ?? new Error("all nodes failed");
}

/** fetch text (title+body) for [{author,permlink}] — READ-ONLY, cap DRIFT_MAX_POSTS */
export async function fetchPostTexts(pairs, { fetchImpl = fetch, cap = DRIFT_MAX_POSTS } = {}) {
  const out = [];
  for (const { author, permlink } of (pairs ?? []).slice(0, cap)) {
    if (!author || !permlink) continue;
    try {
      const c = await rpc(fetchImpl, "condenser_api.get_content", [author, permlink]);
      if (c?.title || c?.body) out.push({ id: `${author}/${permlink}`, author, permlink, title: c.title ?? "", body: String(c.body ?? "").slice(0, 4000) });
    } catch { /* one post failing is honest-degraded, never a wedge */ }
    await sleep(SPACING_MS);
  }
  return out;
}

/** load the R303 published books (seed + runtime merged) with text */
export async function loadBookPosts(stateDir) {
  const { loadMemory } = await import("./content-memory.mjs");
  return (loadMemory(stateDir).published ?? [])
    .map((m) => ({ id: m.id ?? m.permlink ?? null, permlink: m.permlink ?? null, title: m.title ?? "", body: String(m.body ?? "").slice(0, 4000) }))
    .filter((p) => p.title || p.body);
}

/** the heartbeat step body: books first, chain text second, honest degrade always */
export async function runDrift({ stateDir, now, fetchImpl = fetch } = {}) {
  let posts = [];
  let source = null;
  try { posts = await loadBookPosts(stateDir); if (posts.length) source = "books"; } catch { /* honest */ }
  if (!posts.length) {
    try {
      const engFile = path.join(stateDir, "content-engagement.json");
      const eng = JSON.parse(fs.readFileSync(engFile, "utf8"));
      const pairs = (eng?.posts ?? []).map((p) => ({ author: p.author, permlink: p.permlink })).filter((p) => p.author && p.permlink);
      if (pairs.length) { posts = await fetchPostTexts(pairs, { fetchImpl }); if (posts.length) source = "chain"; }
    } catch { /* no engagement state / chain down → degraded, honest */ }
  }
  const { loadDNA } = await import("./content-judge.mjs");
  const analysis = analyzeDrift({ dna: loadDNA(), posts });
  const file = sealDrift(analysis, stateDir, { now });
  return { ...analysis, source, file };
}
