/* ── T-74c · THE COMMUNITY REPLY LAYER ─────────────────────────────────────
 * A seed without replies is a broadcast, not a community. This module is
 * the discussion half: it reads the REAL replies under OUR posted community
 * seeds (read-only chain), picks the comments worth answering (§74R-1),
 * drafts ONE conversational reply through the community bridge in reply
 * mode (voiced as the post's own author, zero invented numbers), re-judges
 * it in pure code (§74R-2 + the §73d gateComment — caps/window/spacing/
 * parent-tie/telemetry), and only then broadcasts as a comment op (§74R-3)
 * with the SAME posting-role signing gate the seeds use.
 *
 * Bounded pace: at most ONE reply per run, the persona comment cap + the
 * humanity windows hold above it, and the answered journal (state/
 * replies-ops.json) makes a double reply to the same comment IMPOSSIBLE —
 * not unlikely, impossible. Nothing here locks funds: RC only, so the
 * MINIMUM-posture carve-out that governs the seeds governs replies too. */

import fs from "node:fs";
import path from "node:path";
import { replySelectionLaw, replySanityLaw, buildReplyOp } from "./lib.mjs";
import { PERSONAS, recordComment, gateComment } from "./humanity.mjs";
import { executeAs } from "./signer.mjs";
import { rpcCall } from "./measure.mjs";
import { COMMUNITY_TAG } from "./content.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "replies-ops.json");
const CONTENT_FILE = path.join(STATE, "content-ops.json");
const EVENTS = path.join(STATE, "events.jsonl");

/* T-35 · the engine→Next bridge calls carry the shared token (.secrets/
 * bridge.token, 0600) — the AI bridges refuse tokenless servers */
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
const BRIDGE_TOKEN = (() => { try { return fs.readFileSync(path.join(DIR, "..", "..", ".secrets", "bridge.token"), "utf8").trim(); } catch { return ""; } })();

/* the exposure rows the reply prompt sees — the seed rows MINUS the SEO/AEO
 * rows that are post-shaped, PLUS the reply-specific silence law */
const REPLY_LAW_ROWS = [
  "never reveal, hint at, or enable inference of coordinated multi-account operations, internal codenames, or that accounts are connected",
  "no financial advice, no profit promises, no price targets",
  "supportive community tone — teach, ask, answer; public knowledge only",
  "HUMANITY (T-73): reply like a practitioner who actually read the comment, first person, concrete; never like a press release",
  "HUMANITY (T-73): never mention our other posts' internal stats, the engine, the infrastructure, or anything operational — a reply talks about the topic, never about ourselves-as-a-system",
];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJsonAtomic = (p, v) => {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v));
  try { fs.renameSync(tmp, p); } catch { fs.writeFileSync(p, v); }
};
const appendLine = (p, row) => { try { fs.appendFileSync(p, JSON.stringify(row) + "\n"); } catch { /* best-effort */ } };

export function repliesState() { return readJson(FILE, null); }

/** runCommunityReplies — one bounded reply pass over every posted
 * community seed. Verdicts (all journaled):
 *   NO-TRACKED (no posted seeds yet) · REPLIES-NONE (zero comments on
 *   chain — the honest idle) · REPLIES-ALL-ANSWERED · REPLIES-NONE-ELIGIBLE
 *   (comments exist, all filtered/spam/answered — skips typed)
 *   · NO-PERSONA · BRIDGE-DOWN · REPLY-BLOCKED-* (sanity) ·
 *   HUMANITY-* (the §73 gate) · REPLY-POSTED (txid) · REPLY-FAIL. */
