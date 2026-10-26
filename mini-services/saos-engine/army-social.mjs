/**
 * army-social.mjs — T-85 · THE SMART-SOCIAL RAIL (רנדומליות-חכמה, גילוי-כנה).
 *
 * OPERATOR ORDER 2026-10-06 (verbatim intent): "כל הסוכנים יצביעו בזמנים
 * רנדומליים, יפרסמו בזמנים רנדומליים, יצביעו אחד על השני, ויגיבו אחד לשני —
 * לשפר את האינטליגנציה של כל הנושא".
 *
 * HOW THE LAWS HOLD:
 *  - CUSTODY FIRST (T-80): an account without a chain-verified credential is
 *    never signed for. Its rail entry reports REFUSED-NO-CUSTODY honestly, and
 *    the day the operator drops its credential (upload/ → adopt-credential →
 *    verifyRoles), the SAME rail lights up with zero code change. Today the
 *    master (headcorner) is verified — so the master's social life is live
 *    immediately; the 10 army accounts are honestly parked on the operator
 *    gate.
 *  - RANDOMNESS IS SEEDED: mulberry32(day|account) builds each account's day
 *    schedule (publish minute, fleet-vote minutes, reply minutes) — actions
 *    scatter across legal hours like natural activity, yet the exact plan is
 *    reproducible post-hoc from state/social.json (auditability is law).
 *  - CONTENT NEVER INVENTED HERE: publishes come ONLY from the sanitized
 *    drafts queue (content-ops exposure law). Replies come from the bridge
 *    LLM under the same exposure law, then re-sanitized in pure code.
 *  - CAPS EVERYWHERE: ≤1 publish/day/account, ≤2 fleet votes/day/account
 *    (low weight — support, not bandwagon), ≤2 replies/day/account, and the
 *    signer's think-gate re-checks every broadcast.
 *
 * T-87 (operator round-1 order, 2026-10-06): "הסוכנים יגיבו אחד לשני" —
 * the conversation laws open up, with anti-pattern guards kept intact:
 *  - fleet-comment lane: ≤1 comment/day/account on a fleet sibling's fresh
 *    post (least-commented tier first — conversation spreads, never herds).
 *  - fleet replies: a fleet member's comment is now a lawful reply target.
 *  - anti-herd vote pick: candidates ranked by how many ROSTER votes they
 *    already carry (chain-truth active_votes) — the least-supported post
 *    gets the next vote, so support spreads across the fleet, not one darling.
 *  - every fleet-authored body still passes sanitizeReply, whose banned list
 *    now includes ALL roster names — a body that names a sibling never ships.
 *
 * R243 (operator order 2026-10-07, verbatim intent): "אני רק מדבר לעצמי
 * בחשבון... צריך שנגיב אחד לשני... פסיכולוגיה... להרים אינטליגנציה
 * משמעותית חובה". The chain audit found FOUR conversation-killing defects:
 *  · GENERIC PRAISE — "That's a great point about..." on loop: real words,
 *    zero substance. sanitizeReply now hard-blocks template openers.
 *  · SELF-REPLIES — an account could reply its own comment on its own post
 *    (wog→wog, tov→tov on-chain). fetchRepliableComments now skips own
 *    authorship — a monologue is not a conversation.
 *  · NO THREAD DEEPENING — a reply to OUR comment died unanswered. New
 *    deepen lane: when someone answers us, we answer back (that is what
 *    conversation IS). ≤1/day/account, same exposure law.
 *  · THE CLOSED LOOP — every comment stayed inside the roster. New
 *    community lane: one real comment/day/account on a NON-fleet post in a
 *    living community tag (hot feed, cold-post tier first — we join quiet
 *    good threads instead of stampeding the winners).
 *  · REPEAT GUARD — woq said the near-same sentence to lsa twice. New
 *    replyFreshness gate: a body too close to something we already said
 *    today (n-gram similarity) never ships.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, custodyOf } from "./signer.mjs";
import { mulberry32, hashSeed } from "./curator.mjs";
import { PUBLISH_ELIGIBLE_SINCE, titleSimilarity, recentPublishedTitles, wordCount, MIN_POST_WORDS, normalizeDashes, enforceSymbolLaw } from "./content.mjs";
import { personaOf, arcStageOf, profileDoc, profileDiffers, mergeProfileMetadata, personaBrief } from "./personas.mjs";
import { synthesizeReply, synthesizePersonaComment, synthesizePersonaReply, isProbeComment, mentionsAny } from "./intel-pack.mjs";
import { spamVerdict, organicVerdict, flagPauseVerdict, crossChainVerdict, spamwatchState, saveSpamwatch, GATE_DEFAULTS } from "./spamgate.mjs";
import { bridgeOpen, noteBridgeFailure, noteBridgeSuccess } from "./bridge-guard.mjs";
import { loadOrBuild as loadFleetLedger, uniqueness as fleetUniqueness, notePublished as noteFleetLedgerPublished, saveLedger as saveFleetLedgerFile } from "./fleet-ledger.mjs";
/* R302/R303 (T-83): the content judge + the Git-as-Memory learning loop —
 * the SoMe/market-ldr distillation, composed ON TOP of the existing gates. */
import { judgeVerdict, loadDNA } from "./content-judge.mjs";
import { loadMemory, recordRejected, recordPublished } from "./content-memory.mjs";
import { reviveArmyCustody, ARMY_ROSTER as ROSTER_BASE } from "./vault-revival.mjs";
import { readCommunityState, communityPostMeta, communityMetaObj } from "./community.mjs";
import { embedImage } from "./illustrate.mjs";
import { socialGateVerdict, STANDBY_RECEIPT, refreshLaws } from "./readiness-gate.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
/* SAOS_STATE_DIR (R275 merge law): the selftest may run while the live engine
 * flushes the same state files — two writers, one file, the probe's seeds get
 * clobbered mid-run (measured live: the R277 vector read the engine's snapshot
 * instead of its own seed). Tests set SAOS_STATE_DIR to an isolated dir; the
 * engine never does, so runtime behavior is byte-identical. */
const STATE = process.env.SAOS_STATE_DIR || path.join(DIR, "state");
const SOCIAL_FILE = path.join(STATE, "social.json");
const FLAG_PAUSES_FILE = path.join(STATE, "flag-pauses.json");
const COMMUNITY_ROUND_FILE = path.join(STATE, "community-round.json");
const CONTENT_FILE = path.join(STATE, "content-ops.json");
const PERSONAS_FILE = path.join(STATE, "personas.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* R245 · the standing roster: master + the 10 old-army accounts (T-80 custody
 * list) + the replacement generation hcsoldier4/5/6 (full-access custody,
 * operator access-law: money authority required — see vault-revival.mjs) */
export const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq",
  "hcsoldier4", "hcsoldier5", "hcsoldier6"];

export function socialPolicy() {
  const conf = armedConf();
  return {
    enabled: true,
    publishWindow: [11, 21],   // R254: prime-time UTC hours (measured Steem activity peak)
    fleetSlotWindow: [11, 21], // fleet publish slots cut from the same prime window
    maxPostsPerDay: 1,          // per account — presence, never flood (anti-spam law stays)
    maxFleetVotesPerDay: 3,     // per account — R244 amplification (תגביר עוצמה)
    fleetWeightPct: 8,          /* 28-steem measured-law: the old 25% x 6 uniform fleet votes
                                 * on every post was the exact bot-farm signature that got
                                 * the WHOLE roster shelled on steemit.com (measured
                                 * 2026-10-13/14: origin serves the landing shell for all 14
                                 * accounts while chain truth stays intact; control accounts
                                 * render fully from the same IP). 8% keeps the support real
                                 * and kills the uniform-weight signature. */
    maxFleetVotesPerPost: 2,    /* R298 ring-cap: the chain showed 5-7 fleet votes on every
                                 * post — a ring shape. ≤2 fleet votes per post, chain-truth. */
    /* R301 · THE STEALTH DOCTRINE (owner order 2026-10-14, verbatim:
     * "מבחינתי זה בסדר כרגע שאנחנו לא מופיעים אנחנו יכולים לקדם את עצמנו טוב
     * יותר בלי להציף את הרשת ושלא יראו את הפעולות שלנו עד שנהיה מוכנים באמת
     * לפעול כגוף הנדסי חזק ועוצמתי ברשת") — during the shelling period the
     * fleet keeps a human footprint and NOTHING else: zero fleet votes (the
     * uniform ring shape was THE signature that shelled all 14), a seeded
     * fleet-wide publish ROTATION (≤ maxFleetPostsPerDay posts/day across the
     * roster instead of 14), conversation halved. Promotion continues —
     * presence, never flood. The owner lifts any line via armedConf().social
     * (the spread below is the override point) or by flipping stealth off. */
    stealth: true,
    maxFleetPostsPerDay: 6,      // fleet-wide total (rotation across the roster), was: 14 slots
    maxFleetVotesPerDay: 0,      /* stealth: ring votes are the shelling signature — zero,
                                  * even at R298's jittered 8-13% weight */
    maxFleetCommentsPerDay: 1,  // was 2 — half the visible cross-account talk
    fleetRepliesEnabled: true,  // T-87: fleet comments are lawful reply targets
    maxRepliesPerDay: 1,        // was 3 — stealth halves it again
    voteAgeMinMinutes: 15,      // fresh enough to earn curation share
    voteAgeMaxMinutes: 1200,    // 20h
    minCommentChars: 15,        // skip "nice"/spam comments
    maxReplyChars: 700,
    /* R243: the intelligence round — substance caps for the new lanes
     * R301 (stealth, owner 2026-10-14): halved from 2 — less visible talk */
    maxCommunityCommentsPerDay: 1,   // stealth: was 2
    maxConversationDeepensPerDay: 1, // stealth: was 2
    minCommunityPostChars: 400,      // comment real posts, not stubs
    communityTags: ["life", "psychology", "food", "photography", "writing", "nature", "health", "travel"],
    communityBlockedAuthors: ["steemit", "steem", "steemitblog", "busy", "steemcurator01", "steemcurator02", "upvu", "cmp2020"],
    repeatSimilarityMax: 0.34,       // Jaccard(3-gram) vs anything we already said today
    ...(conf.social ?? {}),
  };
}

export const dayKeyOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10);

/* ── pure: R301 · THE STEALTH PUBLISH ROTATION (owner order 2026-10-14) ────
 * The fleet-wide cap picks TODAY's publishers deterministically out of the
 * roster (seeded per day+account, auditable, reproducible). Parked accounts
 * keep their conversation lanes — presence without flood. The same subset
 * all day (no intraday flapping), a different subset across days (no
 * always-on/always-off accounts — every account eventually publishes).
 * cap 0 → nobody publishes · cap ≥ roster → everyone (law unchanged). */
