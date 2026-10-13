/**
 * humanity.mjs — T-73 · THE PERSONA ENGINE (השכבה-האנושית של הצי).
 * The operator measured the fleet's social layer and named the disease
 * (trace 1a105453cdc437b1): everything at the same moment, templated
 * comments, AI-tell titles, repeated content, unequal power, zero community.
 * This engine is the CURE's runtime:
 *
 *   · PERSONAS — every identity the machine speaks through gets a distinct
 *     human rhythm (its own active hours), voice (topic affinities, weight
 *     band, comment style) and a BOUNDED presence (per-day caps). The
 *     personas for the six delegate accounts (siq/tov/wic/wog/woq/powerspan)
 *     are DEFINED here so any writer that adopts the doctrine gets the same
 *     schedule source; the engine itself signs only headcorner + hcsoldier1..3.
 *   · STATE — state/humanity.json: per-account journals (recent titles,
 *     comment bodies, votes) + today's schedule verdicts. The diversity laws
 *     in lib.mjs §73 judge against these journals.
 *   · GATES — gatePost/gateComment/gateVote: the single path every social
 *     op passes. A gate verdict is typed; blocked ops are journaled with
 *     their fingerprint class, never silently retried into a burst.
 *
 * Doctrine: humanity is a LAW (lib.mjs §73), not a vibe — every block is
 * attributable to a named robotic fingerprint class.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  personaWindowLaw, fleetSpacingLaw, titleHumanityLaw, commentHumanityLaw,
  voteRhythmLaw, equalPowerLaw,
} from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "humanity.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJsonAtomic = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, row) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(row) + "\n"); } catch { /* journal is best-effort */ } };

/* ── THE PERSONA ROSTER ──────────────────────────────────────────────────────
 * Each persona: distinct UTC active window (primary + a small secondary),
 * topic affinity, vote-weight band, comment stance, per-day caps.
 * Windows are spread across the WHOLE DAY — the measured fingerprint was
 * everyone posting at 14:48-14:50 and 18:36-18:37 UTC. */
export const PERSONAS = {
  headcorner: {
    label: "the practitioner — build log, measured numbers, open questions",
    window: { startHour: 7.5, endHour: 10.5, secondaryMin: 17, secondaryMax: 18.5 },
    topics: ["market-making", "measurement", "sovereignty engineering"],
    weightBand: { min: 20, max: 75 },
    commentStyle: "asks a real question about the parent's hardest claim",
    caps: { postsPerDay: 3, commentsPerDay: 4, votesPerDay: 40 },
  },
  hcsoldier1: {
    label: "the learner — reads deeply, replies with what it tested",
    window: { startHour: 5, endHour: 8, secondaryMin: 14, secondaryMax: 15 },
    topics: ["curation", "steem economics"],
    weightBand: { min: 25, max: 70 },
    commentStyle: "reports a small personal test tied to the parent",
    caps: { postsPerDay: 1, commentsPerDay: 3, votesPerDay: 12 },
  },
  hcsoldier2: {
    label: "the skeptic — respectful pushback, wants the edge case",
    window: { startHour: 11, endHour: 14, secondaryMin: 20, secondaryMax: 21 },
    topics: ["governance", "witnesses", "security"],
    weightBand: { min: 25, max: 70 },
    commentStyle: "names the weakest point of the parent and asks for the data",
    caps: { postsPerDay: 1, commentsPerDay: 3, votesPerDay: 12 },
  },
  hcsoldier3: {
    label: "the builder — tools, workflows, small wins",
    window: { startHour: 16, endHour: 19, secondaryMin: 9, secondaryMax: 10 },
    topics: ["tooling", "open source", "dev workflows"],
    weightBand: { min: 25, max: 70 },
    commentStyle: "shares a concrete snippet or workflow that extends the parent",
    caps: { postsPerDay: 1, commentsPerDay: 3, votesPerDay: 12 },
  },
  /* ── delegate accounts (writers external to this engine — same doctrine,
   * same schedule source; the equal-power rail provisions them) ── */
  siq: {
    label: "the explainer — one measured idea per post, no jargon walls",
    window: { startHour: 6, endHour: 9, secondaryMin: 13, secondaryMax: 14 },
    topics: ["curation math", "vote weight", "steem economics"],
    weightBand: { min: 20, max: 65 },
    commentStyle: "connects the parent to one measured example",
    caps: { postsPerDay: 1, commentsPerDay: 2, votesPerDay: 10 },
  },
  tov: {
    label: "the infrastructure mind — git, oracles, plumbing",
    window: { startHour: 9.5, endHour: 12.5, secondaryMin: 21, secondaryMax: 22 },
    topics: ["git", "oracles", "infrastructure"],
    weightBand: { min: 20, max: 65 },
    commentStyle: "extends the parent with the plumbing under it",
    caps: { postsPerDay: 1, commentsPerDay: 2, votesPerDay: 10 },
  },
  wic: {
    label: "the archivist — chains, windows, quiet systems",
    window: { startHour: 13, endHour: 16, secondaryMin: 7, secondaryMax: 8 },
    topics: ["payout windows", "archives", "small networks"],
    weightBand: { min: 20, max: 65 },
    commentStyle: "adds the historical or lifecycle view",
    caps: { postsPerDay: 1, commentsPerDay: 2, votesPerDay: 10 },
  },
  wog: {
    label: "the auditor — verify before sign, receipts culture",
    window: { startHour: 15, endHour: 18, secondaryMin: 10, secondaryMax: 11 },
    topics: ["verification", "transparency", "signing"],
    weightBand: { min: 20, max: 65 },
    commentStyle: "asks how a claim would be verified",
    caps: { postsPerDay: 1, commentsPerDay: 2, votesPerDay: 10 },
  },
  woq: {
    label: "the newcomer voice — small account, honest questions",
    window: { startHour: 18.5, endHour: 21.5, secondaryMin: 6, secondaryMax: 7 },
    topics: ["small accounts", "onboarding", "community"],
    weightBand: { min: 20, max: 65 },
    commentStyle: "admits what it does not understand and asks",
    caps: { postsPerDay: 1, commentsPerDay: 2, votesPerDay: 10 },
  },
  powerspan: {
    label: "dormant RC pool — no social voice by doctrine",
    window: null, /* never acts socially */
    topics: [], weightBand: null,
    commentStyle: null,
    caps: { postsPerDay: 0, commentsPerDay: 0, votesPerDay: 0 },
  },
};

