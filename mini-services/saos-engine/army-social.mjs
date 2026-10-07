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
import { PUBLISH_ELIGIBLE_SINCE, titleSimilarity, recentPublishedTitles, wordCount, MIN_POST_WORDS } from "./content.mjs";
import { synthesizeComment, synthesizeReply, mentionsAny } from "./intel-pack.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const SOCIAL_FILE = path.join(STATE, "social.json");
const CONTENT_FILE = path.join(STATE, "content-ops.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* the standing roster: master + the 10 old-army accounts (T-80 custody list) */
export const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];

export function socialPolicy() {
  const conf = armedConf();
  return {
    enabled: true,
    publishWindow: [7, 23],     // UTC hours a publish may land in (broad daylight)
    maxPostsPerDay: 1,          // per account — presence, never flood (anti-spam law stays)
    maxFleetVotesPerDay: 3,     // per account — R244 amplification (תגביר עוצמה)
    fleetWeightPct: 25,         // low weight: support, not self-dealing
    maxFleetCommentsPerDay: 2,  // per account — R244: conversation is the product
    fleetRepliesEnabled: true,  // T-87: fleet comments are lawful reply targets
    maxRepliesPerDay: 3,        // per account — R244 amplification
    voteAgeMinMinutes: 15,      // fresh enough to earn curation share
    voteAgeMaxMinutes: 1200,    // 20h
    minCommentChars: 15,        // skip "nice"/spam comments
    maxReplyChars: 700,
    /* R243: the intelligence round — substance caps for the new lanes */
    maxCommunityCommentsPerDay: 2,   // R244: one real comment became two
    maxConversationDeepensPerDay: 2, // R244: answer who answers us, twice
    minCommunityPostChars: 400,      // comment real posts, not stubs
    communityTags: ["life", "psychology", "food", "photography", "writing", "nature", "health", "travel"],
    communityBlockedAuthors: ["steemit", "steem", "steemitblog", "busy", "steemcurator01", "steemcurator02", "upvu", "cmp2020"],
    repeatSimilarityMax: 0.34,       // Jaccard(3-gram) vs anything we already said today
    ...(conf.social ?? {}),
  };
}

export const dayKeyOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10);

/* ── pure: the day schedule (auditable randomness) ──────────────────────────
 * seed → deterministic minute-of-day per action kind. Publish lands once in
 * the daylight window; fleet votes + replies scatter through waking hours. */
export function buildDaySchedule(seed, { publishWindow = [7, 23] } = {}) {
  const rand = mulberry32(seed);
  const minuteOf = (h0, h1) => {
    const start = h0 * 60, span = Math.max(1, (h1 - h0) * 60);
    return start + Math.floor(rand() * span);
  };
  return [
    { kind: "publish", minute: minuteOf(publishWindow[0], publishWindow[1]) },
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
];
export function sanitizeReply(text) {
  const body = String(text ?? "").trim().replace(/\s+/g, " ");
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
          children: post.children ?? 0,
        });
      }
    } catch { /* one dead read never kills the rail */ }
  }
  return out;
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

async function draftReplyViaBridge({ postTitle, postExcerpt, commentAuthor, commentBody, myPrior }) {
  if (process.env.SAOS_OFFLINE !== "1") try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, commentAuthor, commentBody, myPrior }),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.reply?.body) return j.reply.body;
    }
  } catch { /* fall through to the pack */ }
  return synthesizeReply({ postTitle, commentBody, myPrior, seed: `${postTitle}|${commentBody?.slice(0, 60) ?? ""}` });
}

/* R244 · bridge-or-pack: the bridge is FIRST when reachable (LLM-grade), the
 * offline intelligence pack is the FLOOR (anchored, topic-aware, laws-safe).
 * The conversation never again depends on one machine being up. */
async function draftCommentViaBridge({ postTitle, postExcerpt, author }) {
  if (process.env.SAOS_OFFLINE !== "1") try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, author }),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.comment?.body) return j.comment.body;
    }
  } catch { /* fall through to the pack */ }
  return synthesizeComment({ postTitle, postExcerpt, seed: `${postTitle}|${postExcerpt.slice(0, 60)}` });
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

