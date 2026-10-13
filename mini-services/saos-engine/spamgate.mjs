/* SAOS SPAMGATE (R243) — the anti-spam quality gate.
 *
 * WHY (operator directive 2026-10-07): "we are still at absolute shitpost
 * level — networks have bots that hunt and kill spam (e.g. @spaminator on
 * Hive). Learn what they flag, publish WITHOUT spam, run experiments on
 * Steem first."
 *
 * MEASURED LAW (2026-10-07, api.hive.blog, condenser get_account_history of
 * @spaminator, last 1000 ops): 466 downvotes (46.6% of all activity), every
 * one at weight -25 ("Proactive Spam & Exploitation Interception").
 * Victim profile (chain-read bodies):
 *   · top-level posts flagged from 283 chars body (thin content)
 *   · comments flagged from 8 chars (engagement farming: "nice post" class)
 *   · repeat offenders hunted per-author (one author flagged 18× in one scan)
 * OUR OWN NETWORK VERDICT (Domain STATE-REPORT 2026-10-07): every recent
 * fleet post got ~10 fleet votes and 0 outside votes — zero organic reach.
 * The network itself is already judging the output as spam. This gate is the
 * response: nothing publishes unless it clears the measured spam profile.
 *
 * RAILS (operator stop order, in code): publishing is STEEM-ONLY while the
 * cross-chain pause stands. Any other chain = REFUSED-CROSS-CHAIN-PAUSE,
 * fail-closed, exactly like the vault-revival HIVE/BLURT law.
 *
 * Pure halves here are selftest vectors; IO halves stay in daily/army-social.
 */

/* ── pure: text normalization + similarity ────────────────────────────────── */