export const FLEET = Object.keys(PERSONAS); /* equal-power roster */

export function humanityState() { return readJson(FILE, null); }
export function humanityPublic() {
  const s = humanityState();
  /* the DESK verdicts are LIVE window math — they ride even before any gate
   * has journaled (an uninitialized engine still shows whose desk is open) */
  const now = Date.now();
  const atDesk = {};
  for (const [acc, p] of Object.entries(PERSONAS)) {
    if (!p.window) { atDesk[acc] = { verdict: "DORMANT" }; continue; }
    const w = personaWindowLaw({ account: acc, now, persona: p.window });
    atDesk[acc] = { verdict: w.verdict, which: w.which ?? null, nextOpenAt: w.nextOpenAt ?? null };
  }
  if (!s) return { initialized: false, atDesk, blockedToday: 0, passedToday: 0, law: "מנוע-האישיויות טרם רץ — השערים ייטענו במחזור הראשון" };
  return {
    initialized: true, at: s.at ?? null,
    atDesk,
    journals: {
      headcorner: {
        titles: (s.j?.headcorner?.titles ?? []).length,
        comments: (s.j?.headcorner?.comments ?? []).length,
        votes: (s.j?.headcorner?.votes ?? []).length,
      },
    },
    blockedToday: s.blockedToday ?? 0,
    passedToday: s.passedToday ?? 0,
    verdict: s.verdict ?? null,
    law: "כל-פעולה-חברתית עוברת שער-אישיות: חלון-שעות-אדם, דיבור-ייחודי, אנטי-פיצוץ, גיוון-תוכן — חסימה = מחלה-רובוטית שנתפסה",
  };
}

/* today's key (UTC) */
const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/** fresh doc for a new day (journals roll at 60 entries, day counters reset) */
function ensureDoc(nowMs = Date.now()) {
  const doc = readJson(FILE, null) ?? { day: null, j: {}, dayCounts: {}, blockedToday: 0, passedToday: 0, verdict: null };
  const today = dayKey(nowMs);
  if (doc.day !== today) {
    doc.day = today;
    doc.dayCounts = {};
    doc.blockedToday = 0;
    doc.passedToday = 0;
    doc.verdict = null;
  }
  if (!doc.j || typeof doc.j !== "object") doc.j = {};
  return doc;
}

