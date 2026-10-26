/**
 * hive-social.mjs — R262 · THE HIVE COMMUNITY LOOP (הקהילה שלנו פעילה).
 *
 * Operator order 2026-10-08 (verbatim intent): "תזמונים חכמים כל אחד
 * בקהילה שלנו פעיל בזמנו עובר על כל חברי הקהילה שזה אנחנו כל הפעילים
 * באוטונומיה מגיב מצביע לפי יכולת ומתפתחים ביחד זה ערוץ תקשורת עבורנו
 * גם" — this is that channel, on the sister chain. The Steem rail has had
 * it since T-85 (army-social.mjs); Hive was posts-only with votes OFF.
 * Now: votes + comments + deepens among OUR OWN posts, persona-voiced,
 * capped, RC-gated, veto-armed. No outsider is targeted; the community
 * lanes only ever touch fleet-authored content.
 *
 * THE LAWS:
 *  · anti-herd: the vote lands on the least-supported sibling post
 *    (chain-truth active_votes), the comment lands on the least-commented
 *    one — support spreads, never herds (T-87 law, cross-chain).
 *  · voices, not bots: every comment is drafted IN the account's PERSONA
 *    (bridge first with the full persona brief; the seeded persona writers
 *    synthesizePersonaComment/Reply are the lawful floor) under sanitizeReply
 *    + replyFresh (no repeats, no template praise, no dash violations, no
 *    self-replies, no sibling names in bodies). The probe shield runs BEFORE
 *    the bridge: an investigating comment never reaches the LLM (fail-closed).
 *  · CAPS (per account per day): ≤2 fleet votes (weight 25%), ≤1 fleet
 *    comment, ≤1 deepen. Presence, never flood.
 *  · RC-gated per action (measured budget: a vote ≈ dust, a comment ≈ a
 *    fraction of a post) — a drained account honestly defers.
 *  · the downvote veto runs first (hiveDownvoteScan semantics: any new
 *    flag on trial-era content pauses the account; the fleet pause lives
 *    in hive-ops.json).
 *  · schedules: each account gets seeded activity minutes (mulberry32
 *    day|account|lane) inside 07:00-23:00 UTC — same auditability law as
 *    army-social (the plan is reproducible post-hoc from state).
 *  · every verdict journaled; keys never touch anything.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcHive, HIVE_ROSTER, POST_RC_COST, hiveCustody, sendAs } from "./hive.mjs";
import { mulberry32, hashSeed } from "./curator.mjs";
import { synthesizeReply, synthesizePersonaComment, synthesizePersonaReply, isProbeComment } from "./intel-pack.mjs";
import { sanitizeReply, replyFresh, normalizeBodyForClash, textSimilarity, fleetSaidFor, noteFleetSaid } from "./army-social.mjs";
import { personaBrief } from "./personas.mjs";
import { bridgeOpen, noteBridgeFailure, noteBridgeSuccess } from "./bridge-guard.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "hive-social.json");
/* R263: the conversation bridge (the cockpit LLM). Engine-called, backend-only. */
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── R263 · THE PERSONA-VOICED CONVERSATION (operator order: "לשפר
 * אינטלגנציה וסגנון כתיבה אישי יעודי לכל אחד מסודר") — a comment is no
 * longer interchangeable: the bridge gets the FULL persona brief (lens,
 * traits, personal slang, register dial) and drafts IN that voice; the
 * seeded persona writers are the lawful floor when the bridge is down
 * (429 measured live). The engine re-sanitizes in pure code — the bridge
 * drafts, the engine decides. Fail-soft: any bridge error falls to the
 * persona floor, never to silence. */
async function personaCommentViaBridge({ account, postTitle, postExcerpt, seed }) {
  const brief = personaBrief(account);
  if (process.env.SAOS_OFFLINE !== "1" && brief && bridgeOpen()) try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/comment`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, postExcerpt, personaBrief: brief }),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.comment?.body) { noteBridgeSuccess(); return j.comment.body; }
    }
    noteBridgeFailure(`hive-comment:${r.status}`);
  } catch (e) { noteBridgeFailure(`hive-comment:${String(e?.message ?? e).slice(0, 40)}`); }
  return synthesizePersonaComment({ account, postTitle, postExcerpt, seed });
}

async function personaReplyViaBridge({ account, postTitle, commentBody, myPrior = "", seed }) {
  /* THE PROBE SHIELD RUNS FIRST: a comment that investigates bots/automation/
   * account networks never reaches the LLM at all — the fail-closed deflector
   * answers it (R262 law, now enforced BEFORE the bridge, not only in it). */
  if (isProbeComment(commentBody)) return synthesizeReply({ postTitle, commentBody, myPrior, seed });
  const brief = personaBrief(account);
  if (process.env.SAOS_OFFLINE !== "1" && brief && bridgeOpen()) try {
    const r = await fetch(`${BRIDGE}/api/saos/ai/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postTitle, commentBody, myPrior, personaBrief: brief }),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.reply?.body) { noteBridgeSuccess(); return j.reply.body; }
    }
    noteBridgeFailure(`hive-reply:${r.status}`);
  } catch (e) { noteBridgeFailure(`hive-reply:${String(e?.message ?? e).slice(0, 40)}`); }
  return synthesizePersonaReply({ account, postTitle, commentBody, myPrior, seed });
}