export function stealthPublishers(dayIso, roster, cap, seedSalt = "stealth-v1") {
  const list = (Array.isArray(roster) ? roster : []).filter(Boolean);
  const n = Math.max(0, Math.min(Math.floor(Number(cap)), list.length));
  if (!Number.isFinite(n) || n <= 0) return [];
  return [...list]
    .map((account, i) => ({ account, k: hashSeed(`${String(dayIso ?? "")}|${seedSalt}|${account}`) + i }))
    .sort((x, y) => x.k - y.k || x.account.localeCompare(y.account))
    .slice(0, n)
    .map((x) => x.account)
    .sort();
}

/* ── pure: R254 · FLEET PUBLISH SLOTS (better scheduling, operator order) ───
 * "אני רוצה אינטלגנציה רבה בהפעלה של כולם וגם יפה אני רואה תזמונים יותר
 * טובים" — the fleet no longer draws independent random publish minutes
 * (which collided: two accounts posting within minutes reads as bot pacing).
 * The prime window (11:00–21:00 UTC, measured Steem activity hours) is cut
 * into ONE SLOT PER ACCOUNT; each account jitters inside its own slot. The
 * ≥ slot-width separation is collision-free BY CONSTRUCTION, still seeded
 * and reproducible (auditability is law). */
export function fleetPublishMinutes(dayIso, roster, { window = [11, 21], jitterMin = 12 } = {}) {
  const list = (Array.isArray(roster) ? roster : []).filter(Boolean);
  const out = {};
  if (!list.length) return out;
  const startMin = Math.max(0, Math.min(23, window[0])) * 60;
  const endMin = Math.max(startMin + list.length, Math.min(1440, window[1] * 60));
  const slotW = Math.max(1, Math.floor((endMin - startMin) / list.length));
  list.forEach((account, i) => {
    const rand = mulberry32(hashSeed(`${dayIso}|${account}|fleet-slot-v1`));
    const base = startMin + i * slotW + Math.floor(slotW / 2);
    const jitter = Math.floor(rand() * (2 * jitterMin + 1)) - jitterMin;
    const lo = startMin + i * slotW, hi = startMin + (i + 1) * slotW - 1;
    out[account] = Math.min(hi, Math.max(lo, base + jitter));
  });
  return out;
}

/* ── pure: the day schedule (auditable randomness) ──────────────────────────
 * seed → deterministic minute-of-day per action kind. Publish lands once in
 * the daylight window; fleet votes + replies scatter through waking hours.
 * R254: publishMinute (exact) lets the FLEET-SLOT system pin each account's
 * publish into a collision-free prime-time slot. */
export function buildDaySchedule(seed, { publishWindow = [11, 21], publishMinute = null } = {}) {
  const rand = mulberry32(seed);
  const minuteOf = (h0, h1) => {
    const start = h0 * 60, span = Math.max(1, (h1 - h0) * 60);
    return start + Math.floor(rand() * span);
  };
  return [
    { kind: "publish", minute: Number.isFinite(publishMinute) ? publishMinute : minuteOf(publishWindow[0], publishWindow[1]) },
    { kind: "fleet-vote", minute: minuteOf(6, 24) },
    { kind: "fleet-vote", minute: minuteOf(6, 24) },
    { kind: "fleet-vote", minute: minuteOf(6, 24) },   // R244 amplification
    { kind: "fleet-comment", minute: minuteOf(6, 24) },
    { kind: "fleet-comment", minute: minuteOf(6, 24) }, // R244 amplification
    { kind: "reply", minute: minuteOf(6, 24) },
    { kind: "reply", minute: minuteOf(6, 24) },
    { kind: "reply", minute: minuteOf(6, 24) },         // R244 amplification
    /* R243: the conversation lanes — join the wider community, answer who
     * answers us. Seeded like every other action: natural scatter, auditable. */
    { kind: "community-comment", minute: minuteOf(6, 24) },
    { kind: "community-comment", minute: minuteOf(6, 24) }, // R244 amplification
    { kind: "deepen", minute: minuteOf(6, 24) },
    { kind: "deepen", minute: minuteOf(6, 24) },            // R244 amplification
  ];
}

/* pure: reply sanitizer — the exposure law, re-checked in code.
 * R243: template-praise openers are BANNED — the chain audit proved they
 * turn every conversation into an echo of hollow applause. */
export const TEMPLATE_OPENERS = [
  "that's a great", "that's a wonderful", "that's an interesting", "that's really interesting",
  "great point", "great observation", "great approach", "great perspective", "great question",
  "you're absolutely right", "you are absolutely right", "you've highlighted",
  "i completely agree", "couldn't agree more", "i couldn't agree more", "well said",
  "this resonates", "i love how", "i really love how", "thanks for sharing", "thank you for sharing",
  "wonderful perspective", "fascinating post", "amazing post", "beautiful post",
  /* R270 (operator order: "התגובות שלנו הן די דומות מאוד... תשפר תבונה ואיכות"):
   * the second generation of AI-stock openers the bridge kept drifting to. */
  "couldn't have said it better", "this is such a", "such an insightful", "absolutely fascinating",
  "this made my day", "following for more", "great share", "valuable insight", "spot on",
  "this hits home", "so true", "very true", "totally agree", "100% agree", "keep it up",
  "keep up the great", "loved this", "enjoyed this read", "mind blown", "what a thoughtful",
  "this deserves more", "underrated post", "totally agree with this",
  /* R283 (operator order — the third measured generation, chain-truthed):
   * the template framings the fallback pack minted for rounds. A body that
   * opens like a form letter is dead conversation and it never ships. */
  "let's measure it", "lets measure it", "bottom line up front", "the trigger point is",
  "one more layer", "this is exactly the thread worth pulling", "here's the thing",
  "heres the thing", "let me add this", "the way i see it",
];
export function sanitizeReply(text) {
  /* R262: the style law finally covers REPLIES too — the synthesizer frames
   * shipped literal " — " for rounds because only the POST lanes normalized.
   * Rewrite first, ban second, same contract as sanitizeDraft.
   * R283: the SYMBOL LAW rides here too — dashes, double quotes and colons
   * rewrite to safe punctuation, anything that survives the rewrite with a
   * banned glyph is a REFUSAL, never a broadcast. */
  const normalized = enforceSymbolLaw(String(text ?? ""));
  if (normalized === null) return null;
  const body = normalized.trim().replace(/\s+/g, " ");
  if (body.length < 20 || body.length > 700) return null;
  const low = body.toLowerCase();
  /* R243: the first 90 chars carry the opener — template praise there = dead
   * conversation, refuse it in pure code (the bridge is also taught, but the
   * engine owns the veto) */
  const head = low.slice(0, 90);
  if (TEMPLATE_OPENERS.some((t) => head.includes(t))) return null;
  /* T-87: every roster name is banned too — a fleet-authored body that names
   * a sibling account never ships (no cross-mention patterns, ever).
   * R244 ROOT-CAUSE FIX: bare substring matching vetoed common English —
   * "wic" sat inside "twice", killing lawful replies (a hidden contributor
   * to the 0-comments symptom). Names now match on WORD BOUNDARIES only. */
  const banned = ["headcorner", "hcsoldier", ...ARMY_ROSTER, "saos", "צבא", "our accounts", "multi-account", "we control", "our fleet", "guaranteed profit", "price target", "financial advice"];
  if (mentionsAny(low, banned)) return null;
  if (low.includes("http://") || low.includes("https://")) return null;
  return body;
}

/* pure (R243): n-gram Jaccard freshness — a body too close to something this
 * account ALREADY said today never ships (the woq/lsa repeat bug) */
export function ngrams(text, n = 3) {
  const words = String(text ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  if (!out.size && words.length) out.add(words.join(" "));
  return out;
}
export function textSimilarity(a, b, n = 3) {
  const A = ngrams(a, n), B = ngrams(b, n);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size);
}
export function replyFresh(text, saidToday, { maxSimilarity = 0.34 } = {}) {
  if (!text || !String(text).trim()) return false;
  return !Array.from(saidToday ?? []).some((s) => textSimilarity(text, s) >= maxSimilarity);
}

/* pure: title → legal permlink stem (a-z0-9- only, steem-safe) */
export function permlinkStem(title, day, i) {
  const slug = String(title ?? "post").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "post";
  return `${slug}-${day.replace(/-/g, "")}-${i.toString(36)}`;
}

/* ── fleet fresh-post scan (bounded, rotating) ────────────────────────────── */
async function fetchFleetPosts({ viewer, accounts, nowMs, p, excludePermlinks }) {
  const out = [];
  const rosterSet = new Set(accounts);
  for (const acct of accounts) {
    if (acct === viewer) continue;
    try {
      const r = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: acct, limit: 5 }]);
      for (const post of (r.ok ? r.result : []).filter((x) => x.author === acct)) {
        const createdMs = Date.parse(post.created);
        const ageMin = (nowMs - createdMs) / 60000;
        if (!(ageMin >= p.voteAgeMinMinutes && ageMin <= p.voteAgeMaxMinutes)) continue;
        const key = `${post.author}/${post.permlink}`;
        if (excludePermlinks.has(key)) continue;
        out.push({
          author: post.author, permlink: post.permlink, createdMs,
          title: post.title, bodyLen: (post.body ?? "").length,
          excerpt: String(post.body ?? "").slice(0, 300),
          votes: (post.active_votes ?? []).length,
          rosterVotes: (post.active_votes ?? []).filter((v) => rosterSet.has(v.voter)).length,
          myVote: (post.active_votes ?? []).some((v) => v.voter === viewer), /* R274: chain-truth — the chain remembers every vote */
          children: post.children ?? 0,
        });
      }
    } catch { /* one dead read never kills the rail */ }
  }
  return out;
}

/* ── R254 · THE SMART REPLY CLASSIFIER (operator law, verbatim intent) ──────
 * "אם הם מגיבים לנו לראות שזה לא איזה בוט עם דירוג נמוך לענות רק למי
 * שרלוונטי צריך מערכת חכמה" — we manage our activity among ourselves and
 * never feed bots: a commenter with a bot-shaped name, a sub-25 reputation,
 * or a hollow template-praise body is NOT a conversation partner. Only
 * relevant humans (or fleet siblings inside the caps) get our words. */
const BOT_NAME_RE = /(bot$|^bot|[-_.]bot|upvote|promot|booster|smartsteem|tipu|treeplanter|steembasicincome|sbi[0-9]|guest|spam|faucet)/i;
export function repFromRaw(raw) {
  const r = Number(raw ?? 0);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.max(0, Math.round((Math.log10(r) - 9) * 9 + 25));
}
export function replyTargetVerdict({ author, repRaw, body, isFleet = false }, p = {}) {
  const minRep = Number(p.minReplyRep ?? 25);
  const reasons = [];
  if (isFleet) return { ok: true, reasons: [], class: "fleet" }; // capped + sanitized elsewhere
  if (!author) return { ok: false, reasons: ["no-author"], class: "invalid" };
  if (BOT_NAME_RE.test(String(author))) reasons.push(`bot-name(${author})`);
  const rep = repFromRaw(repRaw);
  if (rep < minRep) reasons.push(`low-rep(${rep}<${minRep})`);
  const b = String(body ?? "").trim();
  const opener = TEMPLATE_OPENERS.find((t) => b.toLowerCase().includes(t));
  if (opener && b.length < 120) reasons.push(`template-praise(${b.length}c)`);
  if (b.length < 15) reasons.push(`too-thin(${b.length}c)`);
  return { ok: reasons.length === 0, reasons, class: reasons.length === 0 ? "human" : "skip", rep };
}

