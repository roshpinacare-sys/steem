/**
 * twophase.mjs — T-564 · TWO-PHASE IDEMPOTENT ORDER COMMIT (the AutoHedge gem).
 * ═══════════════════════════════════════════════════════════════════════════
 * ABSORPTION PROVENANCE (owner order, T-560 study of
 * github.com/The-Swarm-Corporation/AutoHedge): AutoHedge's one real gem is
 * the two-phase order commit — an unsigned QUOTE is persisted with a
 * requestId BEFORE anything is signed/submitted, and the submit settles the
 * stored intent (CONFIRMED/FAILED) so a retry can never double-fire.
 *
 * ADAPTATION TO THE GRID (measured failure class this closes): the grid's
 * diff discipline already re-reads live open orders every tick, so a
 * broadcast that landed AND a healthy next tick sees it (no duplicate).
 * The residual duplicate class is the UNKNOWN-OUTCOME window: the broadcast
 * lands on chain but the response is lost (timeout / crash before the state
 * write), and the next tick re-plans the SAME price level with a NEW orderid
 * — a second order at the same price until TTL. The law here:
 *
 *   PHASE 1 (intent): before executeAs, journal every planned create with a
 *   CONTENT key = sha256(account|side|amount3|min_to_receive3) — NOT the
 *   orderid, because the failure mode re-mints orderids; content is the
 *   invariant. Status PENDING.
 *
 *   PHASE 2 (settle): after executeAs → CONFIRMED (txid) or ABANDONED
 *   (typed error). And the chain-judge sweep: any PENDING older than
 *   settleAfterMs is settled BY THE CHAIN — its content matched against the
 *   account's live open orders (amounts, not just ids): present ⇒
 *   CONFIRMED-BY-CHAIN, absent ⇒ ABANDONED-STALE. Never assume; probe.
 *
 *   GUARD: while a create is PENDING (outcome unknown, age < settleAfterMs)
 *   the SAME content level is not re-created this tick — the guard holds
 *   the young window open until the chain judges. Old PENDINGs never
 *   block: the sweep resolves them before the plan.
 *
 * LAWS INHERITED: single-writer (army-grid owns these files), atomic-write,
 * zero key material here (this module never signs — executeAs stays the
 * ONE rail), fail-honest (every state transition is journaled).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { openOrders } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const AG_DIR = path.join(DIR, "state", "army-grid");

/* outcome-unknown window; matches the presence TTL (conf.ttlSec) by default */
const SETTLE_AFTER_MS = 90_000;
/* settled rows older than this are pruned (the journal stays small) */
const PRUNE_AFTER_MS = 24 * 3600_000;
const MAX_ENTRIES = 80;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, p);
};

const commitFile = (account) => path.join(AG_DIR, `${account}-commits.json`);

/* the CONTENT key — orderid deliberately excluded (see header) */
export function createContentKey(account, { side, amt, min }) {
  return crypto.createHash("sha256")
    .update(`${account}|${side}|${Number(amt).toFixed(3)}|${Number(min).toFixed(3)}`)
    .digest("hex").slice(0, 24);
}

function loadJournal(account) {
  const j = readJson(commitFile(account), null);
  return j && Array.isArray(j.entries) ? j : { entries: [] };
}

function saveJournal(account, j) {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  j.entries = (j.entries || [])
    .filter((e) => (e.settledAt ? Date.parse(e.settledAt) : Date.parse(e.at)) > cutoff)
    .slice(-MAX_ENTRIES);
  writeJson(commitFile(account), j);
}

/* PHASE 1 — journal intent BEFORE signing. creates: [{key, side, amt, min, orderid}] */
export function journalPendingCreates(account, creates) {
  if (!creates?.length) return 0;
  const j = loadJournal(account);
  const now = new Date().toISOString();
  let n = 0;
  for (const c of creates) {
    if (!c?.key) continue;
    j.entries.push({
      key: c.key, account, kind: "create", side: c.side,
      amt: Number(c.amt), min: Number(c.min), orderid: c.orderid ?? null,
      status: "PENDING", at: now, settledAt: null, txid: null, note: null,
    });
    n++;
  }
  if (n) saveJournal(account, j);
  return n;
}

