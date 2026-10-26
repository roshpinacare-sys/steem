/**
 * content-sourcing.mjs — R305 · THE SOURCING LOOP (exec30, T-85)
 *
 * Pattern measured: langchain-ai/social-media-agent (verified real, 2841★ on
 * 2026-10-14) — its curation loop is LISTEN (scan external feeds) → SCORE →
 * SELECT a small candidate queue → CURATE (feed the content pipeline). The
 * fleet had R302 (judge) / R303 (memory) / R304 (concepts) — all of them
 * rank the fleet's OWN corpus. The missing organ is the EAR: a read-only
 * scan of the live Steem network that hands R304's pipeline a measured
 * candidate queue from OUTSIDE the fleet, so drafts are anchored in what
 * the network is actually talking about (DECISIONS #19/#20 context).
 *
 * Sovereignty laws honored here:
 *  - READ-ONLY on chain: three condenser_api discussion scans
 *    (hot / trending / created), 15s timeout each, limit 20, a gentle
 *    6-8 tag set (community state seed when present, fixed fallback when
 *    not). Zero keys, zero new deps (node >= 20 global fetch).
 *  - OBSERVE-ONLY: never a gate, never blocks anything (R304 pattern) —
 *    output is a candidate QUEUE for the pre-draft side; spamgate/R297/
 *    R301/R302 own every publish gate.
 *  - SOCIAL-STANDBY compatible: zero broadcasts, zero custody, zero key
 *    material anywhere in the output — verdicts and public chain data only.
 *  - Exit-0-by-design honesty: an upstream outage is a SOURCING-DEGRADED
 *    receipt with honest empty candidates, never a crash of the pulse.
 *  - Fleet hygiene: fleet authors (ARMY_ROSTER + headcorner) and posts
 *    naming the roster are excluded — the fleet curates the world, never
 *    itself (anti-echo, anti-self-vote optics).
 *
 * Determinism: scoreCandidate/seedTags/dnaAxes are pure (clock enters only
 * as the caller's scan timestamp), so the selftest needs zero network.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ARMY_ROSTER } from "./army-social.mjs";
import { loadDNA } from "./content-judge.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/* R275 merge law: the state dir is resolved PER CALL — SAOS_STATE_DIR can be
 * set after module load (the selftest sets it to an isolated tmp dir). */
const stateDirOf = (explicit) => explicit || process.env.SAOS_STATE_DIR || path.join(DIR, "state");

export const DEFAULT_SEED_TAGS = ["life", "israel", "technology", "cryptocurrency", "writing", "photography"];
export const SOURCING_TOP_N = 12;      /* the candidate queue cap */
const BODY_PREVIEW_CHARS = 500;        /* roster-name check runs on a preview, never the whole body */
const FETCH_TIMEOUT_MS = 15000;        /* 15s per scan, per task law */
const SCAN_SOURCES = ["hot", "trending", "created"];
const STOPWORDS = new Set(["over", "of", "the", "a", "an", "and", "in", "on", "for", "to", "is", "are"]);

const RPC = "https://api.steemit.com";
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/* ── seed tags ──────────────────────────────────────────────────────────
 * Gentle by law: 6-8 tags max. community.json / community-round.json are
 * the fleet's OWN community state (R246); whatever tag-ish identity they
 * carry (the community tag, or an explicit tags[] in a future format)
 * leads the set, the fixed seed set fills the rest. Missing/corrupt
 * state → the fixed fallback, honestly (never an empty scan). */
export function seedTags({ community = null, round = null, defaults = DEFAULT_SEED_TAGS, max = 8 } = {}) {
  const out = [];
  const push = (t) => {
    const tag = String(t ?? "").trim().toLowerCase();
    if (tag && !out.includes(tag) && out.length < max) out.push(tag);
  };
  if (Array.isArray(community?.tags)) for (const t of community.tags) push(t);
  if (Array.isArray(round?.tags)) for (const t of round.tags) push(t);
  const home = String(community?.name ?? round?.community ?? "").trim().toLowerCase();
  if (home) push(home);
  for (const t of defaults) push(t);
  return out;
}