/* ── comment replies scan on an account's own recent posts ───────────────── */
async function fetchRepliableComments(account, repliedSet, p) {
  const recent = await rpcCall("condenser_api.get_discussions_by_blog", [{ tag: account, limit: 4 }]);
  const own = (recent.ok ? recent.result : []).filter((x) => x.author === account).slice(0, 3);
  for (const post of own) {
    const r = await rpcCall("condenser_api.get_content_replies", [account, post.permlink]);
    for (const c of (r.ok ? r.result : [])) {
      const key = `${c.author}/${c.permlink}`;
      /* R243 SELF-REPLY VETO: our own comment on our own post is a monologue,
       * not a conversation — the chain showed wog→wog, tov→tov. Never again. */
      if (c.author === account) continue;
      if (repliedSet.has(key)) continue;
      if (String(c.body ?? "").trim().length < p.minCommentChars) continue;
      const isFleet = ARMY_ROSTER.includes(c.author) || c.author === masterAccount();
      if (isFleet && !p.fleetRepliesEnabled) continue; // T-87: fleet conversation is lawful — caps + sanitizer still hold
      /* R254 SMART-REPLY: bots and low-rep drive-bys get silence, not words
       * (the chain verdict is fetched per candidate — one cheap lookup). */
      const acc = await rpcCall("condenser_api.get_accounts", [[c.author]]);
      const repRaw = acc?.ok ? acc.result?.[0]?.reputation : undefined;
      const verdict = replyTargetVerdict({ author: c.author, repRaw, body: c.body, isFleet }, p);
      if (!verdict.ok) {
        appendLine(path.join(STATE, "events.jsonl"), { type: "social.reply-skipped", at: new Date().toISOString(), account, commenter: c.author, class: verdict.class, reasons: verdict.reasons.slice(0, 3) });
        continue;
      }
      return {
        comment: key,
        parentAuthor: c.author,
        parentPermlink: c.permlink,
        postTitle: post.title,
        postExcerpt: String(post.body ?? "").slice(0, 400),
        commentBody: String(c.body ?? "").slice(0, 400),
      };
    }
  }
  return null;
}

/* R263 · THE PERSONA-VOICED REPLY: the bridge carries the FULL persona brief
 * (lens, traits, personal slang, register dial) and drafts IN that voice;
 * the seeded persona writer is the lawful floor. THE PROBE SHIELD RUNS
 * FIRST: an investigating comment never reaches the LLM (fail-closed). */
async function draftReplyViaBridge({ account, postTitle, postExcerpt, commentAuthor, commentBody, myPrior }) {
  if (isProbeComment(commentBody)) {
    return synthesizeReply({ postTitle, commentBody, myPrior, seed: `${postTitle}|${commentBody?.slice(0, 60) ?? ""}` });
  }
  const brief = personaBrief(account);
  if (process.env.SAOS_OFFLINE !== "1" && brief && bridgeOpen()) try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, commentAuthor, commentBody, myPrior, personaBrief: brief }),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.reply?.body) { noteBridgeSuccess(); return j.reply.body; }
    }
    noteBridgeFailure(`reply:${r.status}`);
  } catch (e) { noteBridgeFailure(`reply:${String(e?.message ?? e).slice(0, 40)}`); }
  return synthesizePersonaReply({ account, postTitle, commentBody, myPrior, seed: `${account}|${postTitle}|${commentBody?.slice(0, 60) ?? ""}` });
}

/* R244 · bridge-or-pack: the bridge is FIRST when reachable (LLM-grade), the
 * offline intelligence pack is the FLOOR (anchored, topic-aware, laws-safe).
 * R263: the floor speaks in the account's PERSONA voice, and the bridge gets
 * the full persona brief — the conversation never again depends on one
 * machine being up, and no voice is ever interchangeable. */
async function draftCommentViaBridge({ postTitle, postExcerpt, author, account }) {
  const brief = personaBrief(account);
  if (process.env.SAOS_OFFLINE !== "1" && brief && bridgeOpen()) try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, author, personaBrief: brief }),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.comment?.body) { noteBridgeSuccess(); return j.comment.body; }
    }
    noteBridgeFailure(`comment:${r.status}`);
  } catch (e) { noteBridgeFailure(`comment:${String(e?.message ?? e).slice(0, 40)}`); }
  return synthesizePersonaComment({ account, postTitle, postExcerpt, seed: `${account}|${postTitle}|${postExcerpt.slice(0, 60)}` });
}

/* R244 · THE PAIR-GUARD (chain truth, race-proof): state memory dedupes
 * replies, but two cycles landing close together could both reach the same
 * parent. Before any conversational broadcast: check the PARENT's live
 * replies — if our voice is already under it, walk away. */
async function alreadyAnswered(account, parentAuthor, parentPermlink) {
  try {
    const r = await rpcCall("condenser_api.get_content_replies", [parentAuthor, parentPermlink]);
    if (!r.ok) return false;
    return (r.result ?? []).some((c) => c.author === account);
  } catch { return false; }
}

/* ── R274 · THE CLONE GUARD (chain truth, sandbox-proof) ──────────────────
 * OPERATOR ORDER (verbatim intent): "כל התגובות מהמשתמשים לפוסטים הן אותה
 * תגובה... בכנות תמשיך ודחוף". The chain audit proved it: identical bodies
 * shipped from different accounts at identical seconds (Oct 6 burst), and
 * the same account shipped the same core twice 20 minutes apart (Oct 8,
 * headcorner/saos-transparency) with only the persona motto swapped.
 *
 * ROOT CAUSE, measured: (1) the seeded fallback minted the same core for
 * every account because the seed carried no account (fixed in intel-pack,
 * the VOICE SALT); (2) the freshness memory lived ONLY in state files that
 * a sandbox restore rewinds to yesterday — the operator's standing demand
 * is sovereignty INDEPENDENT of the sandbox, so the dedup memory must live
 * in the only store that always survives: THE CHAIN ITSELF.
 *
 * THE LAW: before any conversational broadcast, read the parent's LIVE
 * replies once; refuse when any body already under that parent (any author,
 * fleet or not) is a near-copy of the draft. This closes the clone classes
 * state could never close: a wiped state file, a second engine process, or
 * two accounts racing the same thread in one tick. */

/* the fleet-wide said-ledger: intents land here BEFORE the broadcast (the
 * same-tick race class — the chain may not have indexed the first reply
 * when the second account drafts) and receipts after. Day-keyed, tiny,
 * committed with the state by CI — the in-memory layer that chain reads
 * cannot see milliseconds into. */
const SAID_FILE = path.join(STATE, "social-said.json");
/* R275 merge law: the ledger path is resolved PER CALL — SAOS_STATE_DIR can
 * redirect the selftest to an isolated dir even though the module-level
 * consts froze at import time. Engine: env unset → byte-identical behavior. */
const saidFile = () => path.join(process.env.SAOS_STATE_DIR || STATE, "social-said.json");
/* day-scoped: { days: { [day]: [{account, body, at}] } } — only the last two
 * days are kept. Day-scoping makes the ledger safe to probe from selftests
 * under a fake key without ever touching the live day. */
export function fleetSaidFor(day) {
  const doc = readJson(saidFile(), { days: {} });
  return (doc.days?.[day] ?? []).map((e) => String(e.body ?? ""));
}
/* R276: self-cleaning probe — a selftest (or tooling) purges its own day key
 * before/after probing. Measured incident 2026-10-08: the 1970-01-01 probe day
 * survived CI state-pushback (keep-last-2 never evicts it when no newer fake
 * day exists), re-poisoning every later clone: "foreign day reads empty" failed
 * forever. The purge is the law: a probe day is ALWAYS wiped before and after. */
export function clearFleetSaid(day) {
  const doc = readJson(saidFile(), { days: {} });
  const days = { ...(doc.days ?? {}) };
  if (!(day in days)) return 0;
  const removed = days[day].length;
  delete days[day];
  writeJson(saidFile(), { days });
  return removed;
}

export function noteFleetSaid(day, account, body) {
  const doc = readJson(saidFile(), { days: {} });
  const days = { ...(doc.days ?? {}) };
  const list = days[day] ?? [];
  list.push({ account, body: String(body ?? "").slice(0, 300), at: new Date().toISOString() });
  days[day] = list.slice(-120); // bounded: the day's conversation, not history
  const keep = Object.keys(days).sort().slice(-2); // yesterday + today, nothing else
  const pruned = {};
  for (const k of keep) pruned[k] = days[k];
  writeJson(saidFile(), { days: pruned });
}

/* pure: normalized body for clash comparison (links, images, markup and
 * punctuation noise stripped — the chain shows markdown, the law compares
 * meaning-shaped text) */
