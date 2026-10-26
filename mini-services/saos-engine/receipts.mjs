/**
 * receipts.mjs — T-37 · THE RECEIPT SCORER (the reef laws, adopted T-36:
 * receipt-scored feedback + payout-window-as-score).
 *
 * THE GAP MEASURED (T-36 verdict): content drafts have carried real
 * txid+permlink since T-31, but no scorer ever closed the loop — the world's
 * response (votes, payouts) went unread. The chain GRADES every post: a
 * post pays out exactly 7 days after broadcast; until then its
 * pending_payout_value and net_votes are live chain truth; after cashout
 * total_payout_value IS the settled verdict.
 *
 * LAWS:
 *  - READ-ONLY: zero signing, runs with or without a credential.
 *  - BOUNDED: last 20 posted drafts of the content queue (one cheap
 *    condenser_api.get_content each), never floods the RPC.
 *  - SINGLE-PRICER LAW: raw chain SBD numbers only, NEVER priced to USD
 *    here — the economics rollup is the one pricer.
 *  - THE WINDOW IS THE JUDGE: pending is recorded, never scored; only
 *    SETTLED (paid) receipts enter the score — the machine is not graded
 *    by a window that has not spoken.
 *  - everything journaled: state/receipts.json — the learning layer (T-37
 *    selection policy) ingests it as measured feedback.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { masterAccount } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "receipts.json");
const CONTENT_FILE = path.join(STATE, "content-ops.json");
const MAX_RECEIPTS = 20; // bounded scan — the rail is doctrine-capped anyway

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

export function receiptsState() { return readJson(FILE, null); }

/* ── pure core (selftest vectors live in selftest.mjs) ─────────────────── */

/** "0.012 SBD" → 0.012 · junk/garbage → 0 (chain amount strings only) */
export function amountOf(s) {
  const n = Number(String(s ?? "0").split(" ")[0]);
  return Number.isFinite(n) ? n : 0;
}

/** pure: payout phase from a condenser content row. cashout_time is
 * chain-UTC (no Z suffix) — treat as UTC explicitly. */
export function receiptPhase(row, nowMs) {
  if (!row || typeof row !== "object" || !row.author) return "missing";
  const t = Date.parse(String(row.cashout_time ?? "").includes("T") ? `${row.cashout_time}Z` : "");
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return "unknown";
  return nowMs >= t ? "paid" : "pending";
}

/** pure: the receipt of one post — chain truth only, no invention.
 * Voter identities are NOT kept (bounded evidence: counts, not the roster). */
export function receiptOf(row, { permlink = null, postedAt = null, title = null } = {}) {
  if (!row || typeof row !== "object" || !row.author) return null;
  const cashoutRaw = String(row.cashout_time ?? "");
  const cashoutMs = Date.parse(cashoutRaw.includes("T") ? `${cashoutRaw}Z` : "");
  return {
    author: String(row.author),
    permlink: String(row.permlink ?? permlink ?? ""),
    title: String(title ?? row.title ?? "").slice(0, 160),
    postedAt,
    cashoutAt: Number.isFinite(cashoutMs) ? new Date(cashoutMs).toISOString() : null,
    netVotes: Number.isFinite(Number(row.net_votes)) ? Number(row.net_votes) : 0,
    replies: Number.isFinite(Number(row.children)) ? Number(row.children) : 0,
    voters: Array.isArray(row.active_votes) ? row.active_votes.length : 0,
    pendingSbd: Math.round(amountOf(row.pending_payout_value) * 1e6) / 1e6,
    totalSbd: Math.round(amountOf(row.total_payout_value) * 1e6) / 1e6,
    curatorSbd: Math.round(amountOf(row.curator_payout_value) * 1e6) / 1e6,
  };
}

/** pure: THE SCORE — the window's verdict only. Pending receipts score
 * null (the world has not finished grading); paid receipts score their
 * settled author value. Two posts score ONLY after their cashouts. */
export function receiptScore(receipt) {
  if (!receipt) return null;
  return receipt.phase === "paid" ? receipt.totalSbd : null;
}

/** pure: rail-level aggregation — the number the selection policy reads.
 * paidSbdTotal is the settled verdict sum; votesTotal is the live channel
 * over ALL receipts; pending is honestly present, never scored. */
export function railScore(receipts) {
  const rs = (Array.isArray(receipts) ? receipts : []).filter(Boolean);
  const by = (phase) => rs.filter((r) => r.phase === phase).length;
  const round6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    posted: rs.length,
    paid: by("paid"),
    pending: by("pending"),
    missing: by("missing") + by("unknown"),
    votesTotal: rs.reduce((s, r) => s + (r.netVotes ?? 0), 0),
    pendingSbdTotal: round6(rs.reduce((s, r) => s + (r.pendingSbd ?? 0), 0)),
    paidSbdTotal: round6(rs.reduce((s, r) => s + (r.phase === "paid" ? (r.totalSbd ?? 0) : 0), 0)),
  };
}

/* ── the IO pass (called from the daily cycle's receipts step) ──────────── */

export async function runReceipts({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const nowMs = Date.parse(now);
  const master = masterAccount();
  const content = readJson(CONTENT_FILE, null);
  const queue = Array.isArray(content?.queue) ? content.queue : [];
  const posted = queue
    .filter((d) => d?.status === "posted" && d?.permlink)
    .sort((a, b) => String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")))
    .slice(0, MAX_RECEIPTS);

  if (!posted.length) {
    const out = {
      at: now, verdict: "NO-POSTED-YET", scanned: 0, errors: 0,
      rail: railScore([]), receipts: [], law: LAW, ms: Date.now() - t0,
    };
    writeJson(FILE, out);
    return out;
  }

  let errors = 0;
  const receipts = [];
  for (const d of posted) {
    try {
      const r = await rpcCall("condenser_api.get_content", [master, d.permlink]);
      const row = r.ok ? r.result : null;
      const rec = receiptOf(row, { permlink: d.permlink, postedAt: d.postedAt ?? null, title: d.title ?? null });
      if (!rec) { errors++; continue; }
      rec.phase = receiptPhase(row, nowMs);
      rec.score = receiptScore(rec);
      receipts.push(rec);
    } catch { errors++; }
  }

  const rail = railScore(receipts);
  const out = {
    at: now,
    verdict: errors === posted.length ? "SCAN-FAILED" : "RECEIPTS-MEASURED",
    scanned: posted.length,
    errors,
    rail,
    receipts: receipts.sort((a, b) => String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? ""))),
    law: LAW,
    ms: Date.now() - t0,
  };
  writeJson(FILE, out);
  return out;
}

const LAW = "החלון-הוא-הבוחן: קבלה נמדדת רק אחרי cashout (7 ימים מהשידור) — pending נרשם-ביושר ולעולם לא נכנס-לציון; מספרי-SBD גולמיים בלבד (חוק-המתמחר-היחיד); סריקה חסומה ל-20 השידורים-האחרונים";

if (import.meta.url === `file://${process.argv[1]}`) {
  runReceipts({ now: new Date().toISOString() }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("RECEIPTS-FAIL", e); process.exit(1); });
}