/* PHASE 2 — settle after the rail answers (all-or-nothing per broadcast) */
export function markCommits(account, keys, status, { txid = null, note = null } = {}) {
  if (!keys?.length) return 0;
  const j = loadJournal(account);
  const now = new Date().toISOString();
  const set = new Set(keys);
  let n = 0;
  for (const e of j.entries) {
    if (set.has(e.key) && e.status === "PENDING") {
      e.status = status; e.settledAt = now; e.txid = txid; e.note = note;
      n++;
    }
  }
  if (n) saveJournal(account, j);
  return n;
}

/* content match of a journal row against a live open order (AMOUNTS, not ids) */
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

function liveMatches(entry, order) {
  if (order.side !== entry.side) return false;
  /* base/quote strings from condenser: "123.456 STEEM" / "45.678 SBD" */
  const [bAmt, bSym] = String(order.base ?? "").split(" ");
  const [qAmt, qSym] = String(order.quote ?? "").split(" ");
  const b = Number(bAmt), q = Number(qAmt);
  if (!Number.isFinite(b) || !Number.isFinite(q)) return false;
  if (entry.side === "ask") return near(b, entry.amt) && qSym === "SBD" && near(q, entry.min);
  return near(b, entry.amt) && qSym === "STEEM" && near(q, entry.min);
}

/* PHASE 2 (chain-judge) — settle every PENDING older than the window by
 * probing the account's live open orders. Returns {pending, settled, byChain, stale}.
 * Rare path: one openOrders RPC only when an old PENDING actually exists. */
export async function settleCommits(account, { settleAfterMs = SETTLE_AFTER_MS } = {}) {
  const j = loadJournal(account);
  const nowMs = Date.now();
  const old = (j.entries || []).filter((e) => e.status === "PENDING" && nowMs - Date.parse(e.at) > settleAfterMs);
  const summary = { pending: (j.entries || []).filter((e) => e.status === "PENDING").length, settled: 0, byChain: 0, stale: 0 };
  if (!old.length) return summary;
  const oo = await openOrders(account);
  const live = oo.ok ? (oo.orders ?? []) : null; /* null = probe failed: leave PENDING (honest unknown) */
  if (live) {
    const now = new Date().toISOString();
    for (const e of old) {
      const hit = live.find((o) => liveMatches(e, o));
      e.status = hit ? "CONFIRMED-BY-CHAIN" : "ABANDONED-STALE";
      e.settledAt = now;
      e.note = hit ? `live orderid ${hit.orderid}` : "absent from live open orders at settle probe";
      summary.settled++; if (hit) summary.byChain++; else summary.stale++;
    }
    saveJournal(account, j);
  }
  return summary;
}

/* GUARD — keys whose outcome is still unknown (young PENDING): these levels
 * must not be re-created this tick. Old PENDINGs never reach here: settle
 * runs before the plan each tick. */
export function guardedKeys(account, { settleAfterMs = SETTLE_AFTER_MS } = {}) {
  const j = loadJournal(account);
  const nowMs = Date.now();
  const out = new Set();
  for (const e of j.entries || []) {
    if (e.status === "PENDING" && nowMs - Date.parse(e.at) <= settleAfterMs) out.add(e.key);
  }
  return out;
}

/* state for /army-grid (read-only, tiny) */
export function commitsSummary(account) {
  const j = loadJournal(account);
  const c = { pending: 0, confirmed: 0, byChain: 0, abandoned: 0 };
  for (const e of j.entries || []) {
    if (e.status === "PENDING") c.pending++;
    else if (e.status === "CONFIRMED") c.confirmed++;
    else if (e.status === "CONFIRMED-BY-CHAIN") c.byChain++;
    else if (e.status === "ABANDONED-STALE" || e.status === "ABANDONED") c.abandoned++;
  }
  return c;
}
