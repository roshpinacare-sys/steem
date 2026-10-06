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
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, custodyOf } from "./signer.mjs";
import { mulberry32, hashSeed } from "./curator.mjs";
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
    maxPostsPerDay: 1,          // per account — presence, never flood
    maxFleetVotesPerDay: 2,     // per account — the "vote for each other" law
    fleetWeightPct: 25,         // low weight: support, not self-dealing
    maxFleetCommentsPerDay: 1,  // per account — T-87 conversation starter
    fleetRepliesEnabled: true,  // T-87: fleet comments are lawful reply targets
    maxRepliesPerDay: 2,        // per account — conversation, not spam
    voteAgeMinMinutes: 15,      // fresh enough to earn curation share
    voteAgeMaxMinutes: 1200,    // 20h
    minCommentChars: 15,        // skip "nice"/spam comments
    maxReplyChars: 700,
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
    { kind: "fleet-comment", minute: minuteOf(6, 24) },
    { kind: "reply", minute: minuteOf(6, 24) },
    { kind: "reply", minute: minuteOf(6, 24) },
  ];
}

/* pure: reply sanitizer — the exposure law, re-checked in code */
export function sanitizeReply(text) {
  const body = String(text ?? "").trim().replace(/\s+/g, " ");
  if (body.length < 20 || body.length > 700) return null;
  /* T-87: every roster name is banned too — a fleet-authored body that names
   * a sibling account never ships (no cross-mention patterns, ever) */
  const banned = ["headcorner", "hcsoldier", ...ARMY_ROSTER, "saos", "צבא", "our accounts", "multi-account", "we control", "our fleet", "guaranteed profit", "price target", "http://", "https://"];
  if (banned.some((w) => body.toLowerCase().includes(w))) return null;
  return body;
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

async function draftReplyViaBridge({ postTitle, postExcerpt, commentAuthor, commentBody }) {
  try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, commentAuthor, commentBody }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.reply?.body ?? null;
  } catch { return null; }
}

/* T-87: bridge draft for a fleet-conversation comment (the engine re-sanitizes) */
async function draftCommentViaBridge({ postTitle, postExcerpt, author }) {
  try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, author }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.comment?.body ?? null;
  } catch { return null; }
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
      done: { publish: 0, "fleet-vote": 0, "fleet-comment": 0, reply: 0 },
      voted: [], commented: [], replied: [], published: [],
      verdict: "INIT",
    };
    /* T-87: old-day carried state may lack the newer kinds — zero-default them
     * or the due-filter (`undefined < cap`) would park the lane forever */
    st.done = { publish: 0, "fleet-vote": 0, "fleet-comment": 0, reply: 0, ...(st.done ?? {}) };
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

    for (const slot of due) {
      if (slot.kind === "publish") {
        if (!(await rcOk(account, st))) continue;
        const ok = await doPublish(account, st, p, now, day);
        if (ok) { st.done.publish++; executed++; }
      } else if (slot.kind === "fleet-vote") {
        if (!(await rcOk(account, st))) continue;
        const ok = await doFleetVote({ account, master, st, p, nowMs, now });
        if (ok) { st.done["fleet-vote"]++; executed++; }
      } else if (slot.kind === "fleet-comment") {
        if (!(await rcOk(account, st))) continue;
        const ok = await doFleetComment({ account, master, st, p, nowMs, now });
        if (ok) { st.done["fleet-comment"]++; executed++; }
      } else if (slot.kind === "reply") {
        if (!(await rcOk(account, st))) continue;
        const ok = await doReply({ account, st, p, now });
        if (ok) { st.done.reply++; executed++; }
      }
    }
    accounts[account] = { ...st, verdict: "SOCIAL-LIVE", custody, schedule, seeds: seed };
  }

  const doc = { ...base, custodyVerdict: custody?.verdict ?? null, custodyVerified: custody?.after?.verified ?? null, accounts, seeds: carried.seeds, executed, refused, due: dueCount, ms: Date.now() - t0 };
  writeJson(SOCIAL_FILE, doc);
  appendLine(path.join(STATE, "events.jsonl"), { type: "social.run", at: now, day, executed, refused });
  return { verdict: executed > 0 ? "SOCIAL-EXECUTED" : refused ? "PART-GATED" : "SOCIAL-IDLE", executed, refused, due: dueCount };
}

const capOf = (kind, p) => (kind === "publish" ? p.maxPostsPerDay : kind === "fleet-vote" ? p.maxFleetVotesPerDay : kind === "fleet-comment" ? p.maxFleetCommentsPerDay : p.maxRepliesPerDay);

/* publish one sanitized draft (content-ops queue) — never invented here */
async function doPublish(account, st, p, now, day) {
  if (st.done.publish >= p.maxPostsPerDay) return false;
  const c = readJson(CONTENT_FILE, null);
  const queue = Array.isArray(c?.queue) ? c.queue : [];
  const draft = queue.find((d) => d.status === "drafted" && !st.published?.includes(d.id));
  if (!draft) return false;
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
  const raw = await draftCommentViaBridge({ postTitle: pick.title, postExcerpt: pick.excerpt, author: pick.author });
  const body = sanitizeReply(raw);
  if (!body) return false; /* bridge down / law violation → honest skip, no spam */
  const permlink = `re-${pick.author}-${pick.permlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: pick.author, parent_permlink: pick.permlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  const res = await executeAs(account, ops, { tag: "social-fleet-comment", role: "posting" });
  if (!res.ok) return false;
  st.commented = [...(st.commented ?? []), `${pick.author}/${pick.permlink}`];
  return true;
}

/* reply to one real community comment on this account's own posts */
async function doReply({ account, st, p, now }) {
  if (st.done.reply >= p.maxRepliesPerDay) return false;
  const target = await fetchRepliableComments(account, new Set(st.replied ?? []), p);
  if (!target) return false;
  const raw = await draftReplyViaBridge(target);
  const body = sanitizeReply(raw);
  if (!body) return false; /* bridge down / law violation → honest skip, no spam */
  const permlink = `re-${target.parentAuthor}-${target.parentPermlink}-${Date.parse(now).toString(36)}`.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 240);
  const ops = [[
    "comment",
    { parent_author: target.parentAuthor, parent_permlink: target.parentPermlink, author: account, permlink, title: "", body, json_metadata: JSON.stringify({ app: "saos-social-rail" }) },
  ]];
  const res = await executeAs(account, ops, { tag: "social-reply", role: "posting" });
  if (!res.ok) return false;
  st.replied = [...(st.replied ?? []), target.comment];
  return true;
}