export function normalizeBodyForClash(b) {
  return String(b ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_>~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

/* one chain read, two verdicts: is OUR voice already under this parent
 * (the old pair-guard), and does ANY existing reply already say this
 * (the clone veto). maxSimilarity = the same 0.34 Jaccard law as replyFresh. */
export async function parentClash(account, parentAuthor, parentPermlink, body, { maxSimilarity = 0.34 } = {}) {
  let replies = [];
  try {
    const r = await rpcCall("condenser_api.get_content_replies", [parentAuthor, parentPermlink]);
    if (r.ok) replies = r.result ?? [];
  } catch { /* unreachable chain → fail OPEN here; the broadcast gates still hold */ }
  const out = { own: false, clash: false, who: null, sim: 0 };
  for (const c of replies) {
    if (account && c.author === account) out.own = true;
    const sim = textSimilarity(normalizeBodyForClash(body), normalizeBodyForClash(c.body));
    if (sim >= maxSimilarity && sim >= out.sim) { out.clash = true; out.who = c.author; out.sim = Math.round(sim * 100) / 100; }
  }
  return out;
}

/* R243 SPAMGATE · the author's own recent chain bodies (the repetition law
 * spaminator hunts). Chain-truth only; on read failure the check degrades to
 * an empty history — every OTHER gate check still applies (fail-soft here,
 * fail-closed in the gate itself). GRAFTED from the parallel-agent round:
 * the merge union of R244-main and the saos-ci round. */
async function ownRecentBodies(account) {
  try {
    const r = await rpcCall("condenser_api.get_discussions_by_author_before_date", [account, "", "", 10]);
    return (r?.ok && Array.isArray(r.result)) ? r.result.map((x) => String(x.body ?? "").slice(0, 4000)) : [];
  } catch { return []; }
}

/* R243 SPAMGATE · tightened minimums from the organic-verdict loop */
function gateGlobals() {
  const tw = spamwatchState()?.tightened;
  return tw?.minPostChars ? { ...GATE_DEFAULTS, minPostChars: Number(tw.minPostChars) } : GATE_DEFAULTS;
}

function journalRefusal(now, account, kind, verdict) {
  appendLine(path.join(STATE, "events.jsonl"), { type: "spamgate.refused", at: now, account, kind, reasons: (verdict.reasons ?? []).slice(0, 6) });
}

/* R243 ORGANIC-WATCH · the network's own verdict on our last posts: outside
 * votes vs fleet echo, flags, replies — chain truth, verdict-only. This is
 * the learning loop: zero organic reach = the network calling us spam = the
 * gate tightens and the rail pauses before deeper damage.
 * R244-MERGE FIX: the grafted source shipped `new Set(aster, ...])` — a
 * syntax error that would kill the whole module on import. Fixed here. */
export async function runOrganicWatch({ now = new Date().toISOString(), window = 5 } = {}) {
  const master = masterAccount();
  const c = readJson(CONTENT_FILE, null);
  const published = (Array.isArray(c?.queue) ? c.queue : [])
    .filter((d) => d.status === "published" && d.permlink)
    .slice(0, window);
  const rows = [];
  for (const d of published) {
    try {
      const [author, permlink] = String(d.permlink).split("/");
      const r = await rpcCall("condenser_api.get_content", [author, permlink]);
      if (!r?.ok || !r.result) continue;
      const votes = Array.isArray(r.result.active_votes) ? r.result.active_votes : [];
      const rosterSet = new Set([master, ...ARMY_ROSTER]);
      let fleet = 0, outside = 0, flags = 0;
      for (const v of votes) {
        if (Number(v.weight) < 0) flags++;
        else if (rosterSet.has(v.voter)) fleet++;
        else outside++;
      }
      rows.push({ author, permlink, at: d.publishedAt ?? null, fleet, outside, flags, replies: Number(r.result.children ?? 0), pendingSbd: r.result.pending_payout_value ?? null, bodyLen: String(r.result.body ?? "").length, tags: (() => { try { return JSON.parse(r.result.json_metadata ?? "{}").tags ?? []; } catch { return []; } })() });
    } catch { /* fail-soft per row */ }
  }
  const organic = organicVerdict(rows);
  /* R254 · THE DOWNVOTE VETO (operator law): any flag → the AUTHOR's rail
   * pauses (persisted across days in flag-pauses.json — resumption is a
   * deliberate, analysis-first decision, never a silent auto-resume). */
  const pauses = readJson(FLAG_PAUSES_FILE, { accounts: {} });
  let newPauses = 0;
  for (const row of rows) {
    const v = flagPauseVerdict(row);
    if (!v.pause) continue;
    const cur = pauses.accounts[row.author] ?? null;
    if (!cur?.active) newPauses++;
    pauses.accounts[row.author] = { active: true, since: cur?.since ?? now, updatedAt: now, reasons: v.reasons, post: { permlink: row.permlink, flags: row.flags, outside: row.outside } };
    appendLine(path.join(STATE, "events.jsonl"), { type: "downvote.pause", at: now, account: row.author, permlink: row.permlink, flags: row.flags, evidence: v.reasons });
  }
  if (newPauses > 0 || Object.keys(pauses.accounts ?? {}).length) writeJson(FLAG_PAUSES_FILE, { at: now, accounts: pauses.accounts ?? {} });
  const prev = spamwatchState() ?? {};
  const doc = { at: now, posts: rows, organic, pauses: Object.fromEntries(Object.entries(pauses.accounts ?? {}).filter(([, v]) => v.active).map(([k, v]) => [k, { since: v.since, flags: v.post?.flags }])), tightened: organic.tighten ? (prev.tightened && prev.tightened.since ? { minPostChars: organic.minPostChars ?? 1600, since: prev.tightened.since } : { minPostChars: organic.minPostChars ?? 1600, since: now }) : null };
  saveSpamwatch(doc);
  appendLine(path.join(STATE, "events.jsonl"), { type: "organic.verdict", at: now, verdict: organic.verdict, tighten: !!organic.tighten, rows: rows.length, activePauses: Object.values(pauses.accounts ?? {}).filter((v) => v.active).length });
  return doc;
}

/* ── THE RAIL ─────────────────────────────────────────────────────────────── */
export async function runSocial({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  /* exec29/29-b · THE SOCIAL-STANDBY LAW — the execution choke-point of the
   * rail, placed BEFORE anything else in this function: while the gate is
   * CLOSED, NOTHING below ever runs — zero custody revival, zero WIF/key
   * decryption, zero steem.broadcast, zero network RPC broadcasts. Owner
   * directive 2026-10-14 (verbatim intent): stay low-profile — it is OK to be
   * invisible; zero flooding; nobody should see our actions until we are
   * truly ready to operate as a strong engineering body. Fail-closed:
   * the default readiness.json says STANDBY, and ARMED additionally demands
   * the live dual-key cross-check against the Autonomy DIRECTIVES file —
   * re-evaluated EVERY run, never cached, never sticky. Read-only
   * observation (runOrganicWatch) stays lawful during standby. Paths resolve
   * PER CALL (the R275 merge-law pattern — SAOS_STATE_DIR is honored even
   * though it is set after this module's top-level ran). */
  const gateState = process.env.SAOS_STATE_DIR || STATE;
  const gate = await socialGateVerdict(gateState);
  if (gate.mode !== "ARMED") {
    const roster = [masterAccount(), ...ARMY_ROSTER];
    const accounts = {};
    for (const lane of roster) accounts[lane] = STANDBY_RECEIPT(lane);
    /* R310: seeds:{} rides in the STANDBY receipt too — the receipt must never
     * poison a same-day ARMED takeover (carried-boundary migration is the
     * backstop; this keeps the written shape honest in the first place). */
    const doc = { at: now, day: dayKeyOf(now), roster, verdict: "SOCIAL-STANDBY", gate, accounts, seeds: {}, executed: 0, refused: 0, due: 0, ms: Date.now() - t0 };
    writeJson(path.join(gateState, "social.json"), doc);
    appendLine(path.join(gateState, "events.jsonl"), { type: "social.standby", at: now, mode: gate.mode, reason: gate.reason, lanes: roster.length, actions: 0 });
    await refreshLaws(gateState).catch(() => {}); /* exec29/29-a2: additive measured-laws refresh of readiness.json — never blocks the standby path, never touches the gate value */
    return { verdict: "SOCIAL-STANDBY", executed: 0, refused: 0, due: 0, gate };
  }
  const p = socialPolicy();
  const master = masterAccount();
  const day = dayKeyOf(now);
  const nowMs = Date.parse(now);
  const minuteOfDay = nowMs ? new Date(nowMs).getUTCHours() * 60 + new Date(nowMs).getUTCMinutes() : 0;

  /* T-86 · SELF-HEALING CUSTODY: idempotent git-vault revival runs first —
   * post-reset (empty memory + missing cache) it re-pulls + re-adopts;
   * healthy boots short-circuit on ALREADY-VERIFIED. Never blocks the rail
   * on failure (verdict journaled, accounts stay honestly REFUSED). */
  let custody = null;
  try { custody = await reviveArmyCustody({ now }); } catch { custody = { verdict: "REVIVAL-ERROR" }; }

  const prev = readJson(SOCIAL_FILE, null);
  /* R310 · STATE-SHAPE MIGRATION at the carried boundary — measured 2026-10-20
   * 04:33Z: the STANDBY receipt (exec29 path above) writes social.json WITHOUT
   * a seeds field; when the gate later flips ARMED on the SAME day, carried=prev
   * arrives seeds-less and the publishing loop crashes on carried.seeds[account]
   * — every STANDBY→ARMED transition poisoned the rail for the rest of the day.
   * Fix: migrate ANY legacy/foreign shape here (accounts+seeds guaranteed), so
   * gate oscillation can never crash the armed rail again. */
  const carried = prev?.day === day
    ? { ...prev, accounts: (prev.accounts && typeof prev.accounts === "object") ? prev.accounts : {}, seeds: (prev.seeds && typeof prev.seeds === "object") ? prev.seeds : {} }
    : { day, accounts: {}, seeds: {} };
  /* R254 · flag pauses ride into each account's state (doPublish checks) */
  const flagPauses = readJson(FLAG_PAUSES_FILE, { accounts: {} })?.accounts ?? {};

  const base = {
    enabled: p.enabled, at: now, day,
    roster: [master, ...ARMY_ROSTER],
    law: "קודם-החזקה (T-80): חשבון-בלי-חתימה-מאומתת לעולם לא נחתם; רנדומליות זרועית = בדיקה-חוזרת; תוכן רק מהתור-המטוהר; תקרות-יום קשוחות; שיחה-הדדית בין-החשבונות בתקרות-חוק ובלי-עדר (T-87)",
  };
  if (!p.enabled) return { ...base, verdict: "DISABLED" };

  const accounts = {};
  let executed = 0, refused = 0, dueCount = 0;

  /* RC day-guard — never burn a doomed broadcast on a drained account */
  const rcOk = async (account, st) => {
    const today = day;
    if (st.rc?.day === today) return st.rc.rcPct >= 15;
    const acc = await accountState(account).catch(() => ({ ok: false }));
    st.rc = { day: today, rcPct: acc.ok ? (acc.rcPct ?? 100) : 100 };
    return st.rc.rcPct >= 15;
  };

  /* R254 · FLEET SLOTS: one collision-free prime-time publish minute per
   * account, computed once per run, deterministic per day (auditable). */
  const fleetMinutes = fleetPublishMinutes(day, [master, ...ARMY_ROSTER], { window: p.fleetSlotWindow ?? [11, 21] });

  /* R301 · STEALTH ROTATION: today's fleet-wide publisher subset (seeded,
   * auditable). Parked accounts keep conversation lanes — presence, not flood. */
  const stealthCap = p.stealth ? (Number.isFinite(p.maxFleetPostsPerDay) ? p.maxFleetPostsPerDay : Infinity) : Infinity;
  const publishers = new Set(stealthPublishers(day, [master, ...ARMY_ROSTER], stealthCap));

  for (const account of [master, ...ARMY_ROSTER]) {
    const st = carried.accounts[account] ?? {
      done: { publish: 0, "fleet-vote": 0, "fleet-comment": 0, reply: 0, "community-comment": 0, deepen: 0 },
      voted: [], commented: [], replied: [], published: [], said: [], deepened: [], community: [],
      verdict: "INIT",
    };
    /* R244 · CI-SOVEREIGN MODE: the master credential NEVER leaves the local
     * machine (no password in any CI secret, ever). In CI mode the master's
     * social lanes honestly park — the soldiers carry the conversation from
     * git-vault WIFs. Trading and custody stay machine-local by law. */
    if (account === master && process.env.SAOS_CI_SKIP_MASTER === "1") {
      accounts[account] = { ...st, verdict: "CI-MASTER-PARKED", custody: custodyOf(account), note: "master signing is machine-local by law; soldiers converse from CI" };
      continue;
    }
    /* T-87: old-day carried state may lack the newer kinds — zero-default them
     * or the due-filter (`undefined < cap`) would park the lane forever */
    st.done = { publish: 0, "fleet-vote": 0, "fleet-comment": 0, reply: 0, "community-comment": 0, deepen: 0, ...(st.done ?? {}) };
    /* R243: said-today memory — every shipped text lands here so the repeat
     * gate can veto near-duplicates (the woq/lsa echo bug). Day-scoped. */
    if (st.saidDay !== day) { st.said = []; st.saidDay = day; }
    const custody = custodyOf(account);
    if (custody !== "master-verified" && custody !== "verified") {
      refused++;
      accounts[account] = { ...st, verdict: "REFUSED-NO-CUSTODY", custody, note: "no chain-verified credential — the git-vault revival (state/army-custody.json) is the lawful path; nothing is ever fabricated" };
      continue;
    }

    /* R254 · the flag pause rides into the account state (doPublish checks) */
    st.paused = flagPauses[account]?.active ? flagPauses[account] : null;

    /* the day's schedule — seeded per day+account, rebuilt cheaply every run */
    const seed = hashSeed(`${day}|${account}|social-v1`);
    carried.seeds[account] = seed;
    const pubMin = fleetMinutes[account];
    const schedule = buildDaySchedule(seed, { publishWindow: p.publishWindow, publishMinute: Number.isFinite(pubMin) ? pubMin : null });
    /* R301: publish slots fire only for today's rotation subset */
    const publishAllowed = publishers.has(account);
    const due = schedule.filter((s) => minuteOfDay >= s.minute && st.done[s.kind] < capOf(s.kind, p) && (s.kind !== "publish" || publishAllowed));
    dueCount += due.length;

    /* R244 · THE PACING LAW: a human does not leave three comments in one
     * minute. One conversation action per account per cycle — the remaining
     * due slots fire on later cycles (the schedule is minute-scattered by
     * design; bursts were the last robotic fingerprint on the timeline). */
    let conversationActs = 0;
    const isConversation = (k) => k === "fleet-comment" || k === "reply" || k === "community-comment" || k === "deepen";

    for (const slot of due) {
      /* R244: per-action fail isolation — one dead lane never kills the
       * rail (the readJson crash proved the blast radius of an uncaught
       * throw inside this loop). Errors are typed into the account state. */
      try {
        if (slot.kind === "publish") {
          if (!(await rcOk(account, st))) continue;
          const ok = await doPublish(account, st, p, now, day);
          if (ok) { st.done.publish++; executed++; }
        } else if (slot.kind === "fleet-vote") {
          if (!(await rcOk(account, st))) continue;
          const ok = await doFleetVote({ account, master, st, p, nowMs, now });
          if (ok) { st.done["fleet-vote"]++; executed++; }
        } else if (isConversation(slot.kind)) {
          if (conversationActs >= 1) break; // pacing law
          if (!(await rcOk(account, st))) continue;
          let ok = false;
          if (slot.kind === "fleet-comment") ok = await doFleetComment({ account, master, st, p, nowMs, now });
          else if (slot.kind === "reply") ok = await doReply({ account, st, p, now });
          else if (slot.kind === "community-comment") ok = await doCommunityComment({ account, master, st, p, nowMs, now });
          else ok = await doDeepen({ account, master, st, p, now });
          if (ok) { st.done[slot.kind]++; executed++; conversationActs++; }
        }
      } catch (e) {
        st.lastError = { at: now, kind: slot.kind, msg: String(e?.message ?? e).slice(0, 160) };
      }
    }
    accounts[account] = { ...st, verdict: "SOCIAL-LIVE", custody, schedule, seeds: seed, stealthPublish: publishAllowed ? "due" : "rotation-park" };
  }

  /* R310: the armed receipt must carry the LIVE dual-key verdict — the shape
   * contract (social-gate-consistent monitor) reads gate.mode from this doc;
   * reaching this line MEANS the exec29 stack passed (local ARMED + directiveRef
   * + armedAt + fresh cross-key agreement), so the receipt states it honestly. */
  const doc = { ...base, stealth: p.stealth === true, publishers: [...publishers], gate: { mode: "ARMED", verdict: "dual-key live verdict passed (exec29 a-d)", at: now }, custodyVerdict: custody?.verdict ?? null, custodyVerified: custody?.after?.verified ?? null, accounts, seeds: carried.seeds, executed, refused, due: dueCount, ms: Date.now() - t0 };
  writeJson(SOCIAL_FILE, doc);
  appendLine(path.join(STATE, "events.jsonl"), { type: "social.run", at: now, day, executed, refused });
  return { verdict: executed > 0 ? "SOCIAL-EXECUTED" : refused ? "PART-GATED" : "SOCIAL-IDLE", executed, refused, due: dueCount };
}

/* R243: cap map — every lane has a hard daily ceiling, nothing else */
const capOf = (kind, p) =>
  kind === "publish" ? p.maxPostsPerDay
  : kind === "fleet-vote" ? p.maxFleetVotesPerDay
  : kind === "fleet-comment" ? p.maxFleetCommentsPerDay
  : kind === "community-comment" ? p.maxCommunityCommentsPerDay
  : kind === "deepen" ? p.maxConversationDeepensPerDay
  : p.maxRepliesPerDay;

/* publish one sanitized draft (content-ops queue) — never invented here.
 * R243: OLD-STOCK VETO — drafts drafted before PUBLISH_ELIGIBLE_SINCE are
 * retired, never broadcast (the queue was choked by pre-R240 SEO stock; the
 * chain showed a 2026-10-01 draft shipping on 10-07). */
async function doPublish(account, st, p, now, day) {
  /* R254 · THE DOWNVOTE VETO at the door: a flagged author does not speak
   * again until the operator-level analysis clears the resumption (the
   * pause is set by runOrganicWatch the moment a downvote lands). */
  if (st.paused?.active) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.flagged-paused", at: now, account, reason: st.paused.reasons?.[0] ?? "downvote" });
    return false;
  }
  if (st.done.publish >= p.maxPostsPerDay) return false;
  const c = readJson(CONTENT_FILE, null);
  const queue = Array.isArray(c?.queue) ? c.queue : [];
  /* retire pre-R240 stock once, in the shared queue */
  let retired = 0;
  for (const d of queue) {
    if (d?.status === "drafted" && (d.draftedAt ?? "") < PUBLISH_ELIGIBLE_SINCE) { d.status = "retired-old-stock"; d.retiredAt = now; retired++; }
  }
  const draft = (() => {
    /* R255 · THE PERSONA MATCH: an account prefers drafts written BY its own
     * persona (content.mjs tags them); the first eligible untagged draft is
     * adopted and ASSIGNED this persona, so the voice stays one-to-one and
     * the arc state stays truthful. FIFO otherwise — pacing laws untouched. */
    const eligible = queue.filter((d) => d.status === "drafted" && !st.published?.includes(d.id));
    const own = eligible.find((d) => d.persona === account);
    if (own) return own;
    const adopt = eligible.find((d) => !personaOf(d.persona));
    if (adopt) { adopt.persona = account; adopt.adoptedAt = now; }
    return adopt;
  })();
  if (!draft) { if (retired) writeJson(CONTENT_FILE, c); return false; }
  /* R244 · THE SPAM-SAFETY FLOOR AT THE GATE: drafts drafted before the
   * 300-word law (e.g. the 15:38 bridge batch) are retired here, not
   * broadcast — the floor holds at the LAST line of defense, not just at
   * draft time. */
  if (wordCount(draft.body) < MIN_POST_WORDS) {
    draft.status = "retired-thin";
    draft.retiredAt = now;
    draft.retireReason = `words ${wordCount(draft.body)} < floor ${MIN_POST_WORDS}`;
    writeJson(CONTENT_FILE, c);
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.thin-veto", at: now, account, title: String(draft.title).slice(0, 80), words: wordCount(draft.body) });
    return false;
  }
  /* R244 · THE MONOCULTURE VETO: the chain showed three accounts shipping
   * near-identical "Streamlining ..." titles on one day (spaminator bait).
   * A draft whose title is too close to ANY already-published title in the
   * shared queue is retired, never broadcast — diversity is a publish gate,
   * not a drafting hope. */
  const published = recentPublishedTitles(queue, 20);
  const clash = published.find((t) => titleSimilarity(t, draft.title) >= 0.5);
  if (clash) {
    draft.status = "vetoed-monoculture";
    draft.vetoedAt = now;
    draft.vetoReason = `title too close to published: ${String(clash).slice(0, 60)}`;
    writeJson(CONTENT_FILE, c);
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.monoculture-veto", at: now, account, title: String(draft.title).slice(0, 80), against: String(clash).slice(0, 80) });
    return false;
  }
  /* R277 · THE FLEET BODY-CLASH VETO (measured incident 2026-10-08): the same
   * root body shipped from two accounts ~19h apart (headcorner 13:50Z today
   * vs hcsoldier4 19:41Z yesterday; haran/lsa pair) — the monoculture veto
   * compares TITLES only and the said-ledger covered replies, not posts.
   * A root post whose body core is near-identical to ANYTHING the fleet said
   * or published in the ledger's two-day window is retired, never broadcast. */
  {
    const prevDay = dayKeyOf(new Date(Date.parse(now) - 86400000).toISOString());
    const fleetVoices = [...fleetSaidFor(day), ...fleetSaidFor(prevDay)];
    if (!replyFresh(draft.body, fleetVoices, { maxSimilarity: 0.5 })) {
      draft.status = "vetoed-fleet-body-clash";
      draft.vetoedAt = now;
      draft.vetoReason = "body core near-identical to a fleet voice in the last 48h (R277)";
      writeJson(CONTENT_FILE, c);
      appendLine(path.join(STATE, "events.jsonl"), { type: "social.fleet-body-clash-veto", at: now, account, title: String(draft.title).slice(0, 80) });
      return false;
    }
  }
  /* R297 · THE CHAIN-TRUTH UNIQUENESS VETO (the shelling incident, measured
   * 2026-10-14: 75 exact duplicate bodies cross-account in 8 days + 47
   * duplicate-title groups = the exact bot-farm signature that got the WHOLE
   * roster shelled on steemit.com). The local windows (R277 48h, queue titles
   * 20 rows) let "Seven Floors" ship twice 51h apart. The chain forgets
   * nothing: the draft is vetoed against a chain-truth ledger of the roster's
   * last 60 root posts each — exact body, near-body (Jaccard ≥ 0.5), and
   * normalized-title, 45-day window, any account including SELF. Fail-closed:
   * an unavailable ledger refuses the publish (a missing post is cheaper
   * than a roster-wide shell). */
  {
    let verdict297 = null;
    try {
      const ledger = await loadFleetLedger([master, ...ARMY_ROSTER], { stateDir: STATE, now });
      verdict297 = fleetUniqueness(ledger, { account, title: draft.title, body: draft.body });
    } catch (e) {
      appendLine(path.join(STATE, "events.jsonl"), { type: "social.chain-uniqueness-ledger-error", at: now, account, error: String(e?.message ?? e).slice(0, 120) });
      verdict297 = { ok: false, reasons: ["ledger-unavailable-fail-closed"], against: [] };
    }
    if (!verdict297.ok) {
      draft.status = "vetoed-chain-uniqueness";
      draft.vetoedAt = now;
      draft.vetoReason = verdict297.reasons.slice(0, 3).join("; ").slice(0, 300);
      writeJson(CONTENT_FILE, c);
      appendLine(path.join(STATE, "events.jsonl"), { type: "social.chain-uniqueness-veto", at: now, account, title: String(draft.title).slice(0, 80), reasons: verdict297.reasons.slice(0, 3), against: verdict297.against });
      return false;
    }
  }
  /* R243 SPAMGATE (grafted, union merge): nothing publishes without clearing
   * the measured spam law (thin-body / bait-phrases / link-stuffing /
   * self-repetition / ungrounded / cross-chain — the @spaminator profile). */
  const gate = spamVerdict(draft, { isComment: false, chain: "steem", ownRecentBodies: await ownRecentBodies(account), postsToday: st.done.publish ?? 0, dayCap: p.maxPostsPerDay, g: gateGlobals() });
  if (!gate.ok) {
    draft.status = "refused-spam";
    draft.spamgate = { at: now, reasons: gate.reasons.slice(0, 6) };
    writeJson(CONTENT_FILE, c);
    journalRefusal(now, account, `publish:${draft.id}`, gate);
    return false;
  }
  /* R302 · THE CONTENT JUDGE (T-83, owner order 2026-10-14: "תתחיל הכי טוב
   * שאפשר בצע"): the learning layer composed ON TOP of the existing gates —
   * slop lexicon (the machine-slop fingerprint of the shelling incident),
   * persona voice collisions (content-dna.json), and the R303 Git-as-Memory
   * penalty (a pattern the fleet already refused — exact title or ≥0.5
   * Jaccard body within 90d — refuses again). Quality runs OBSERVE-ONLY
   * (the policy-engine pattern: enforcement waits for measured evidence).
   * Judge crash = fail-open with an honest event — the hard gates spamgate
   * + R297 still hold; the judge never OPENS a gate the laws closed, and
   * never wedges the organ on its own bug. */
  let judgeObserve = null;
  try {
    const mem = await loadMemory(STATE);
    const jv = judgeVerdict(draft, { memory: mem, persona: personaOf(draft.persona) ?? personaOf(account) ?? null, dna: loadDNA() });
    judgeObserve = jv.observe ?? null;
    if (!jv.ok) {
      draft.status = "refused-judge";
      draft.judge = { at: now, reasons: jv.reasons.slice(0, 6), quality: jv.observe?.score ?? null };
      writeJson(CONTENT_FILE, c);
      try { recordRejected(STATE, { account, title: draft.title, body: draft.body, reason: jv.reasons.slice(0, 3).join("; "), vetoType: "judge", at: now }); } catch { /* memory is additive */ }
      appendLine(path.join(STATE, "events.jsonl"), { type: "social.judge-veto", at: now, account, title: String(draft.title).slice(0, 80), reasons: jv.reasons.slice(0, 4) });
      return false;
    }
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.judge-observe", at: now, account, title: String(draft.title).slice(0, 80), score: jv.observe?.score ?? null, mode: jv.observe?.mode ?? "observe" });
  } catch (e) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.judge-error", at: now, account, error: String(e?.message ?? e).slice(0, 120) });
  }
  const permlink = permlinkStem(draft.title, day, st.done.publish ?? 0);
  /* R246 COMMUNITY-RAIL, R254 CENTRALIZATION (operator order, verbatim
   * intent): "ולהתחיל להפעיל אותה שיזרמו לשם נעשה את זה מרוכז שיהיה לנו מקום
   * פעילות" — the flow now CENTERS on our community: every SECOND lifetime
   * post of each account lands INSIDE hive-457262 (metadata.community +
   * tags[0] = community, the hivemind contract), the rest stays in the open
   * tags. The R246 1:2 was measured good; the operator wants home base to
   * be the primary place of activity now that the organ exists. */
  const cst = readCommunityState();
  const communityArmed = cst?.name && ["fleet-joined", "live"].includes(cst.phase);
  /* R254 · THE COMMUNITY ROUND (operator order, verbatim: "תן הוראה
   * לסיבוב אחד של כולם גם כקהילה עם פוסטים והכל כמו שצריך"): a one-shot
   * armed order — EVERY account's next publish lands HOME (hive-457262)
   * until all subscribers have posted the round or 36h pass. Journaled. */
  const round = readJson(COMMUNITY_ROUND_FILE, null);
  const roundArmed = round?.armed === true
    && communityArmed
    && String(now) < String(round.expiresAt ?? "")
    && !(round.posted ?? []).includes(account);
  const secondPost = (st.published?.length ?? 0) % 2 === 1;
  const inCommunity = communityArmed && (roundArmed || secondPost);
  const baseMeta = inCommunity
    ? communityMetaObj(cst.name, draft.tags)
    : { tags: draft.tags, app: "saos-social-rail" };
  /* R254 · IMAGES (operator: "שימוש בתמונות לפי חוק"): a legal Commons image
   * rides at the END of the body with its mandatory credit line, and is
   * declared in metadata.image (the frontend thumbnail contract). */
  let body = draft.body;
  const metaObj = { ...baseMeta };
  if (draft.image?.url && /^https:\/\/upload\.wikimedia\.org\//.test(draft.image.url)) {
    body = embedImage(body, draft.image);
    metaObj.image = [draft.image.url];
  }
  const meta = JSON.stringify(metaObj);
  /* R277 intent-before-broadcast: the publish body enters the fleet ledger
   * BEFORE the broadcast so a same-tick sibling's veto sees it (the same law
   * the conversational lanes obey), and so the 48h body-clash window holds
   * across runs, processes, and sandboxes. R297: the CHAIN-TRUTH ledger gets
   * the same note so the 45-day uniqueness veto sees it on every tick. */
  noteFleetSaid(day, account, body);
  const ops = [[
    "comment",
    { parent_author: "", parent_permlink: inCommunity ? cst.name : "steem", author: account, permlink, title: draft.title, body, json_metadata: meta },
  ]];
  const res = await executeAs(account, ops, { tag: "social-post", role: "posting" });
  if (!res.ok) return false;
  st.published = [...(st.published ?? []), draft.id];
  /* R297: the broadcast is now chain-truth — record it so every later tick
   * (this sandbox or any other) vetoes against the live post, not a memory. */
  try {
    const led = await loadFleetLedger([master, ...ARMY_ROSTER], { stateDir: STATE, now });
    saveFleetLedgerFile(STATE, noteFleetLedgerPublished(led, { account, permlink, title: draft.title, body, created: now }));
  } catch (e) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.chain-uniqueness-note-error", at: now, account, error: String(e?.message ?? e).slice(0, 120) });
  }
  /* R303 · GIT-AS-MEMORY: the broadcast becomes a learning pattern with its
   * quality observation (judgeObserve from R302; null when the judge
   * degraded). Best-effort — a memory failure never un-publishes chain
   * truth, and the weekly heartbeat step merges runtime → committed seed
   * so the learning survives every sandbox death (owner: "שלא יאבד בסנדבוקס
   * שלך בשום פנים ואופן"). */
  try {
    recordPublished(STATE, { account, permlink, title: draft.title, body, score: judgeObserve?.score ?? null, chain: "steem", at: now });
  } catch (e) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.memory-record-error", at: now, account, error: String(e?.message ?? e).slice(0, 120) });
  }
  /* R255 · THE ARC ADVANCES ON MEASURED TRUTH: lifetime posts live in the
   * chain (this publish just added one); the stage pointer is recomputed
   * from that count, so a persona's development is provable, never claimed. */
  const arc = arcStageOf(account, (st.published ?? []).length);
  if (arc) {
    st.persona = { ...(st.persona ?? {}), stage: arc.index, stageTitle: arc.title, nextAt: arc.nextAt, updatedAt: now };
    const pdoc = readJson(PERSONAS_FILE, { perAccount: {} });
    pdoc.arcs = { ...(pdoc.arcs ?? {}), [account]: { stage: arc.index, title: arc.title, nextAt: arc.nextAt, lifetimePosts: arc.lifetimePosts, at: now } };
    writeJson(PERSONAS_FILE, pdoc);
  }
  /* R254: the community round records the voice so the round completes */
  if (roundArmed && inCommunity) {
    const r2 = readJson(COMMUNITY_ROUND_FILE, null);
    if (r2?.armed) {
      r2.posted = [...(r2.posted ?? []), account];
      if ((r2.posted ?? []).length >= (r2.roster ?? []).length) r2.armed = false; // round complete
      writeJson(COMMUNITY_ROUND_FILE, r2);
    }
  }
  /* the draft is spent — mark it in the shared queue so no account double-posts it */
  draft.status = "published";
  draft.publishedAt = now;
  draft.publishedBy = account;
  /* R337 · the row records its front: hive marks "hive" at pickup; the steem
   * rail never did — null chain meant "steem by convention" in the R336 scan.
   * Now it is MEASURED, not inferred. Never overwrites an existing mark. */
  if (!draft.chain) draft.chain = "steem";
  draft.permlink = `${account}/${permlink}`;
  writeJson(CONTENT_FILE, c);
  return true;
}