/* the measured budget: a full ≥1600-char post costs ~2.3B RC (hive.mjs);
 * a comment body ≤500 chars is roughly a quarter of that — the gate stays
 * conservative (COMMENT_RC_FLOOR) so a comment never drains a poster. */
export const VOTE_RC_FLOOR = 50_000_000;
export const COMMENT_RC_FLOOR = 600_000_000;
export const FLEET_VOTE_WEIGHT = 2500; // 25% — support, not self-dealing
/* R283 · FULL-ACTIVITY CAPS (operator order 2026-10-08, verbatim intent:
 * "תוכיח תפעיל שם הכל מיד פעילות מלאה") — the probe-era caps (1 comment,
 * 1 deepen, 2 votes) held the Hive organ at a whisper. The floors and the
 * veto stay untouched — a broke account still does not broadcast. */
export const CAPS = { fleetVote: 3, fleetComment: 3, deepen: 2 };
export const WINDOW = { minMinute: 7 * 60, maxMinute: 23 * 60 }; // 07:00–23:00 UTC

/* ── pure: seeded daily schedule (auditability law) ───────────────────────── */
export function dayScheduleFor(account, dayIso, { fleetVote = CAPS.fleetVote, fleetComment = CAPS.fleetComment, deepen = CAPS.deepen } = {}) {
  const rand = mulberry32(Number(hashSeed(`${dayIso}|${account}|hive-social`)) >>> 0);
  const minute = (lo, hi) => Math.floor(lo + rand() * (hi - lo));
  const slots = [];
  for (let i = 0; i < fleetVote; i++) slots.push({ kind: "fleet-vote", minute: minute(WINDOW.minMinute, WINDOW.maxMinute) });
  for (let i = 0; i < fleetComment; i++) slots.push({ kind: "fleet-comment", minute: minute(WINDOW.minMinute, WINDOW.maxMinute) });
  for (let i = 0; i < deepen; i++) slots.push({ kind: "deepen", minute: minute(WINDOW.minMinute, WINDOW.maxMinute) });
  return slots.sort((a, b) => a.minute - b.minute);
}
export const minuteOfDay = (iso) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/* ── pure: anti-herd pick ─────────────────────────────────────────────────── */
export function leastSupported(posts, roster) {
  const set = new Set(roster);
  let best = null, bestScore = Infinity;
  for (const p of posts ?? []) {
    const votes = Array.isArray(p.active_votes) ? p.active_votes : [];
    const rosterVotes = votes.filter((v) => set.has(v.voter)).length;
    const score = votes.length + rosterVotes * 0.5;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}
export function leastCommented(posts) {
  let best = null, bestN = Infinity;
  for (const p of posts ?? []) {
    const n = Number(p.children ?? 0);
    if (n < bestN) { bestN = n; best = p; }
  }
  return best;
}
const ageMin = (iso, now) => Math.max(0, (Date.parse(now) - Date.parse(iso)) / 60000);
const FRESH = { min: 15, max: 1200 }; // 15min .. 20h

/* ── pure: reply permlink ─────────────────────────────────────────────────── */
export function replyPermlink(parentAuthor, parentPermlink, nowIso) {
  const day = String(nowIso).slice(0, 10).replace(/-/g, "");
  const stem = String(parentPermlink).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  return `re-${parentAuthor}-${stem}-${day}`;
}

/* ── pure: the vote op ────────────────────────────────────────────────────── */
export function voteOp(voter, author, permlink, weight = FLEET_VOTE_WEIGHT) {
  return [["vote", { voter, author, permlink, weight: Math.round(weight) }]];
}

/* ── pure: the comment op ─────────────────────────────────────────────────── */
export function commentOp(author, parentAuthor, parentPermlink, permlink, body, firstTag = "life") {
  return [["comment", {
    parent_author: parentAuthor, parent_permlink: parentPermlink,
    author, permlink, title: "", body,
    json_metadata: JSON.stringify({ tags: [firstTag], app: "saos-hive-rail" }),
  }]];
}

/* ── chain reads ──────────────────────────────────────────────────────────── */
async function siblingPosts(author, nowIso) {
  const r = await rpcHive("condenser_api.get_discussions_by_blog", [{ tag: author, limit: 6 }]);
  if (!r.ok) return [];
  return (r.result ?? []).filter((p) => p.author === author && p.id !== 0 && ageMin(p.created, nowIso) >= FRESH.min && ageMin(p.created, nowIso) <= FRESH.max);
}
async function commentsOnMyPost(parentAuthor, parentPermlink) {
  const r = await rpcHive("condenser_api.get_content_replies", [parentAuthor, parentPermlink]);
  return r.ok ? (r.result ?? []) : [];
}

/* R275 · THE CLONE GUARD ON HIVE (the layer R274 left for this round).
 * The said-list in state dies with a sandbox; the chain does not. One read
 * of the live replies under the parent, the same 0.34 Jaccard law as the
 * Steem rail — no near-duplicate body lands under the same parent no matter
 * which chain, which account, or how old the local memory is.
 * The verdict core is PURE (offline-testable); the wrapper only fetches. */
export function clashVerdict(account, body, replies, { maxSimilarity = 0.34 } = {}) {
  const out = { own: false, clash: false, who: null, sim: 0 };
  const mine = normalizeBodyForClash(body);
  for (const c of replies ?? []) {
    if (account && c.author === account) out.own = true;
    const s = textSimilarity(mine, normalizeBodyForClash(c.body));
    if (s >= maxSimilarity && s >= out.sim) { out.clash = true; out.who = c.author; out.sim = Math.round(s * 100) / 100; }
  }
  return out;
}
export async function hiveParentClash(account, parentAuthor, parentPermlink, body, { maxSimilarity = 0.34 } = {}) {
  let replies = [];
  try {
    const r = await rpcHive("condenser_api.get_content_replies", [parentAuthor, parentPermlink]);
    if (r.ok) replies = r.result ?? [];
  } catch { /* unreachable chain → fail OPEN here; the said-ledger still holds */ }
  return clashVerdict(account, body, replies, { maxSimilarity });
}
async function rcAvailableOf(account) {
  const r = await rpcHive("rc_api.find_rc_accounts", { accounts: [account] });
  const a = r?.result?.rc_accounts?.[0];
  if (!a) return { cur: 0, max: 0, available: 0 };
  const cur = Number(a.rc_manabar?.current_mana ?? 0);
  const max = Number(a.max_rc ?? 0);
  const upd = Number(a.rc_manabar?.last_update_time ?? 0);
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - (Number.isFinite(upd) ? upd : 0));
  return { cur, max, available: max > 0 ? Math.min(max, cur + (max * Math.min(elapsed, 432_000)) / 432_000) : cur };
}