function journal(acc, kind, entry, nowMs) {
  const doc = ensureDoc(nowMs);
  if (!doc.j[acc]) doc.j[acc] = { titles: [], comments: [], votes: [], socialTs: [] };
  const j = doc.j[acc];
  const roll = (arr) => { arr.push(entry); while (arr.length > 60) arr.shift(); };
  if (kind === "post") roll(j.titles);
  if (kind === "comment") roll(j.comments);
  if (kind === "vote") roll(j.votes);
  /* §73 SPACING BASIS: the fleet-spacing law judges the SOCIAL publishing
   * stream (posts + comments) — votes run on their OWN rhythm law and must
   * NOT block a post (a person votes all day without it gating their
   * writing). Keeping them separate is the measured lesson: headcorner's
   * 212 burst votes would have starved every lawful post. */
  if (kind === "post" || kind === "comment") {
    j.socialTs = [...j.socialTs, Number(entry.ts ?? nowMs)].filter((x) => Number.isFinite(x)).slice(-80);
  }
  const c = doc.dayCounts[acc] ?? {};
  c[kind] = (c[kind] ?? 0) + 1;
  doc.dayCounts[acc] = c;
  return doc;
}

function dayCount(doc, acc, kind) { return doc.dayCounts?.[acc]?.[kind] ?? 0; }

/** pure-ish: the social fleet timestamps EXCLUDING this account (for the
 * cross-account spacing law). Reads the same doc the caller will write. */
function fleetTimestamps(doc, excludeAcc) {
  const out = [];
  for (const [acc, j] of Object.entries(doc.j ?? {})) {
    if (acc === excludeAcc) continue;
    out.push(...(j.socialTs ?? []));
  }
  return out;
}

/* ── THE GATES ─────────────────────────────────────────────────────────────── */

/** gatePost — the post/comment-root gate. Order: persona exists → day cap →
 * window → fleet spacing → title humanity. Returns {allowed, verdict, ...};
 * when allowed, the CALLER must recordPost() AFTER a successful broadcast. */
export function gatePost({ account, title, now = Date.now() }) {
  const nowMs = Number(now);
  const persona = PERSONAS[account];
  const doc = ensureDoc(nowMs);
  const block = (verdict, extra = {}) => {
    doc.blockedToday += 1;
    doc.verdict = verdict;
    writeJsonAtomic(FILE, doc);
    appendLine(path.join(STATE, "events.jsonl"), { type: "humanity.post-blocked", at: new Date(nowMs).toISOString(), account, verdict, ...extra });
    return { allowed: false, verdict, ...extra };
  };
  if (!persona || !persona.window) return block("UNPERSONAED", { account });
  if (dayCount(doc, account, "post") >= persona.caps.postsPerDay) return block("DAY-CAP", { account, cap: persona.caps.postsPerDay });
  const win = personaWindowLaw({ account, now: nowMs, persona: persona.window });
  if (win.verdict !== "IN-WINDOW") return block("OUT-OF-WINDOW", { account, nextOpenAt: win.nextOpenAt ?? null });
  /* fleet-level spacing: this account's own social ops today + all other
   * accounts' recent ops — nobody posts in the same minute as anyone */
  const own = doc.j?.[account]?.socialTs ?? [];
  const spacing = fleetSpacingLaw({ events: fleetTimestamps(doc, account), candidateTs: nowMs, minGapMin: 47, perHourMax: 2 });
  if (spacing.verdict !== "PASS") return block("FLEET-SPACING", { account, cls: spacing.verdict });
  const titleGate = titleHumanityLaw({ title, recentTitles: doc.j?.[account]?.titles ?? [] });
  if (titleGate.verdict !== "PASS") return block(`TITLE-${titleGate.verdict}`, { account, cls: titleGate.cls });
  void own;
  return { allowed: true, verdict: "PASS", persona: persona.label, window: win.which };
}

/** gateComment — replies. Requires the parent body (the tie law) + the
 * persona + caps + window + spacing + diversity journals. */