function seedTagsFromState(stateDir) {
  return seedTags({
    community: readJson(path.join(stateDir, "community.json"), null),
    round: readJson(path.join(stateDir, "community-round.json"), null),
  });
}

/* ── DNA keyword axes ───────────────────────────────────────────────────
 * R302's signed DNA carries the fleet's voice pillars ("measured truth",
 * "plain checklists", ...). Each significant pillar word becomes one
 * relevance axis; a candidate matching more axes is more on-voice. */
export function dnaAxes(dna = null) {
  const pillars = dna?.voice?.pillars ?? [];
  const axes = [];
  for (const p of pillars) {
    const keywords = String(p).toLowerCase().split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
    if (keywords.length) axes.push({ name: String(p), keywords });
  }
  return axes;
}

/* count of axes with ≥1 keyword hit in the text (deterministic includes) */
export function axisRelevance(text, axes) {
  const hay = String(text ?? "").toLowerCase();
  const hit = [];
  for (const axis of axes) {
    if ((axis.keywords ?? []).some((k) => hay.includes(k))) hit.push(axis.name);
  }
  return { axesHit: hit.length, hit };
}

/* ── THE SCORE (pure; `now` = the scan timestamp, the only clock) ───────
 * velocity = (votes + children) / max(ageHours, 1), soft-capped 0..1 via
 * v/(v+10) so one whale post cannot infinite-dominate the queue;
 * freshness = 1/(1 + ageHours/24) — smooth 1→0 decay;
 * relevance = min(1, axesHit/3) against the DNA axes;
 * score = 2*velocity + freshness + 2*relevance, rounded to 2 decimals. */
export function scoreCandidate(candidate, axes = [], now = new Date().toISOString()) {
  const created = Date.parse(candidate?.created ?? "");
  const ageMs = Number.isFinite(created) ? Math.max(0, Date.parse(now) - created) : 0;
  const ageHours = ageMs / 3600000;
  const engRaw = ((candidate?.votes ?? 0) + (candidate?.children ?? 0)) / Math.max(ageHours, 1);
  const velocity = engRaw / (engRaw + 10);
  const freshness = 1 / (1 + ageHours / 24);
  const { axesHit } = axisRelevance(`${candidate?.title ?? ""} ${candidate?.preview ?? ""}`, axes);
  const relevance = Math.min(1, axesHit / 3);
  const score = Math.round((2 * velocity + freshness + 2 * relevance) * 100) / 100;
  return { score, axesHit, velocity: Math.round(velocity * 1000) / 1000, freshness: Math.round(freshness * 1000) / 1000, ageHours: Math.round(ageHours * 100) / 100 };
}

/* ── fleet exclusions (the banned-list idea, simply) ────────────────────
 * 1. fleet authors: author ∈ ARMY_ROSTER + headcorner → hard exclude.
 * 2. roster names in title/body-preview: word-boundary match — plain
 *    substring would nuke benign words ("stove" contains "tov"), which
 *    a curation ear must not do. Deterministic, case-insensitive. */
export function fleetSet() { return [...ARMY_ROSTER, "headcorner"]; }

export function exclusionVerdict({ author = "", title = "", preview = "" }, fleet = null) {
  const f = fleet ?? fleetSet();
  if (f.includes(String(author).toLowerCase())) return "FLEET-AUTHOR";
  const hay = `${title} ${preview}`.toLowerCase();
  for (const name of f) {
    if (new RegExp(`\\b${name}\\b`).test(hay)) return "ROSTER-MENTION";
  }
  return null;
}

/* ── chain scan (read-only) ───────────────────────────────────────────── */
async function scanSource(source, tag, limit, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: `condenser_api.get_discussions_by_${source}`, params: { tag, limit }, id: 1 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, items: [], reason: `HTTP ${res.status}` };
    const json = await res.json();
    const items = Array.isArray(json?.result) ? json.result : [];
    return { ok: true, items, reason: items.length ? null : "empty" };
  } catch (e) {
    return { ok: false, items: [], reason: String(e?.message ?? e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function gitHead() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR, encoding: "utf8" }).trim(); }
  catch { return null; }
}

