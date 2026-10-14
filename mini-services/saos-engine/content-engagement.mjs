/**
 * content-engagement.mjs — R306 · THE ENGAGEMENT READ-BACK (exec30, T-85)
 *
 * The last open item on the owner's Autonomous-Media-Agents menu: the
 * "what worked" feedback loop (the market-ldr/langchain advantage pattern —
 * measure what you published, learn from numbers, never speculate). R302
 * judges drafts, R303 remembers verdicts, R304 ladders concepts, R305
 * listens to the outside network — none of them ever looked BACK at the
 * chain to see how OUR OWN published posts actually performed. This module
 * closes that gap:
 *
 *   discover — (a) the fleet ledger cache (state/fleet-body-ledger.json,
 *              READ-ONLY via fleet-ledger loadCached: never loadOrBuild, no
 *              rebuild, no writes) + (b) chain truth:
 *              condenser_api.get_discussions_by_blog per account
 *              ("headcorner" + ARMY_ROSTER, self-authored root posts only,
 *              limit 5), deduped by author/permlink, last 14 days only,
 *              capped at 40.
 *   measure  — condenser_api.get_content per selected post (250ms spacing,
 *              15s timeouts, 3-node failover): votes (active_votes.length),
 *              netRha (net_rshares raw), replies (children), pendingSbd
 *              (pending_payout_value parsed), ageHours, top-3 tags from
 *              json_metadata.
 *   anchor   — chain head provenance: condenser_api.get_dynamic_global_property,
 *              falling back to the account's latest history op (the public
 *              proxy nodes serve the latter, not the former); absence is
 *              recorded honestly (source.chainHead=null) and does NOT flip
 *              the verdict — degraded means the MEASUREMENT lost data
 *              (failed accounts / post errors), never a missing nicety.
 *   aggregate— pure math ONLY: median votes/replies, means, totals, and
 *              top/bottom vote-quartile means + per-tag means. Numbers,
 *              never advice — the interpretation belongs to the owner (and
 *              to a future enforcement lane armed with measured evidence,
 *              R302's observe-first law).
 *   seal     — state/content-engagement.json {at, head, measured, posts,
 *              summary, signature:"sig:"+8hex(sha256 canonical)} rides the
 *              state-churn commits: sandbox deaths lose nothing (R303 law).
 *
 * LAWS (measured, not aspirational):
 *  - READ-ONLY on chain: get_discussions_by_blog + get_content +
 *    get_dynamic_global_property. Zero keys, zero broadcasts, zero votes.
 *    SOCIAL-STANDBY-compatible by construction — measuring our own published
 *    history is observation, not action.
 *  - OBSERVE-ONLY: never a gate. spamgate/R297/R301/R302 own publishing;
 *    this module writes one state file and one heartbeat receipt.
 *  - Chain-error per account → recorded degraded, never crash; exit-0 by
 *    design (a broken RPC is a verdict, not a wedge).
 *  - Zero npm deps (node builtins + global fetch only). Pure where testable:
 *    aggregateEngagement/selectRecent/parseTags/recordFromContent/
 *    signEngagement take no clock, no randomness, no network.
 *  - Memory linkage is READ-ONLY by import boundary: this module never edits
 *    content-memory.mjs logic (the linkage note lives in the state doc's
 *    cousin files, not in that module's behavior).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ARMY_ROSTER } from "./army-social.mjs";
import { loadCached } from "./fleet-ledger.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);

export const ENGAGEMENT_WINDOW_DAYS = 14;   // "what worked lately" window
export const MAX_POSTS = 40;                // cap of measured posts per beat
export const SPACING_MS = 250;              // gentle spacing between RPC calls
export const RPC_TIMEOUT_MS = 15000;        // per-request timeout
export const DISCOVER_PER_ACCOUNT = 5;      // get_discussions_by_blog limit
export const STEEM_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steem-rpc.publicnode.com",
];

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, Number(ms) || 0));

/* ── pure: tags from json_metadata (top 3) ───────────────────────────────── */
export function parseTags(jsonMetadata) {
  let md = jsonMetadata;
  if (typeof md === "string") {
    try { md = JSON.parse(md); } catch { return []; }
  }
  if (!md || typeof md !== "object") return [];
  const tags = Array.isArray(md.tags) ? md.tags : [];
  return tags.filter((t) => typeof t === "string" && t.length > 0).slice(0, 3);
}