/* ── THE RAIL ─────────────────────────────────────────────────────────────── */
export async function runSocial({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
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
  const carried = prev?.day === day ? prev : { day, accounts: {}, seeds: {} };

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

    /* the day's schedule — seeded per day+account, rebuilt cheaply every run */
    const seed = hashSeed(`${day}|${account}|social-v1`);
    carried.seeds[account] = seed;
    const schedule = buildDaySchedule(seed, { publishWindow: p.publishWindow });
    const due = schedule.filter((s) => minuteOfDay >= s.minute && st.done[s.kind] < capOf(s.kind, p));
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
    accounts[account] = { ...st, verdict: "SOCIAL-LIVE", custody, schedule, seeds: seed };
  }

  const doc = { ...base, custodyVerdict: custody?.verdict ?? null, custodyVerified: custody?.after?.verified ?? null, accounts, seeds: carried.seeds, executed, refused, due: dueCount, ms: Date.now() - t0 };
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
  if (st.done.publish >= p.maxPostsPerDay) return false;
  const c = readJson(CONTENT_FILE, null);
  const queue = Array.isArray(c?.queue) ? c.queue : [];
  /* retire pre-R240 stock once, in the shared queue */
  let retired = 0;
  for (const d of queue) {
    if (d?.status === "drafted" && (d.draftedAt ?? "") < PUBLISH_ELIGIBLE_SINCE) { d.status = "retired-old-stock"; d.retiredAt = now; retired++; }
  }
  const draft = queue.find((d) => d.status === "drafted" && !st.published?.includes(d.id));
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
  const permlink = permlinkStem(draft.title, day, st.done.publish ?? 0);
  const meta = JSON.stringify({ tags: draft.tags, app: "saos-social-rail" });
  const ops = [[
    "comment",
    { parent_author: "", parent_permlink: "steem", author: account, permlink, title: draft.title, body: draft.body, json_metadata: meta },
  ]];
  const res = await executeAs(account, ops, { tag: "social-post", role: "posting" });
  if (!res.ok) return false;
  st.published = [...(st.published ?? []), draft.id];
  /* the draft is spent — mark it in the shared queue so no account double-posts it */
  draft.status = "published";
  draft.publishedAt = now;
  draft.publishedBy = account;
  draft.permlink = `${account}/${permlink}`;
  writeJson(CONTENT_FILE, c);
  return true;
}

/* vote for a fresh post by ANOTHER fleet account — the mutual-support law */
async function doFleetVote({ account, master, st, p, nowMs, now }) {
  if (st.done["fleet-vote"] >= p.maxFleetVotesPerDay) return false;
  const exclude = new Set((st.voted ?? []).map((v) => `${v.author}/${v.permlink}`));
  const candidates = await fetchFleetPosts({
    viewer: account,
    accounts: [master, ...ARMY_ROSTER],
    nowMs, p, excludePermlinks: exclude,
  });
  if (!candidates.length) return false;
  /* T-87 ANTI-HERD PICK: rank by roster votes already carried (chain-truth
   * active_votes), then by total votes — the least-supported fleet post gets
   * the next vote, so support spreads; seeded rotation inside the tier. */
  const minRoster = Math.min(...candidates.map((c) => c.rosterVotes ?? 0));
  const tier = candidates.filter((c) => (c.rosterVotes ?? 0) === minRoster)
    .sort((a, b) => (a.votes ?? 0) - (b.votes ?? 0) || b.createdMs - a.createdMs);
  const pick = tier[(hashSeed(`${now.slice(0, 10)}|${account}|vote`) + st.done["fleet-vote"]) % tier.length];
  const weight = Math.round(p.fleetWeightPct * 100);
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
  const raw = await draftCommentViaBridge({ postTitle: pick.title, postExcerpt: pick.excerpt, author: pick.author });
  const body = sanitizeReply(raw);
  if (!body) return false; /* bridge down / law violation → honest skip, no spam */
  if (!replyFresh(body, st.said, { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const permlink = `re-${pick.author}-${pick.permlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: pick.author, parent_permlink: pick.permlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
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
  const raw = await draftReplyViaBridge(target);
  const body = sanitizeReply(raw);
  if (!body) return false; /* bridge down / law violation → honest skip, no spam */
  if (!replyFresh(body, st.said, { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const permlink = `re-${target.parentAuthor}-${target.parentPermlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: target.parentAuthor, parent_permlink: target.parentPermlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
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
  const raw = await draftCommentViaBridge({ postTitle: pick.title, postExcerpt: pick.excerpt, author: pick.author });
  const body = sanitizeReply(raw);
  if (!body) return false;
  if (!replyFresh(body, st.said, { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const permlink = `re-${pick.author}-${pick.permlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: pick.author, parent_permlink: pick.permlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
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
    postTitle: target.rootTitle,
    postExcerpt: "",
    commentAuthor: "",
    commentBody: target.replyBody,
    myPrior: target.myPrior,
  });
  const body = sanitizeReply(raw);
  if (!body) return false;
  if (!replyFresh(body, st.said, { maxSimilarity: p.repeatSimilarityMax })) { st.said = [...(st.said ?? []), body.slice(0, 300)]; return false; }
  const permlink = `re-${target.parentAuthor}-${target.parentPermlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: target.parentAuthor, parent_permlink: target.parentPermlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  const res = await executeAs(account, ops, { tag: "social-deepen", role: "posting" });
  if (!res.ok) return false;
  st.deepened = [...(st.deepened ?? []), target.comment];
  st.said = [...(st.said ?? []), body.slice(0, 300)];
  return true;
}