/* ── THE RUNNER — one honest scan, one state file, one receipt ────────── */
export async function runSourcing({ now = new Date().toISOString(), fetchImpl = globalThis.fetch, stateDir = null, tags = null, dna = null, axes = null, fleet = null, topN = SOURCING_TOP_N, limit = 20 } = {}) {
  const sd = stateDirOf(stateDir);
  const dnaReal = dna ?? loadDNA();
  const ax = axes ?? dnaAxes(dnaReal);
  const fl = fleet ?? fleetSet();
  const tagSet = tags ?? seedTagsFromState(sd);

  const sources = [];
  const byKey = new Map();
  let allFailed = true;

  for (const tag of tagSet) {
    for (const source of SCAN_SOURCES) {
      const r = await scanSource(source, tag, limit, fetchImpl);
      sources.push({ source, tag, fetched: r.items.length, ok: r.ok });
      if (r.ok) {
        allFailed = false;
        for (const d of r.items) {
          const author = String(d?.author ?? "").toLowerCase();
          const permlink = String(d?.permlink ?? "");
          const key = `${author}/${permlink}`;
          if (!author || !permlink || byKey.has(key)) continue;
          const title = String(d?.title ?? "").trim();
          const preview = String(d?.body ?? "").slice(0, BODY_PREVIEW_CHARS);
          const ex = exclusionVerdict({ author, title, preview }, fl);
          if (ex) { byKey.set(key, { excluded: ex }); continue; }
          byKey.set(key, {
            author, permlink, title,
            tag: String(d?.category ?? tag),
            votes: Number(d?.net_votes ?? 0),
            children: Number(d?.children ?? 0),
            created: String(d?.created ?? ""),
            preview,
          });
        }
      }
    }
  }

  const excluded = { fleetAuthors: 0, rosterMentions: 0 };
  const scored = [];
  for (const c of byKey.values()) {
    if (c.excluded === "FLEET-AUTHOR") { excluded.fleetAuthors++; continue; }
    if (c.excluded === "ROSTER-MENTION") { excluded.rosterMentions++; continue; }
    const s = scoreCandidate(c, ax, now);
    scored.push({ author: c.author, permlink: c.permlink, title: c.title, tag: c.tag, votes: c.votes, children: c.children, ageHours: s.ageHours, score: s.score, axesHit: s.axesHit });
  }
  /* deterministic rank: score desc → engagement desc → permlink asc → author asc */
  scored.sort((a, b) => (b.score - a.score) || ((b.votes + b.children) - (a.votes + a.children)) || a.permlink.localeCompare(b.permlink) || a.author.localeCompare(b.author));
  const candidates = scored.slice(0, topN);

  const scanned = sources.reduce((a, s) => a + (s.ok ? s.fetched : 0), 0);
  const verdict = allFailed ? "SOURCING-DEGRADED" : candidates.length ? "SOURCING-OK" : "SOURCING-EMPTY";
  const head = gitHead();

  /* signature over the canonical core — verdicts only, never key material
   * (there is no key material in this module to begin with). */
  const canonical = JSON.stringify({ at: now, head, scanned, kept: candidates.length, excluded: excluded.fleetAuthors + excluded.rosterMentions, ids: candidates.map((c) => `${c.author}/${c.permlink}/${c.score}`) });
  const signature = "sig:" + createHash("sha256").update(canonical).digest("hex").slice(0, 8);

  const doc = {
    at: now, head, verdict,
    sources,
    scanned,
    kept: candidates.length,
    candidates,
    excluded,
    degraded: allFailed ? sources.map((s) => `${s.source}/${s.tag}`) : [],
    signature,
    observe: true, /* R305 observe-first: a queue for R304's pipeline, never a gate */
  };

  try {
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, "content-candidates.json"), JSON.stringify(doc, null, 2));
  } catch { /* state write never blocks the heartbeat */ }
  return doc;
}