/* vote for a fresh post by ANOTHER fleet account — the mutual-support law */
async function doFleetVote({ account, master, st, p, nowMs, now }) {
  if (st.done["fleet-vote"] >= p.maxFleetVotesPerDay) return false;
  const exclude = new Set((st.voted ?? []).map((v) => `${v.author}/${v.permlink}`));
  const candidates = (await fetchFleetPosts({
    viewer: account,
    accounts: [master, ...ARMY_ROSTER],
    nowMs, p, excludePermlinks: exclude,
  })).filter((c) => !c.myVote); /* R274 CLONE GUARD: chain-truth skip — a rewound state never re-votes (the chain refuses identical weight) */
  if (!candidates.length) return false;
  /* T-87 ANTI-HERD PICK: rank by roster votes already carried (chain-truth
   * active_votes), then by total votes — the least-supported fleet post gets
   * the next vote, so support spreads; seeded rotation inside the tier. */
  const minRoster = Math.min(...candidates.map((c) => c.rosterVotes ?? 0));
  /* R298 · THE RING CAP (the shelling incident): the measured signature was
   * 5-7 fleet votes on EVERY post (710/732 at one weight). The anti-herd
   * tier spreads support but never STOPS it — a post at the cap is untouchable
   * now: ≤ maxFleetVotesPerPost fleet votes per post, chain-truth counted. */
  if (minRoster >= (p.maxFleetVotesPerPost ?? 2)) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "social.fleet-vote-ring-cap", at: now, account, minRoster, cap: p.maxFleetVotesPerPost ?? 2 });
    return false;
  }
  const tier = candidates.filter((c) => (c.rosterVotes ?? 0) === minRoster)
    .sort((a, b) => (a.votes ?? 0) - (b.votes ?? 0) || b.createdMs - a.createdMs);
  const pick = tier[(hashSeed(`${now.slice(0, 10)}|${account}|vote`) + st.done["fleet-vote"]) % tier.length];
  /* R298 · WEIGHT JITTER: one fixed weight across 710 votes was the loudest
   * signature. The support weight now varies per vote, seeded + auditable:
   * fleetWeightPct ±(0..5) → 8-13% real support, never a uniform bar. */
  const weight = Math.round((p.fleetWeightPct + (hashSeed(`${now.slice(0, 13)}|${account}|vw|${st.done["fleet-vote"]}`) % 6)) * 100);
  const ops = [["vote", { voter: account, author: pick.author, permlink: pick.permlink, weight }]];
  const res = await executeAs(account, ops, { tag: "social-fleet-vote", role: "posting" });
  if (!res.ok) return false;
  st.voted = [...(st.voted ?? []), { author: pick.author, permlink: pick.permlink, weight, at: now }];
  return true;
}