/* ── the pass ─────────────────────────────────────────────────────────────── */
export async function runHiveSocial({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const day = String(now).slice(0, 10);
  const prev = readJson(FILE, null);
  const carry = prev?.day === day ? prev : { day, perAccount: {} };
  const perAccount = carry.perAccount ?? {};
  const hiveOps = readJson(path.join(STATE, "hive-ops.json"), null);
  const results = [];
  const out = { at: now, day, results, caps: `≤${CAPS.fleetVote} votes @25% · ≤${CAPS.fleetComment} comment · ≤${CAPS.deepen} deepen /day/account · anti-herd · persona-voiced · RC-gated · veto-armed` };

  if (hiveOps?.fleetPaused?.active) {
    out.verdict = "HIVE-FLEET-PAUSED"; out.reason = hiveOps.fleetPaused.reason;
    out.ms = Date.now() - t0;
    writeJson(FILE, { ...out, perAccount });
    return out;
  }
  const custody = await hiveCustody({ now });
  out.custody = { verified: custody.verified, total: custody.total };
  if (custody.verified === 0) { out.verdict = "HIVE-NO-CUSTODY"; out.ms = Date.now() - t0; writeJson(FILE, { ...out, perAccount }); return out; }

  for (const account of HIVE_ROSTER) {
    const st = perAccount[account] ?? { done: {}, said: [] };
    st.done = st.done ?? {}; st.said = st.said ?? [];
    const done = st.done;
    const said = new Set(st.said);
    const push = (lane, verdict, extra = {}) => {
      results.push({ account, lane, verdict, ...extra });
      appendLine(path.join(STATE, "events.jsonl"), { type: `hive.social.${lane}`, at: now, account, verdict, ...Object.fromEntries(Object.entries(extra).filter(([k]) => ["permlink", "digest8", "reason"].includes(k))) });
    };
    if (custody.results[account] !== "VERIFIED-VS-HIVE-CHAIN") { push("gate", custody.results[account]); continue; }

    /* schedule: the lane opens only inside its seeded minute window (+90min grace) */
    const slots = dayScheduleFor(account, day);
    const nowMin = minuteOfDay(now);
    const due = (kind) => slots.some((s) => s.kind === kind && s.minute <= nowMin);

    /* lane 1: fleet-vote (anti-herd, cheap RC) */
    if (!due("fleet-vote")) { push("fleet-vote", "SCHEDULE-LATER"); }
    else if ((done.fleetVote ?? 0) >= CAPS.fleetVote) { push("fleet-vote", "DAY-CAP"); }
    else {
      const candidates = [];
      for (const sib of HIVE_ROSTER) if (sib !== account && custody.results[sib] === "VERIFIED-VS-HIVE-CHAIN") candidates.push(...await siblingPosts(sib, now));
      const pick = leastSupported(candidates, HIVE_ROSTER);
      if (!pick) push("fleet-vote", "NO-CANDIDATE");
      else {
        const rc = await rcAvailableOf(account);
        if (rc.available < VOTE_RC_FLOOR) push("fleet-vote", "RC-LOW-HONEST-DEFER");
        else {
          const res = await sendAs(account, voteOp(account, pick.author, pick.permlink));
          if (res.ok) { done.fleetVote = (done.fleetVote ?? 0) + 1; push("fleet-vote", "BROADCAST", { permlink: `${pick.author}/${pick.permlink}`, digest8: res.digest8 }); }
          else push("fleet-vote", res.verdict ?? "REJECTED", { reason: String(res.error ?? "").slice(0, 100) });
        }
      }
    }

    /* lane 2: fleet-comment (the least-commented sibling post, persona voice) */
    if (!due("fleet-comment")) { push("fleet-comment", "SCHEDULE-LATER"); }
    else if ((done.fleetComment ?? 0) >= CAPS.fleetComment) { push("fleet-comment", "DAY-CAP"); }
    else {
      const candidates = [];
      for (const sib of HIVE_ROSTER) if (sib !== account && custody.results[sib] === "VERIFIED-VS-HIVE-CHAIN") candidates.push(...await siblingPosts(sib, now));
      const pick = leastCommented(candidates);
      if (!pick) push("fleet-comment", "NO-CANDIDATE");
      else {
        const rc = await rcAvailableOf(account);
        if (rc.available < COMMENT_RC_FLOOR) push("fleet-comment", "RC-LOW-HONEST-DEFER");
        else {
          /* R263: the comment speaks in THIS account's persona (bridge first,
           * persona seed floor) — no interchangeable applause across voices */
          const raw = await personaCommentViaBridge({ account, postTitle: pick.title ?? "", postExcerpt: String(pick.body ?? "").slice(0, 400), seed: hashSeed(`${day}|${account}|${pick.permlink}`) });
          const body = sanitizeReply(raw);
          if (!body) push("fleet-comment", "NO-LAWFUL-BODY");
          else if (!replyFresh(body, [...said, ...fleetSaidFor(day)])) push("fleet-comment", "REPEAT-VETO");
          else {
            /* R275 clone guard vs the chain itself — the sandbox-proof memory */
            const clash = await hiveParentClash(account, pick.author, pick.permlink, body);
            if (clash.own) push("fleet-comment", "OWN-VOICE-VETO");
            else if (clash.clash) push("fleet-comment", "CLONE-VETO", { reason: `near-duplicate (~${clash.sim}) already under parent by ${clash.who}` });
            else {
            const pl = replyPermlink(pick.author, pick.permlink, now);
            noteFleetSaid(day, account, body); // intent-before-broadcast, same-tick siblings see this
            const res = await sendAs(account, commentOp(account, pick.author, pick.permlink, pl, body));
            if (res.ok) {
              done.fleetComment = (done.fleetComment ?? 0) + 1;
              said.add(body); st.said = Array.from(said).slice(-12);
              push("fleet-comment", "BROADCAST", { permlink: `${pick.author}/${pick.permlink}`, digest8: res.digest8 });
            } else push("fleet-comment", res.verdict ?? "REJECTED", { reason: String(res.error ?? "").slice(0, 100) });
            }
          }
        }
      }
    }

    /* lane 3: deepen (someone answered us; conversation is the product) */
    if (!due("deepen")) { push("deepen", "SCHEDULE-LATER"); }
    else if ((done.deepen ?? 0) >= CAPS.deepen) { push("deepen", "DAY-CAP"); }
    else {
      const mine = await siblingPosts(account, now);
      let target = null, comment = null;
      outer: for (const p of mine) {
        const replies = await commentsOnMyPost(account, p.permlink);
        for (const c of replies) {
          if (c.author === account) continue; // a monologue is not a conversation
          if (HIVE_ROSTER.includes(c.author) && c.author === account) continue;
          target = { post: p, reply: c }; comment = c; break outer;
        }
      }
      if (!comment) push("deepen", "NOTHING-TO-DEEPEN");
      else {
        const rc = await rcAvailableOf(account);
        if (rc.available < COMMENT_RC_FLOOR) push("deepen", "RC-LOW-HONEST-DEFER");
        else {
          /* R263: the deepen reply speaks in THIS account's persona; the probe
           * shield already ran inside personaReplyViaBridge (fail-closed) */
          const raw = await personaReplyViaBridge({ account, postTitle: target.post.title ?? "", commentBody: String(comment.body ?? "").slice(0, 400), seed: hashSeed(`${day}|${account}|${comment.permlink}`) });
          const body = sanitizeReply(raw);
          if (!body) push("deepen", "NO-LAWFUL-BODY");
          else if (!replyFresh(body, [...said, ...fleetSaidFor(day)])) push("deepen", "REPEAT-VETO");
          else {
            /* R275 clone guard vs the chain itself — the sandbox-proof memory */
            const clash = await hiveParentClash(account, comment.author, comment.permlink, body);
            if (clash.own) push("deepen", "OWN-VOICE-VETO");
            else if (clash.clash) push("deepen", "CLONE-VETO", { reason: `near-duplicate (~${clash.sim}) already under parent by ${clash.who}` });
            else {
            const pl = replyPermlink(comment.author, comment.permlink, now);
            noteFleetSaid(day, account, body); // intent-before-broadcast
            const res = await sendAs(account, commentOp(account, comment.author, comment.permlink, pl, body));
            if (res.ok) {
              done.deepen = (done.deepen ?? 0) + 1;
              said.add(body); st.said = Array.from(said).slice(-12);
              push("deepen", "BROADCAST", { permlink: `${comment.author}/${comment.permlink}`, digest8: res.digest8 });
            } else push("deepen", res.verdict ?? "REJECTED", { reason: String(res.error ?? "").slice(0, 100) });
            }
          }
        }
      }
    }
    perAccount[account] = { done, said: st.said };
  }
  const executed = results.filter((r) => r.verdict === "BROADCAST").length;
  out.verdict = executed > 0 ? "HIVE-SOCIAL-EXECUTED" : "HIVE-SOCIAL-IDLE";
  out.executed = executed;
  out.ms = Date.now() - t0;
  writeJson(FILE, { ...out, perAccount });
  return out;
}

export function hiveSocialState() { return readJson(FILE, null); }

if (import.meta.url === `file://${process.argv[1]}`) {
  runHiveSocial({}).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("HIVE-SOCIAL-FAIL", e); process.exit(1); });
}