/* ── pure: median (null on empty) ────────────────────────────────────────── */
export function median(nums) {
  const a = (Array.isArray(nums) ? nums : []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/* ── pure: one verdict-only per-post record from a get_content result ────── */
export function recordFromContent(content, { now, author = null, permlink = null, created = null } = {}) {
  if (!content || typeof content !== "object") return null;
  const createdIso = content.created ?? created ?? null;
  const t = Date.parse(createdIso ?? "");
  const nowMs = Date.parse(now ?? new Date().toISOString());
  const children = Number(content.children);
  const ppv = parseFloat(String(content.pending_payout_value ?? ""));
  return {
    author: content.author ?? author,
    permlink: content.permlink ?? permlink,
    created: Number.isFinite(t) ? createdIso : null,
    ageHours: Number.isFinite(t) && Number.isFinite(nowMs) ? r1((nowMs - t) / 3600000) : null,
    votes: Array.isArray(content.active_votes) ? content.active_votes.length : 0,
    netRha: content.net_rshares === undefined || content.net_rshares === null ? null : String(content.net_rshares),
    replies: Number.isFinite(children) ? children : 0,
    pendingSbd: Number.isFinite(ppv) ? ppv : null,
    tags: parseTags(content.json_metadata),
  };
}

/* ── pure: last-14-days filter + newest-first + cap ──────────────────────── */
export function selectRecent(candidates, { now, windowDays = ENGAGEMENT_WINDOW_DAYS, cap = MAX_POSTS } = {}) {
  const nowMs = Date.parse(now ?? new Date().toISOString());
  const inWindow = (c) => {
    const t = Date.parse(c?.created ?? "");
    return Number.isFinite(t) && Number.isFinite(nowMs) && nowMs - t >= 0 && nowMs - t <= windowDays * 86400000;
  };
  return (Array.isArray(candidates) ? candidates : [])
    .filter(inWindow)
    .sort((a, b) =>
      Date.parse(b.created) - Date.parse(a.created) ||
      String(a.author ?? "").localeCompare(String(b.author ?? "")) ||
      String(a.permlink ?? "").localeCompare(String(b.permlink ?? "")))
    .slice(0, Math.max(0, cap));
}

/* ── pure: the honest summary — numbers only, no advice text ─────────────── */
export function aggregateEngagement(records) {
  const recs = (Array.isArray(records) ? records : []).filter((r) => r && typeof r === "object");
  const n = recs.length;
  const fin = (xs) => xs.filter((x) => Number.isFinite(x));
  const mean = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const votes = fin(recs.map((r) => r.votes));
  const replies = fin(recs.map((r) => r.replies));
  const q = n >= 4 ? Math.floor(n / 4) : Math.min(n, 1);
  const ranked = [...recs].sort((a, b) =>
    (Number(b.votes) || 0) - (Number(a.votes) || 0) ||
    (Number(b.replies) || 0) - (Number(a.replies) || 0) ||
    String(a.author ?? "").localeCompare(String(b.author ?? "")) ||
    String(a.permlink ?? "").localeCompare(String(b.permlink ?? "")));
  const qStats = (slice) => ({
    n: slice.length,
    votes: mean(fin(slice.map((r) => Number(r.votes)))),
    replies: mean(fin(slice.map((r) => Number(r.replies)))),
  });
  const tally = {};
  for (const rec of recs) {
    for (const tag of (Array.isArray(rec.tags) ? rec.tags : []).slice(0, 3)) {
      const b = tally[tag] ?? (tally[tag] = { posts: 0, votesSum: 0, repliesSum: 0 });
      b.posts++;
      if (Number.isFinite(rec.votes)) b.votesSum += rec.votes;
      if (Number.isFinite(rec.replies)) b.repliesSum += rec.replies;
    }
  }
  const byTag = {};
  for (const tag of Object.keys(tally)) {
    byTag[tag] = { posts: tally[tag].posts, votes: r1(tally[tag].votesSum / tally[tag].posts), replies: r1(tally[tag].repliesSum / tally[tag].posts) };
  }
  return {
    posts: n,
    medianVotes: median(votes),
    medianReplies: median(replies),
    meanVotes: mean(votes),
    meanReplies: mean(replies),
    totalVotes: votes.reduce((a, b) => a + b, 0),
    totalReplies: replies.reduce((a, b) => a + b, 0),
    topQuartile: qStats(ranked.slice(0, q)),
    bottomQuartile: qStats(ranked.slice(n - q)),
    byTag,
    windowDays: ENGAGEMENT_WINDOW_DAYS,
  };
}

/* ── pure: the most-published tag (tie: best mean votes, then lexicographic)
 *    — a fact, not a recommendation ─────────────────────────────────────── */
export function topTagFromSummary(summary) {
  const entries = Object.entries(summary?.byTag ?? {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1].posts - a[1].posts || b[1].votes - a[1].votes || String(a[0]).localeCompare(String(b[0])));
  return entries[0][0];
}

/* ── pure: canonical form + the state seal (sig:8hex over sha256) ────────── */
export function stableStringify(v) {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
export function signEngagement(doc) {
  const { signature, ...rest } = doc ?? {};
  return "sig:" + createHash("sha256").update(stableStringify(rest ?? {})).digest("hex").slice(0, 8);
}

/* ── HEAD sha (read-only; never fatal — presence-matrix contract) ────────── */
function headSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/* ── RPC with 3-node failover (fleet-ledger node law, injectable seam:
 *    fetchImpl is for the offline selftest ONLY; production uses global
 *    fetch) ────────────────────────────────────────────────────────────── */
async function rpc(fetchImpl, method, params, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  const errs = [];
  for (const node of STEEM_NODES) {
    try {
      const doFetch = fetchImpl ?? ((u, o) => fetch(u, o));
      const res = await doFetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(timeoutMs) });
      if (!res?.ok) throw new Error(`HTTP ${res?.status ?? "?"}`);
      const j = await res.json();
      if (j?.result !== undefined) return j.result;
      throw new Error(j?.error?.message ? String(j.error.message).slice(0, 80) : "no-result");
    } catch (e) {
      errs.push(`${new URL(node).host}: ${String(e?.message ?? e).slice(0, 60)}`);
    }
  }
  throw new Error(`content-engagement: all-steem-nodes-failed · ${errs.join(" | ")}`.slice(0, 200));
}

/* ── the measurement pass (discover → select → measure) ──────────────────── */
export async function measureEngagement({
  accounts = null,
  ledgerPosts = null,
  now = null,
  fetchImpl = null,
  spacingMs = SPACING_MS,
  rpcTimeoutMs = RPC_TIMEOUT_MS,
  windowDays = ENGAGEMENT_WINDOW_DAYS,
  cap = MAX_POSTS,
} = {}) {
  const at = now ?? new Date().toISOString();
  const roster = Array.isArray(accounts) && accounts.length ? accounts : ["headcorner", ...ARMY_ROSTER];

  /* (a) fleet ledger — READ-ONLY cache (entries carried in, chain wins on dedupe) */
  const candidates = new Map();
  let ledgerEntries = 0;
  for (const p of Array.isArray(ledgerPosts) ? ledgerPosts : []) {
    if (p?.author && p?.permlink && p?.created) {
      candidates.set(`${p.author}/${p.permlink}`, { author: p.author, permlink: p.permlink, created: p.created });
      ledgerEntries++;
    }
  }

  /* (b) chain truth — blog scan per roster account, self-authored roots only */
  const failedAccounts = [];
  let chainDiscovered = 0;
  for (const acc of roster) {
    try {
      const disc = await rpc(fetchImpl, "condenser_api.get_discussions_by_blog", [{ tag: acc, limit: DISCOVER_PER_ACCOUNT }], { timeoutMs: rpcTimeoutMs });
      for (const p of Array.isArray(disc) ? disc : []) {
        if (p?.author !== acc) continue;                                   // reblogs are not "our published"
        if (typeof p?.depth === "number" && p.depth !== 0) continue;       // roots only
        if (!candidates.has(`${p.author}/${p.permlink}`)) chainDiscovered++;
        candidates.set(`${p.author}/${p.permlink}`, { author: p.author, permlink: p.permlink, created: p.created });
      }
    } catch (e) {
      failedAccounts.push({ account: acc, error: String(e?.message ?? e).slice(0, 80) });
    }
    if (spacingMs > 0) await sleep(spacingMs);
  }

  const all = [...candidates.values()];
  const selected = selectRecent(all, { now: at, windowDays, cap });

  /* chain head anchor (provenance only — canonical DGPO first, then the
   * latest history op the proxy nodes actually serve; null stays honest) */
  let head = null;
  try {
    const g = await rpc(fetchImpl, "condenser_api.get_dynamic_global_property", [], { timeoutMs: rpcTimeoutMs });
    head = g?.head_block_number !== undefined ? { block: g.head_block_number, time: g.time ?? null, via: "dgpo" } : null;
  } catch {
    try {
      const h = await rpc(fetchImpl, "condenser_api.get_account_history", [roster[0] ?? "headcorner", -1, 0], { timeoutMs: rpcTimeoutMs });
      const row = Array.isArray(h) && h.length ? h[h.length - 1] : null;
      head = row && row[1] && row[1].block !== undefined ? { block: row[1].block, time: row[1].timestamp ?? null, via: "account-history-latest-op" } : null;
    } catch { head = null; }
  }

  /* measure each selected post fresh */
  const records = [];
  let postErrors = 0;
  for (const c of selected) {
    try {
      const content = await rpc(fetchImpl, "condenser_api.get_content", [c.author, c.permlink], { timeoutMs: rpcTimeoutMs });
      const rec = recordFromContent(content, { now: at, author: c.author, permlink: c.permlink, created: c.created });
      if (rec) records.push(rec); else postErrors++;
    } catch {
      postErrors++;
    }
    if (spacingMs > 0) await sleep(spacingMs);
  }

  return {
    at,
    roster,
    records,
    failedAccounts,
    postErrors,
    head,
    counts: { ledgerEntries, chainDiscovered, deduped: all.length, inWindow: selected.length },
  };
}

function readLedgerPosts(stateDir) {
  try { return loadCached(stateDir)?.posts ?? []; } catch { return []; }
}

/* ── heartbeat step body (ci-cycle "content-engagement"): measure →
 *    aggregate → seal into state/content-engagement.json. Never throws —
 *    a chain outage is an honest degraded receipt, exit-0 by design. ────── */
export async function runEngagement(opts = {}) {
  const stateDir = opts.stateDir ?? process.env.SAOS_STATE_DIR ?? path.join(DIR, "state");
  try {
    const m = await measureEngagement({ ...opts, ledgerPosts: opts.ledgerPosts ?? readLedgerPosts(stateDir) });
    const s = aggregateEngagement(m.records);
    /* degraded = the MEASUREMENT lost data (accounts/posts); a missing head
     * anchor is provenance-honest (source.chainHead=null), never a cry of wolf */
    const degraded = m.failedAccounts.length > 0 || m.postErrors > 0;
    const verdict = m.records.length
      ? (degraded ? "ENGAGEMENT-DEGRADED" : "ENGAGEMENT-OK")
      : (degraded ? "ENGAGEMENT-DEGRADED" : "ENGAGEMENT-NONE");
    const doc = {
      at: m.at,
      head: headSha(),
      verdict,
      measured: m.records.length,
      observe: true, /* R306: read-back evidence, never a gate */
      accounts: { probed: m.roster.length, failed: m.failedAccounts },
      postErrors: m.postErrors,
      source: { ...m.counts, chainHead: m.head },
      posts: m.records,
      summary: s,
    };
    const docSigned = { ...doc, signature: signEngagement(doc) };
    let fileWritten = false;
    try {
      const file = path.join(stateDir, "content-engagement.json");
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(docSigned, null, 2));
      fs.renameSync(tmp, file);
      fileWritten = true;
    } catch { /* read-only worktree → the heartbeat receipt still carries the numbers */ }
    return {
      verdict,
      at: m.at,
      measured: m.records.length,
      medianVotes: s.medianVotes,
      medianReplies: s.medianReplies,
      topTag: topTagFromSummary(s),
      degraded,
      failedAccounts: m.failedAccounts.length,
      postErrors: m.postErrors,
      fileWritten,
      signature: docSigned.signature,
    };
  } catch (e) {
    return {
      verdict: "ENGAGEMENT-ERROR",
      at: opts.now ?? new Date().toISOString(),
      measured: 0,
      degraded: true,
      error: String(e?.message ?? e).slice(0, 160),
    };
  }
}