export function normalizeText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!+\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → anchor text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_~`>|]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingles(s, n = 3) {
  const words = normalizeText(s).split(" ").filter(Boolean);
  const out = new Set();
  if (words.length < n) { if (words.length) out.add(words.join(" ")); return out; }
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

export function splitSentences(body) {
  return String(body ?? "")
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeText(s))
    .filter((s) => s.split(" ").length >= 4);
}

/* self-duplication inside ONE draft: same sentence (≥4 words) repeated */
export function dupSentenceRatio(body) {
  const sents = splitSentences(body);
  if (sents.length < 2) return 0;
  const seen = new Map();
  let dups = 0;
  for (const s of sents) seen.set(s, (seen.get(s) ?? 0) + 1);
  for (const c of seen.values()) if (c > 1) dups += c - 1;
  return dups / sents.length;
}

export function countEmoji(body) {
  const m = String(body ?? "").match(/\p{Extended_Pictographic}/gu);
  return m ? m.length : 0;
}

export function linkChars(body) {
  const m = String(body ?? "").match(/https?:\/\/\S+/g) ?? [];
  return m.reduce((n, u) => n + u.length, 0);
}

/* ── pure: the measured bait/spam phrase law ──────────────────────────────── */

const BAIT_PATTERNS = [
  /\bupvote (me|this|back)\b/i, /\bvote (for me|me back)\b/i, /\bfollow (me|back) (and|for)\b/i,
  /\bguaranteed (profit|returns?|income)\b/i, /\bdouble your (money|steem|crypto)\b/i,
  /\bfree (crypto|steem|sbd|tokens?|airdrop)\b/i, /\bjoin (my|our) (telegram|whatsapp)\b/i,
  /\bclick (here|now) (and|to) (win|earn|claim)\b/i, /\bearn \$?\d+ (per|a|\/) ?day\b/i,
  /\bwork from home (and )?earn\b/i, /\bclaim (your|the) (free )?(reward|airdrop|tokens?)\b/i,
  /\bdm me (for|to)\b/i, /\bcontact me on (telegram|whatsapp)\b/i,
];

export function spamPhraseHits(body) {
  const hits = [];
  for (const re of BAIT_PATTERNS) {
    const m = String(body ?? "").match(re);
    if (m) hits.push(m[0].toLowerCase());
  }
  return hits;
}

const BANNED_TAGS = new Set(["nsfw", "porn", "airdrop", "giveaway", "free-steem", " pumps", "hyip", "invest-now"]);

/* ── pure: verdicts ───────────────────────────────────────────────────────── */

/* R254 · CHAIN GATES (operator approval, verbatim intent): "אני מאשר ניסיון
 * ובחינה פתיחה בhive וזיהוי spaminator על מה הוא מסמן ולמה ומה הסיבות
 * ותיקונים לאחר מכן" + "לגבי blurt תמתין נבחן תוצאות בhive".
 * → HIVE: ALLOWED as a measured trial, with STRICTER gates (rep-0 accounts
 *   on Hive are exactly what spaminator hunts — our posts must be BETTER
 *   there than on Steem, not equal).
 * → BLURT (R294): reopened as the strictest trial by owner order
 *   2026-10-11; broadcasting additionally gated by state/blurt-arm.json
 *   (deliberate owner act) + chain-judged posting custody. */
export const CHAIN_POLICY = Object.freeze({
  steem: { allowed: true },
  hive: { allowed: true, trial: true, minPostChars: 1600, maxSelfSimPost: 0.25, minCommentChars: 260, dayCap: 1 },
  /* R294 · owner order 2026-10-11 ("החשבונות blurt לא מחוברים... צריך לטפל
   * בזה") supersedes the R254 pause ("לגבי blurt תמתין"). Blurt reopens as
   * the STRICTEST trial — stricter than hive on every gate — and its
   * broadcasting additionally requires the deliberate arm-file
   * (state/blurt-arm.json) + chain-judged posting custody (blurt.mjs). */
  blurt: { allowed: true, trial: true, minPostChars: 1800, maxSelfSimPost: 0.20, minCommentChars: 300, dayCap: 1, requiresArmFile: true },
});

export function chainGate(chain, g = GATE_DEFAULTS) {
  const pol = CHAIN_POLICY[String(chain ?? "").toLowerCase()] ?? null;
  if (!pol) return { ok: false, reasons: [`unknown-chain(${chain})`], g };
  if (!pol.allowed) return { ok: false, reasons: [pol.reason ?? `chain-refused(${chain})`], g: null };
  const gg = pol.trial ? { ...g, minPostChars: pol.minPostChars ?? g.minPostChars, maxSelfSimPost: pol.maxSelfSimPost ?? g.maxSelfSimPost, minCommentChars: pol.minCommentChars ?? g.minCommentChars } : g;
  return { ok: true, reasons: [], g: gg, trial: !!pol.trial };
}

export const GATE_DEFAULTS = Object.freeze({
  minPostChars: 1200,   // measured: spaminator flags from 283; 1230-1580 victims too → comfortable headroom
  minCommentChars: 200, // measured: victim comments were 8-130 chars
  maxLinkRatio: 0.15,
  maxDupSentenceRatio: 0.15,
  maxEmoji: 10,
  maxSelfSimPost: 0.30,   // jaccard vs own recent bodies (chain truth)
  maxSelfSimComment: 0.50,
  minGroundedRefs: 1,   // a post must stand on ≥1 measured reference (content.mjs groundedOn)
  minTitleChars: 8,
  maxTitleChars: 100,
  maxTags: 5,
});

export function titleVerdict(title, g = GATE_DEFAULTS) {
  const t = String(title ?? "").trim();
  const reasons = [];
  if (t.length < g.minTitleChars) reasons.push(`title-too-short(<${g.minTitleChars})`);
  if (t.length > g.maxTitleChars) reasons.push(`title-too-long(>${g.maxTitleChars})`);
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 8 && letters === letters.toUpperCase()) reasons.push("title-all-caps");
  if (/(click here|you won'?t believe|shocking|free money|get rich)/i.test(t)) reasons.push("title-clickbait");
  return { ok: reasons.length === 0, reasons, len: t.length };
}

export function tagVerdict(tags, g = GATE_DEFAULTS) {
  const list = (Array.isArray(tags) ? tags : []).map((t) => String(t ?? "").toLowerCase().trim()).filter(Boolean);
  const reasons = [];
  if (!list.length) reasons.push("no-tags");
  if (list.length > g.maxTags) reasons.push(`too-many-tags(>${g.maxTags})`);
  const bad = list.filter((t) => BANNED_TAGS.has(t));
  if (bad.length) reasons.push(`banned-tags(${bad.join(",")})`);
  if (new Set(list).size !== list.length) reasons.push("duplicate-tags");
  return { ok: reasons.length === 0, reasons, tags: list };
}

export function bodyVerdict(body, { isComment = false, g = GATE_DEFAULTS } = {}) {
  const reasons = [];
  const min = isComment ? g.minCommentChars : g.minPostChars;
  const text = String(body ?? "");
  if (text.length < min) reasons.push(`body-too-thin(${text.length}<${min})`);
  const lr = text.length ? linkChars(text) / text.length : 0;
  if (lr > g.maxLinkRatio) reasons.push(`link-stuffing(${lr.toFixed(2)})`);
  const dr = dupSentenceRatio(text);
  if (dr > g.maxDupSentenceRatio) reasons.push(`self-duplication(${dr.toFixed(2)})`);
  const em = countEmoji(text);
  if (em > g.maxEmoji) reasons.push(`emoji-flood(${em})`);
  const hits = spamPhraseHits(text);
  if (hits.length) reasons.push(`bait-phrases(${hits.slice(0, 3).join("|")})`);
  return { ok: reasons.length === 0, reasons, bodyLen: text.length, linkRatio: Number(lr.toFixed(3)), dupRatio: Number(dr.toFixed(3)), emoji: em };
}

/* similarity vs the author's OWN recent chain bodies — the repetition law
 * spaminator hunts (repeat offenders) */
export function selfSimVerdict(body, ownRecentBodies, { isComment = false, g = GATE_DEFAULTS } = {}) {
  const mine = shingles(body);
  const max = isComment ? g.maxSelfSimComment : g.maxSelfSimPost;
  const reasons = [];
  const sims = [];
  for (const prev of (ownRecentBodies ?? []).slice(0, 10)) {
    const s = jaccard(mine, shingles(prev));
    sims.push(Number(s.toFixed(3)));
    if (s > max) { reasons.push(`self-repetition(${(s * 100).toFixed(0)}%> ${(max * 100).toFixed(0)}%)`); break; }
  }
  return { ok: reasons.length === 0, reasons, sims };
}

/* the post must stand on measured ground — no free-floating word salad */
export function groundingVerdict(draft, { isComment = false, g = GATE_DEFAULTS } = {}) {
  if (isComment) return { ok: true, reasons: [] };
  const refs = Array.isArray(draft?.groundedOn) ? draft.groundedOn.filter(Boolean) : [];
  return refs.length >= g.minGroundedRefs
    ? { ok: true, reasons: [], refs: refs.length }
    : { ok: false, reasons: [`ungrounded(${refs.length}<${g.minGroundedRefs})`], refs: refs.length };
}

/* frequency: chain-counted posts TODAY for this author (never local counters) */
export function frequencyVerdict(postsToday, cap, g = GATE_DEFAULTS) {
  const ok = Number(postsToday ?? 0) < Number(cap ?? 1);
  return { ok, reasons: ok ? [] : [`day-cap-reached(${postsToday}>=${cap})`] };
}

/* the chain law — R254: steem + hive (hive as measured trial, stricter gates
 * via chainGate). R294 (owner 2026-10-11): blurt reopens as the strictest
 * trial — its broadcast path additionally requires the owner arm-file +
 * chain-judged custody (see blurt.mjs). */
export function crossChainVerdict(chain) {
  const c = String(chain ?? "").toLowerCase();
  return c === "steem" || c === "hive" || c === "blurt"
    ? { ok: true, reasons: [], chain: c, note: c === "blurt" ? "R294 strictest trial — arm-file + custody additionally required (blurt.mjs)" : null }
    : { ok: false, reasons: [`REFUSED-CROSS-CHAIN-PAUSE(chain=${chain || "unknown"}; allowed: steem + hive-trial + blurt-strictest-trial (R294))`] };
}

/* ── pure: the one gate ───────────────────────────────────────────────────── */

/* draft: {title, body, tags, groundedOn} | comment: {body} (title/tags empty)
 * ctx: {isComment, chain, ownRecentBodies, postsToday, dayCap, g} */
export function spamVerdict(draft, ctx = {}) {
  const { isComment = false, chain = "steem", ownRecentBodies = [], postsToday = 0, dayCap = 1, g = GATE_DEFAULTS } = ctx;
  const cg = chainGate(chain, g);
  if (!cg.ok) {
    return { ok: false, reasons: cg.reasons.slice(0, 3), checks: { chain: cg }, gate: "saos-spamgate-v1", isComment };
  }
  const gg = cg.g;
  const cc = crossChainVerdict(chain);
  const checks = { crossChain: cc, chainGate: { ok: true, trial: !!cg.trial } };
  const reasons = [];
  {
    const parts = [
      ["title", isComment ? { ok: true, reasons: [] } : titleVerdict(draft?.title, gg)],
      ["tags", isComment ? { ok: true, reasons: [] } : tagVerdict(draft?.tags, gg)],
      ["body", bodyVerdict(isComment ? draft?.body : `${draft?.title ?? ""}\n${draft?.body ?? ""}`, { isComment, g: gg })],
      ["selfSim", selfSimVerdict(draft?.body ?? "", ownRecentBodies, { isComment, g: gg })],
      ["grounding", groundingVerdict(draft, { isComment, g: gg })],
      ["frequency", frequencyVerdict(postsToday, dayCap, gg)],
    ];
    for (const [name, v] of parts) {
      checks[name] = v;
      if (!v.ok) reasons.push(...(v.reasons ?? []).map((r) => `${name}:${r}`));
    }
  }
  return { ok: reasons.length === 0, reasons, checks, gate: "saos-spamgate-v1", isComment, trial: !!cg.trial };
}

/* ── pure: the organic-verdict learning loop ────────────────────────────────
 * The network's own vote is the judge: if our last N posts collected ZERO
 * outside votes (fleet echo only), the gate TIGHTENS — next posts need more
 * depth, and the rail pauses long enough to rebuild quality. */

export function organicVerdict(recentPosts, { window = 5, minOutside = 1, pauseDays = 2, tightenedChars = 1600 } = {}) {
  const posts = (Array.isArray(recentPosts) ? recentPosts : []).slice(0, window);
  if (posts.length < window) return { ok: true, tighten: false, verdict: "NO-SIGNAL-YET", posts: posts.length };
  const zero = posts.filter((p) => Number(p.outside ?? 0) < minOutside).length;
  const flags = posts.reduce((n, p) => n + Number(p.flags ?? 0), 0);
  if (flags > 0) return { ok: false, tighten: true, verdict: "FLAGGED-STOP", flags, pauseDays, minPostChars: tightenedChars };
  if (zero === window) return { ok: true, tighten: true, verdict: "ZERO-ORGANIC-TIGHTEN", zero, minPostChars: tightenedChars };
  return { ok: true, tighten: false, verdict: "ORGANIC-OK", zero, posts: posts.length };
}

/* ── pure: R254 · THE DOWNVOTE VETO (operator law, verbatim intent) ─────────
 * "שיעצרו שיש downvote ואז נבחן מה הסיבה ונשפר בכל המערכות תמיד בהתאם"
 * The moment ANY of our posts eats a downvote: that author STOPS publishing
 * (per-account pause), the flag is journaled WITH evidence (who/what/why
 * candidates), and resumption is a deliberate analysis-first decision —
 * as long as nothing is flagged, the round continues (operator: "כל עוד
 * לא מקבלים ממשיכים"). */
export function flagPauseVerdict(postRow) {
  const flags = Number(postRow?.flags ?? 0);
  if (!Number.isFinite(flags) || flags <= 0) return { pause: false, reasons: [] };
  return {
    pause: true,
    reasons: [
      `downvoted(${flags}x)`,
      `post=${postRow?.author ?? "?"}/${String(postRow?.permlink ?? "").slice(0, 44)}`,
      `bodyLen=${postRow?.bodyLen ?? "?"} chain=${postRow?.chain ?? "steem"}`,
      "analysis-first: read the downvoter + reason, fix the law, only then resume",
    ],
  };
}

/* ── state (IO-lite; verdict-only, no secrets) ────────────────────────────── */

import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const WATCH_FILE = path.join(STATE, "spamwatch.json");

export function spamwatchState() {
  try { return JSON.parse(fs.readFileSync(WATCH_FILE, "utf8")); } catch { return null; }
}
export function saveSpamwatch(doc) {
  fs.mkdirSync(STATE, { recursive: true });
  const t = `${WATCH_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(doc, null, 1));
  fs.renameSync(t, WATCH_FILE);
}