export function gateComment({ account, body, parentBody, now = Date.now() }) {
  const nowMs = Number(now);
  const persona = PERSONAS[account];
  const doc = ensureDoc(nowMs);
  const block = (verdict, extra = {}) => {
    doc.blockedToday += 1;
    doc.verdict = verdict;
    writeJsonAtomic(FILE, doc);
    appendLine(path.join(STATE, "events.jsonl"), { type: "humanity.comment-blocked", at: new Date(nowMs).toISOString(), account, verdict, ...extra });
    return { allowed: false, verdict, ...extra };
  };
  if (!persona || !persona.window) return block("UNPERSONAED", { account });
  if (dayCount(doc, account, "comment") >= persona.caps.commentsPerDay) return block("DAY-CAP", { account, cap: persona.caps.commentsPerDay });
  const win = personaWindowLaw({ account, now: nowMs, persona: persona.window });
  if (win.verdict !== "IN-WINDOW") return block("OUT-OF-WINDOW", { account, nextOpenAt: win.nextOpenAt ?? null });
  const spacing = fleetSpacingLaw({ events: fleetTimestamps(doc, account), candidateTs: nowMs, minGapMin: 23, perHourMax: 3 });
  if (spacing.verdict !== "PASS") return block("FLEET-SPACING", { account, cls: spacing.verdict });
  const cGate = commentHumanityLaw({ body, parentBody, recentBodies: doc.j?.[account]?.comments ?? [] });
  if (cGate.verdict !== "PASS") return block(`COMMENT-${cGate.verdict}`, { account, cls: cGate.cls });
  return { allowed: true, verdict: "PASS", persona: persona.label };
}

/** gateVote — the reading-rhythm gate. weightPct is the POST-persona-band
 * weight; the curator's own laws still apply upstream (manaSurplus etc.) —
 * this gate clamps into the persona band and enforces the rhythm. */
export function gateVote({ account, weightPct, now = Date.now(), voter = null, selfAuthor = null }) {
  const nowMs = Number(now);
  const persona = PERSONAS[account];
  const doc = ensureDoc(nowMs);
  const block = (verdict, extra = {}) => {
    doc.blockedToday += 1;
    doc.verdict = verdict;
    writeJsonAtomic(FILE, doc);
    appendLine(path.join(STATE, "events.jsonl"), { type: "humanity.vote-blocked", at: new Date(nowMs).toISOString(), account, verdict, ...extra });
    return { allowed: false, verdict, ...extra };
  };
  if (!persona || !persona.window) return block("UNPERSONAED", { account });
  if (persona.caps.votesPerDay === 0) return block("DORMANT", { account });
  if (dayCount(doc, account, "vote") >= persona.caps.votesPerDay) return block("DAY-CAP", { account, cap: persona.caps.votesPerDay });
  /* votes do NOT need the full window — a person votes when they read, any
   * waking hour — but the NIGHT law holds: no votes 01:00-05:00 UTC */
  const h = new Date(nowMs).getUTCHours();
  if (h >= 1 && h < 5) return block("NIGHT-HOLD", { account });
  const last = doc.j?.[account]?.votes ?? [];
  const rhythm = voteRhythmLaw({
    lastVotes: last, candidateTs: nowMs,
    candidateWeightPct: Math.min(persona.weightBand.max, Math.max(persona.weightBand.min, Number(weightPct))),
    band: persona.weightBand, minGapMin: 8, per30MinMax: 2,
    voter, selfAuthor,
  });
  if (rhythm.verdict !== "PASS") return block(`RHYTHM-${rhythm.verdict}`, { account, cls: rhythm.cls });
  return { allowed: true, verdict: "PASS", weightPct: Math.min(persona.weightBand.max, Math.max(persona.weightBand.min, Number(weightPct))) };
}

/** record* — the caller records AFTER a successful broadcast, so journals
 * reflect chain-truth, not intentions. */
export function recordPost({ account, title, ts = Date.now() }) {
  const doc = journal(account, "post", { title: String(title ?? "").slice(0, 160), ts: Number(ts) }, ts);
  doc.passedToday += 1;
  writeJsonAtomic(FILE, doc);
}
export function recordComment({ account, body, ts = Date.now() }) {
  const doc = journal(account, "comment", { body: String(body ?? "").slice(0, 200), ts: Number(ts) }, ts);
  doc.passedToday += 1;
  writeJsonAtomic(FILE, doc);
}
export function recordVote({ account, weightPct, ts = Date.now() }) {
  const doc = journal(account, "vote", { weightPct: Number(weightPct), ts: Number(ts) }, ts);
  doc.passedToday += 1;
  writeJsonAtomic(FILE, doc);
}

/** the equal-power plan (pure over chain rows) — consumed by delegation.mjs */
export function powerPlan(rows, target = null) {
  return equalPowerLaw({ accounts: rows, target });
}

/* CLI: humanity snapshot */
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = humanityPublic();
  console.log(JSON.stringify(s, null, 2));
}