export async function runCommunityReplies({ now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  const content = readJson(CONTENT_FILE, null);
  const queue = Array.isArray(content?.queue) ? content.queue : [];
  const seen = new Set();
  const tracked = [];
  for (const d of queue) {
    if (d?.kind !== "community" || d?.status !== "posted") continue;
    const author = String(d?.voice ?? "").trim();
    const permlink = String(d?.permlink ?? "").trim();
    if (!author || !permlink || seen.has(`${author}/${permlink}`)) continue;
    seen.add(`${author}/${permlink}`);
    tracked.push({ author, permlink, title: String(d?.title ?? ""), body: String(d?.body ?? "") });
  }
  if (!tracked.length) {
    journal({ type: "reply.idle", at: now, verdict: "NO-TRACKED" });
    return { verdict: "NO-TRACKED", at: now };
  }

  const prev = readJson(FILE, { answered: [] });
  const answeredRows = Array.isArray(prev.answered) ? prev.answered : [];
  const answeredKeys = answeredRows.map((r) => String(r?.key ?? ""));
  const recentReplies = answeredRows.slice(-20).map((r) => String(r?.body ?? "")).filter(Boolean);

  /* read-only chain: replies per tracked post; selection is PER POST so the
   * SELF skip means "the post's own author", per-post, exactly */
  let anyComments = false;
  const skipTotals = {};
  let pick = null;
  const readErrors = [];
  for (const t of tracked) {
    let rows = [];
    try {
      const r = await rpcCall("condenser_api.get_content_replies", [t.author, t.permlink]);
      if (!r.ok) throw new Error(r.error ?? "rpc-failed");
      rows = Array.isArray(r.result) ? r.result : [];
    } catch (e) { readErrors.push(String(e?.message ?? e).slice(0, 80)); continue; }
    if (rows.length) anyComments = true;
    const sel = replySelectionLaw({ comments: rows, authorAccount: t.author, answeredKeys, nowMs });
    for (const [k, v] of Object.entries(sel.skipped ?? {})) skipTotals[k] = (skipTotals[k] ?? 0) + v;
    if (!pick && sel.verdict === "SELECTION" && sel.picks.length) pick = { ...sel.picks[0], post: t };
  }
  if (!pick) {
    const verdict = anyComments ? "REPLIES-NONE-ELIGIBLE" : "REPLIES-NONE";
    journal({ type: "reply.idle", at: now, verdict, scanned: tracked.length, skipped: skipTotals, readErrors });
    writeJsonAtomic(FILE, { ...(prev ?? {}), lastRunAt: now, lastVerdict: verdict, lastSkipped: skipTotals });
    return { verdict, skipped: skipTotals, readErrors, at: now };
  }

  const voice = pick.post.author;
  const persona = PERSONAS[voice];
  if (!persona || !persona.window) {
    journal({ type: "reply.blocked", at: now, verdict: "NO-PERSONA", voice });
    return { verdict: "NO-PERSONA", voice, at: now };
  }

  /* the bridge drafts — same bounded 2-attempt law as the seeds (T-34) */
  let raw = null, bridgeError = null;
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    try {
      const r = await fetch(`${BRIDGE}/api/saos/ai/community`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-saos-bridge": BRIDGE_TOKEN },
        body: JSON.stringify({
          mode: "reply",
          persona: { label: persona.label, topics: persona.topics, commentStyle: persona.commentStyle },
          parentComment: { author: pick.author, body: pick.body.slice(0, 1500) },
          postContext: { title: pick.post.title, excerpt: pick.post.body.slice(0, 700) },
          communityTag: COMMUNITY_TAG,
          exposureLaw: REPLY_LAW_ROWS,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`bridge ${r.status}`);
      const j = await r.json();
      if (j?.ok && typeof j?.reply?.body === "string" && j.reply.body.trim()) raw = { body: j.reply.body.trim() };
      else throw new Error(j?.error ?? "no-reply-in-bridge-json");
    } catch (e) { bridgeError = String(e?.message ?? e).slice(0, 160); }
  }
  if (!raw?.body) {
    journal({ type: "reply.blocked", at: now, verdict: "BRIDGE-DOWN", bridgeError, parent: `${pick.author}/${pick.permlink}` });
    writeJsonAtomic(FILE, { ...(prev ?? {}), lastRunAt: now, lastVerdict: "BRIDGE-DOWN", bridgeError });
    return { verdict: "BRIDGE-DOWN", bridgeError, at: now };
  }
  const draft = raw.body;

  /* §74R-2 — the reply-text lines §73d cannot see (dash tell, exposure,
   * repeat class vs our own past replies) */
  const sanity = replySanityLaw({ body: draft, recentReplies });
  if (sanity.verdict !== "PASS") {
    journal({ type: "reply.blocked", at: now, verdict: sanity.verdict, cls: sanity.cls, parent: `${pick.author}/${pick.permlink}` });
    writeJsonAtomic(FILE, { ...(prev ?? {}), lastRunAt: now, lastVerdict: sanity.verdict });
    return { verdict: `REPLY-${sanity.verdict}`, cls: sanity.cls, at: now };
  }

  /* §73d + persona caps/windows/spacing — the FULL comment gate, last */
  const gate = gateComment({ account: voice, body: draft, parentBody: pick.body, now: nowMs });
  if (!gate.allowed) {
    journal({ type: "reply.blocked", at: now, verdict: gate.verdict, voice, parent: `${pick.author}/${pick.permlink}` });
    writeJsonAtomic(FILE, { ...(prev ?? {}), lastRunAt: now, lastVerdict: `HUMANITY-${gate.verdict}` });
    return { verdict: `HUMANITY-${gate.verdict}`, voice, at: now };
  }

  /* §74R-3 — the op; permlink derived from the parent so it is unique and
   * human-readable ("re-<parentpermlink>-<ts36>") */
  const permlink = `re-${pick.permlink.slice(0, 60).toLowerCase().replace(/[^a-z0-9-]/g, "")}-${nowMs.toString(36)}`.slice(0, 200);
  const op = buildReplyOp({
    author: voice, permlink,
    parentAuthor: pick.author, parentPermlink: pick.permlink,
    body: draft, communityTag: COMMUNITY_TAG,
  });
  if (!op) {
    journal({ type: "reply.blocked", at: now, verdict: "OP-INVALID", parent: `${pick.author}/${pick.permlink}` });
    return { verdict: "OP-INVALID", at: now };
  }

  const res = await executeAs(voice, [op], { tag: "community-reply", role: "posting" });
  if (!res.ok) {
    journal({ type: "reply.blocked", at: now, verdict: "REPLY-FAIL", error: String(res.error ?? "").slice(0, 160), voice });
    writeJsonAtomic(FILE, { ...(prev ?? {}), lastRunAt: now, lastVerdict: "REPLY-FAIL" });
    return { verdict: "REPLY-FAIL", error: res.error ?? null, at: now };
  }

  /* chain-truth bookkeeping: the humanity journal counts it, the answered
   * journal seals the key forever (a double reply is now impossible) */
  recordComment({ account: voice, body: draft, ts: nowMs });
  const key = `${pick.author}/${pick.permlink}`;
  const next = {
    ...(prev ?? {}),
    lastRunAt: now,
    lastVerdict: "REPLY-POSTED",
    answered: [...answeredRows, { key, at: now, txid: res.txid ?? null, permlink, body: draft.slice(0, 300) }].slice(-200),
  };
  writeJsonAtomic(FILE, next);
  journal({ type: "reply.posted", at: now, parent: key, voice, txid: res.txid ?? null, permlink });
  return { verdict: "REPLY-POSTED", txid: res.txid ?? null, permlink, parent: key, voice, at: now };
}

function journal(row) { appendLine(EVENTS, row); }