/* T-87 · THE CONVERSATION LAW: comment on a fleet sibling's fresh post —
 * least-commented tier first (conversation spreads to lonely posts, never
 * herds on one), body via the bridge under the full exposure law. */
async function doFleetComment({ account, master, st, p, nowMs, now }) {
  if (st.done["fleet-comment"] >= p.maxFleetCommentsPerDay) return false;
  const exclude = new Set(st.commented ?? []);
  const candidates = await fetchFleetPosts({ viewer: account, accounts: [master, ...ARMY_ROSTER], nowMs, p, excludePermlinks: exclude });
  if (!candidates.length) return false;
  const minChildren = Math.min(...candidates.map((c) => c.children ?? 0));
  const tier = candidates.filter((c) => (c.children ?? 0) === minChildren);
  const pick = tier[(hashSeed(`${now.slice(0, 10)}|${account}|comment`) + st.done["fleet-comment"]) % tier.length];
  if (await alreadyAnswered(account, pick.author, pick.permlink)) return false; // pair-guard
  const raw = await draftCommentViaBridge({ postTitle: pick.title, postExcerpt: pick.excerpt, author: pick.author, account });
  const body = sanitizeReply(raw);
  if (!body) return false; /* bridge down / law violation → honest skip, no spam */
  /* R274 CLONE GUARD: the said-memory is [own state + fleet ledger + THE CHAIN].
   * A sandbox restore rewinds the first two; the chain remembers everything. */
  const day = dayKeyOf(now);
  if (!replyFresh(body, [...(st.said ?? []), ...fleetSaidFor(day)], { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const clash = await parentClash(account, pick.author, pick.permlink, body, { maxSimilarity: p.repeatSimilarityMax });
  if (clash.own) return false;
  if (clash.clash) { journalRefusal(now, account, `clone-veto:fleet-comment:${pick.author}/${pick.permlink}`, { ok: false, reasons: [`near-duplicate body (~${clash.sim}) already under the parent by ${clash.who}`] }); return false; }
  /* R243 SPAMGATE (grafted): the comment gate — measured depth + repetition +
   * bait-phrases, tight on comments where spaminator is the most suspicious */
  const cgate = spamVerdict({ body }, { isComment: true, chain: "steem", ownRecentBodies: await ownRecentBodies(account), g: gateGlobals() });
  if (!cgate.ok) { journalRefusal(now, account, `fleet-comment:${pick.author}/${pick.permlink}`, cgate); return false; }
  const permlink = `re-${pick.author}-${pick.permlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: pick.author, parent_permlink: pick.permlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  noteFleetSaid(day, account, body); // R274 intent-before-broadcast: the same-tick sibling sees this draft
  const res = await executeAs(account, ops, { tag: "social-fleet-comment", role: "posting" });
  if (!res.ok) return false;
  st.commented = [...(st.commented ?? []), `${pick.author}/${pick.permlink}`];
  st.said = [...(st.said ?? []), body.slice(0, 300)];
  return true;
}

/* reply to one real community comment on this account's own posts.
 * R243: repeat gate — a body near-identical to anything we said today is
 * refused BEFORE broadcast; the shipped text lands in st.said. */
async function doReply({ account, st, p, now }) {
  if (st.done.reply >= p.maxRepliesPerDay) return false;
  const target = await fetchRepliableComments(account, new Set(st.replied ?? []), p);
  if (!target) return false;
  if (await alreadyAnswered(account, target.parentAuthor, target.parentPermlink)) { st.replied = [...(st.replied ?? []), target.comment]; return false; } // pair-guard
  const raw = await draftReplyViaBridge({ ...target, account });
  const body = sanitizeReply(raw);
  if (!body) return false; /* bridge down / law violation → honest skip, no spam */
  /* R274 CLONE GUARD (same law as every conversational lane) */
  const day = dayKeyOf(now);
  if (!replyFresh(body, [...(st.said ?? []), ...fleetSaidFor(day)], { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const clash = await parentClash(account, target.parentAuthor, target.parentPermlink, body, { maxSimilarity: p.repeatSimilarityMax });
  if (clash.own) return false;
  if (clash.clash) { journalRefusal(now, account, `clone-veto:reply:${target.comment}`, { ok: false, reasons: [`near-duplicate body (~${clash.sim}) already under the parent by ${clash.who}`] }); return false; }
  /* R243 SPAMGATE (grafted): reply gate — same law as fleet comments */
  const rgate = spamVerdict({ body }, { isComment: true, chain: "steem", ownRecentBodies: await ownRecentBodies(account), g: gateGlobals() });
  if (!rgate.ok) { journalRefusal(now, account, `reply:${target.comment}`, rgate); return false; }
  const permlink = `re-${target.parentAuthor}-${target.parentPermlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: target.parentAuthor, parent_permlink: target.parentPermlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  noteFleetSaid(day, account, body); // R274 intent-before-broadcast
  const res = await executeAs(account, ops, { tag: "social-reply", role: "posting" });
  if (!res.ok) return false;
  st.replied = [...(st.replied ?? []), target.comment];
  st.said = [...(st.said ?? []), body.slice(0, 300)];
  return true;
}

/* ── R243 · THE INTELLIGENCE LANES ────────────────────────────────────────
 * pure pick: cold-post tier first (fewest children), seeded rotation —
 * we join quiet good threads, never stampede the winners. Selftest-able. */
export function pickColdPost(candidates, { excludeKeys = [], seedNum = 0, index = 0, maxChildren = 15 } = {}) {
  const legal = (candidates ?? []).filter(
    (c) => c?.key && !excludeKeys.includes(c.key) && (c.children ?? 0) <= maxChildren
  );
  if (!legal.length) return null;
  const minChildren = Math.min(...legal.map((c) => c.children ?? 0));
  const tier = legal.filter((c) => (c.children ?? 0) === minChildren);
  return tier[((seedNum + index) % tier.length + tier.length) % tier.length];
}

/* external community scan: one living tag at a time (seeded rotation),
 * non-fleet authors only, real posts only, bounded reads. */
async function fetchCommunityPost({ p, nowMs, seedNum, index, excludeKeys }) {
  const roster = new Set([masterAccount(), ...ARMY_ROSTER]);
  const blocked = new Set(p.communityBlockedAuthors ?? []);
  const tags = p.communityTags ?? ["life", "psychology", "food", "photography", "writing", "nature", "health", "travel"];
  for (let ti = 0; ti < 3; ti++) {
    const tag = tags[((seedNum + ti * 3) % tags.length + tags.length) % tags.length];
    try {
      const r = await rpcCall("condenser_api.get_discussions_by_hot", [{ tag, limit: 10 }]);
      if (!r.ok) continue;
      const candidates = (r.result ?? [])
        .filter((x) => x.author && !roster.has(x.author) && !blocked.has(x.author))
        .filter((x) => { const ageMin = (nowMs - Date.parse(x.created)) / 60000; return Number.isFinite(ageMin) && ageMin >= 30 && ageMin <= 72 * 60; })
        .filter((x) => String(x.body ?? "").length >= p.minCommunityPostChars)
        .map((x) => ({ key: `${x.author}/${x.permlink}`, author: x.author, permlink: x.permlink, title: String(x.title ?? ""), excerpt: String(x.body ?? "").slice(0, 400), children: x.children ?? 0 }));
      const pick = pickColdPost(candidates, { excludeKeys, seedNum, index });
      if (pick) return pick;
    } catch { /* one dead tag never kills the lane */ }
  }
  return null;
}

/* R243 · COMMUNITY LANE: one real comment/day/account on a NON-fleet post.
 * This is how the fleet stops talking to itself in public: join the actual
 * community, add actual substance, under the same exposure law + gates. */
async function doCommunityComment({ account, master, st, p, nowMs, now }) {
  if (st.done["community-comment"] >= p.maxCommunityCommentsPerDay) return false;
  const pick = await fetchCommunityPost({
    p, nowMs,
    seedNum: hashSeed(`${now.slice(0, 10)}|${account}|community`),
    index: st.done["community-comment"],
    excludeKeys: st.community ?? [],
  });
  if (!pick) return false;
  if (await alreadyAnswered(account, pick.author, pick.permlink)) return false; // pair-guard
  const raw = await draftCommentViaBridge({ postTitle: pick.title, postExcerpt: pick.excerpt, author: pick.author, account });
  const body = sanitizeReply(raw);
  if (!body) return false;
  /* R274 CLONE GUARD (same law as every conversational lane) */
  const day = dayKeyOf(now);
  if (!replyFresh(body, [...(st.said ?? []), ...fleetSaidFor(day)], { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const clash = await parentClash(account, pick.author, pick.permlink, body, { maxSimilarity: p.repeatSimilarityMax });
  if (clash.own) return false;
  if (clash.clash) { journalRefusal(now, account, `clone-veto:community-comment:${pick.author}/${pick.permlink}`, { ok: false, reasons: [`near-duplicate body (~${clash.sim}) already under the parent by ${clash.who}`] }); return false; }
  const permlink = `re-${pick.author}-${pick.permlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: pick.author, parent_permlink: pick.permlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  noteFleetSaid(day, account, body); // R274 intent-before-broadcast
  const res = await executeAs(account, ops, { tag: "social-community-comment", role: "posting" });
  if (!res.ok) return false;
  st.community = [...(st.community ?? []), pick.key];
  st.said = [...(st.said ?? []), body.slice(0, 300)];
  return true;
}

/* thread-deepening scan: find a REPLY someone left to a comment WE made,
 * so the conversation continues (the deepest human social move: answer
 * your answers). Bounded: ≤5 of our recent comments, skip our own voice.
 * R244 ROOT-CAUSE FIX: get_discussions_by_comments answers "Invalid
 * parameters" on justyy/steemit (measured) — the deepen lane was silently
 * dead on those nodes. account_history is the universal ground truth. */
async function fetchDeepenableThread(account, deepenedSet, p) {
  const hist = await rpcCall("condenser_api.get_account_history", [account, -1, 100]);
  if (!hist.ok) return null;
  const mine = [];
  for (const [, ev] of (hist.result ?? []).slice().reverse()) {
    const [type, op] = ev?.op ?? [];
    if (type === "comment" && op?.author === account && op?.parent_author && op.parent_author !== "") {
      mine.push({ permlink: op.permlink, body: op.body ?? "", parent_author: op.parent_author, parent_permlink: op.parent_permlink });
      if (mine.length >= 5) break;
    }
  }
  for (const m of mine) {
    try {
      /* replies whose parent IS our comment (account + our permlink) */
      const reps = await rpcCall("condenser_api.get_content_replies", [account, m.permlink]);
      for (const rep of (reps.ok ? reps.result : [])) {
        if (rep.author === account) continue; // never answer ourselves
        const key = `${rep.author}/${rep.permlink}`;
        if (deepenedSet.has(key)) continue;
        if (String(rep.body ?? "").trim().length < p.minCommentChars) continue;
        return {
          comment: key,
          parentAuthor: rep.author,
          parentPermlink: rep.permlink,
          rootTitle: "",
          myPrior: String(m.body ?? "").slice(0, 400),
          replyBody: String(rep.body ?? "").slice(0, 400),
        };
      }
    } catch { /* one dead read never kills the lane */ }
  }
  return null;
}

/* R243 · DEEPEN LANE: when someone answers us, we answer back — ≤1/day,
 * full exposure law, repeat gate, honest skip when nothing to answer. */
async function doDeepen({ account, master, st, p, now }) {
  if (st.done.deepen >= p.maxConversationDeepensPerDay) return false;
  const target = await fetchDeepenableThread(account, new Set(st.deepened ?? []), p);
  if (!target) return false;
  if (await alreadyAnswered(account, target.parentAuthor, target.parentPermlink)) { st.deepened = [...(st.deepened ?? []), target.comment]; return false; } // pair-guard
  const raw = await draftReplyViaBridge({
    account,
    postTitle: target.rootTitle,
    postExcerpt: "",
    commentAuthor: "",
    commentBody: target.replyBody,
    myPrior: target.myPrior,
  });
  const body = sanitizeReply(raw);
  if (!body) return false;
  /* R274 CLONE GUARD (same law as every conversational lane) */
  const day = dayKeyOf(now);
  if (!replyFresh(body, [...(st.said ?? []), ...fleetSaidFor(day)], { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const clash = await parentClash(account, target.parentAuthor, target.parentPermlink, body, { maxSimilarity: p.repeatSimilarityMax });
  if (clash.own) return false;
  if (clash.clash) { journalRefusal(now, account, `clone-veto:deepen:${target.comment}`, { ok: false, reasons: [`near-duplicate body (~${clash.sim}) already under the parent by ${clash.who}`] }); return false; }
  const permlink = `re-${target.parentAuthor}-${target.parentPermlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: target.parentAuthor, parent_permlink: target.parentPermlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  noteFleetSaid(day, account, body); // R274 intent-before-broadcast
  const res = await executeAs(account, ops, { tag: "social-deepen", role: "posting" });
  if (!res.ok) return false;
  st.deepened = [...(st.deepened ?? []), target.comment];
  st.said = [...(st.said ?? []), body.slice(0, 300)];
  return true;
}

/* ═══ R255 · THE PERSONA PROFILE SYNC (the visibility law) ═════════════════
 * Operator order (verbatim intent): "לשפר את הנראות שלנו שנראה טוב שיתארגנו
 * על פרופילים" — the fleet's on-chain profiles become PERSONAS: display name,
 * about-line and interests per account, written by the CONSENSUS op
 * account_update2 (op id 43, chain-truth probe in steemtx.mjs).
 *
 * 🔴 THE PHANTOM-WRITE LESSON (2026-10-07, third txid-oracle class): the
 * first implementation broadcast custom_json id "update_account_metadata" —
 * the node ACCEPTED the txs (txids 8c06c5e0…/ab68df1b…) yet get_accounts
 * showed EMPTY json_metadata: a no-op recorded by no plugin. The chain's
 * judgment (state, not receipts) is the only truth — the write moved to
 * account_update2 and the state verdicts are now derived FROM the chain.
 *
 * LAWS:
 *  · HONEST: profileDoc() fails CLOSED if any field smells of exposure
 *    (dashes, coordination words) — a persona is a writer's voice, never a
 *    fake biography (content.mjs exposure law restated).
 *  · IDEMPOTENT-BY-CHAIN-TRUTH: profileDiffers() reads the LIVE account and
 *    skips only when the chain already matches — a fresh state line can
 *    never overwrite the chain's verdict (no time-based freshness gates).
 *  · MERGE-NOT-WIPE: existing json_metadata is merged (unknown top-level
 *    keys survive) and written to BOTH json_metadata and
 *    posting_json_metadata (old + new frontend contract).
 *  · DOCTRINE CAPS: ≤2 broadcasts per run, custody-gated (keyless = honest
 *    DEFER), think-gate re-checks every broadcast.
 */
const PROFILE_MAX_PER_RUN = 4; // R262: operator order "verify everything on everyone" — images for all 14, custody-gated, idempotent

export function personasState() {
  return readJson(PERSONAS_FILE, null);
}

export async function runProfiles({ now = new Date().toISOString(), roster = [masterAccount(), ...ROSTER_BASE] } = {}) {
  const t0 = Date.now();
  /* exec29/29-b · THE SAME STANDBY LAW: an account_update2 profile write is
   * an on-chain social action — it stands down with the rail. Zero broadcasts
   * while the gate is closed (fail-closed, dual-key, re-evaluated every run;
   * paths resolve PER CALL per the R275 merge law). */
  const gateState = process.env.SAOS_STATE_DIR || STATE;
  const gate = await socialGateVerdict(gateState);
  if (gate.mode !== "ARMED") {
    appendLine(path.join(gateState, "events.jsonl"), { type: "personas.standby", at: now, mode: gate.mode, reason: gate.reason, actions: 0 });
    await refreshLaws(gateState).catch(() => {}); /* exec29/29-a2: same additive measured-laws refresh on the profiles standby path */
    return { at: now, verdict: "PROFILES-STANDBY", gate, updated: [], skipped: [], deferred: [], caps: "standby law exec29 — profile account_update2 stands down with the social rail", ms: Date.now() - t0 };
  }
  const st = readJson(PERSONAS_FILE, { perAccount: {} });
  st.perAccount = st.perAccount ?? {};
  const out = { at: now, updated: [], skipped: [], deferred: [], caps: `≤${PROFILE_MAX_PER_RUN}/run · chain-truth idempotent · custody-gated · account_update2(43)` };
  for (const account of roster) {
    if (out.updated.length >= PROFILE_MAX_PER_RUN) { out.deferred.push({ account, reason: "run-cap" }); continue; }
    const doc = profileDoc(account);
    if (!doc) { out.deferred.push({ account, reason: "exposure-guard-null" }); continue; }
    const cust = custodyOf(account);
    if (cust === "no-custody" || cust === "keyed-unverified" || cust === "master-unverified") {
      out.deferred.push({ account, reason: `custody:${cust}` });
      continue;
    }
    let live = null;
    try {
      const r = await rpcCall("condenser_api.get_accounts", [[account]]);
      live = r?.ok ? r.result?.[0] ?? null : null;
    } catch { live = null; }
    /* R263 IDEMPOTENCE FIX (measured live): the write lands in
     * posting_json_metadata — the idempotence read MUST read the same field
     * the chain serves and the frontends render (posting first, json fallback,
     * exactly the field the R263 audit and every frontend read). The old read
     * of json_metadata alone re-broadcast the same 4 profiles forever (3
     * passes = 12 wasted writes, measured this round). */
    const existingRaw = String(live?.posting_json_metadata || live?.json_metadata || "{}");
    if (!profileDiffers(existingRaw, doc)) {
      st.perAccount[account] = { ...(st.perAccount[account] ?? {}), at: now, verdict: "SYNCED-CHAIN-TRUTH", name: doc.name };
      out.skipped.push({ account, reason: "chain-already-matches" });
      continue;
    }
    /* the consensus write: merged metadata to posting_json_metadata ONLY —
     * the chain's authority law: a non-empty json_metadata field demands
     * ACTIVE authority ("missing required active authority" — measured live
     * 2026-10-07); posting_json_metadata alone signs with POSTING, which is
     * exactly where the profile UI contract lives (steemit/hive profile
     * readers). The merged body preserves the existing json_metadata keys. */
    const meta = mergeProfileMetadata(existingRaw, doc);
    const op = ["account_update2", {
      account,
      owner: null, active: null, posting: null,
      memo_key: String(live?.memo_key ?? ""),
      json_metadata: "",
      posting_json_metadata: meta,
      extensions: [],
    }];
    if (!op[1].memo_key) { out.deferred.push({ account, reason: "memo-key-unreadable" }); continue; }
    /* the Steem node demands ACTIVE authority for account_update2 (measured
     * live: get_required_signatures returns the active pubkey even for a
     * posting_json_metadata-only write) — the profile lane signs active,
     * backed by the R245 access-law full-custody keys from the git vault. */
    const res = await executeAs(account, [op], { tag: "profile-sync", role: "active" });
    if (res.ok) {
      st.perAccount[account] = { ...(st.perAccount[account] ?? {}), at: now, verdict: "BROADCAST", txid: res.txid ?? null, name: doc.name, about: doc.about.slice(0, 80) };
      out.updated.push({ account, name: doc.name, txid: res.txid ?? null });
      appendLine(path.join(STATE, "events.jsonl"), { type: "personas.profile-sync", at: now, account, name: doc.name, op: "account_update2", txid: res.txid ?? null });
    } else {
      st.perAccount[account] = { ...(st.perAccount[account] ?? {}), at: now, verdict: res.verdict ?? "REFUSED", reason: res.reason ?? (res.reasons?.[0] ?? null) };
      out.deferred.push({ account, reason: res.verdict ?? "REFUSED" });
    }
  }
  st.at = now;
  writeJson(PERSONAS_FILE, st);
  out.ms = Date.now() - t0;
  return out;
}
