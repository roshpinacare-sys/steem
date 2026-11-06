#!/usr/bin/env node
/**
 * fill-kpi.mjs — the standing KPI rail for the ONE number the doctrine owns:
 * REAL FILLS. Blueprint KPI #1 (Sovereign Engineering Blueprint 2026-11-06):
 * "fills/24h" — ops measure presence; fills measure trades (T-18 law).
 *
 * What it does (read-only on chain, additive receipts):
 *   1. scans account history 24h (paged, node caps get_account_history at 100)
 *   2. counts creates / cancels / fills via the engine's own pure
 *      chain-truth counters (countDayOrderOpsFromHistory + countDayFillsFromHistory
 *      from ../mini-services/saos-engine/lib.mjs — reused, never reinvented)
 *   3. reads the live book of the account (open orders) vs the witness median
 *      feed → best ask / best bid / own spread in bps
 *   4. appends ONE honest JSONL line to receipts/fill-kpi.jsonl
 *
 * Run: node ops/fill-kpi.mjs [account]     (default: headcorner)
 * Laws: no keys needed, no writes to chain, no secrets printed, honest SKIP
 * on RPC failure. This file is additive — it modifies no engine code.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const DIR = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, "..");
const ENGINE = path.join(REPO, "mini-services", "saos-engine", "lib.mjs");
const RECEIPTS = path.join(REPO, "receipts", "fill-kpi.jsonl");
const RPC = process.env.STEEM_RPC ?? "https://api.steemit.com";
const HOURS = Number(process.env.KPI_HOURS ?? 24);
const PAGE = 100; // condenser hard cap measured 2026-11-06
const MAX_PAGES = 30; // 3000 ops ≈ covers a quiet day; honest about coverage

const account = String(process.argv[2] ?? "headcorner").trim();

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const j = await res.json();
  if (!j.result) throw new Error(j.error?.message ?? "rpc-no-result");
  return j.result;
}

const parseAsset = (s) => {
  const m = String(s ?? "").trim().match(/^([\d.]+)\s+(SBD|STEEM|VESTS)$/);
  return m ? { v: Number(m[1]), sym: m[2] } : null;
};

async function main() {
  const { countDayOrderOpsFromHistory, countDayFillsFromHistory } = await import(
    url.pathToFileURL(ENGINE).href
  );

  const now = new Date();
  const cutoff = new Date(now.getTime() - HOURS * 3600_000).toISOString().replace("+00:00", "Z");

  // 1. paged backward scan (client-side window: filter-op form is refused by
  //    the node we measured: "upper limit is 100" + filter assert fail)
  const rows = [];
  let start = -1;
  let pages = 0;
  let oldest = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    let h;
    try {
      h = await rpc("condenser_api.get_account_history", [account, start, PAGE]);
    } catch (e) {
      console.log(`[fill-kpi] SKIP (honest): history read failed at page ${p}: ${String(e.message).slice(0, 120)}`);
      process.exit(0);
    }
    const items = Array.isArray(h) ? h : (h?.history ?? []); // node round-robin: some return the bare array, some wrap it
    pages++;
    let stop = false;
    for (const [, ev] of items) {
      oldest = ev.timestamp;
      if (ev.timestamp < cutoff) { stop = true; break; }
      rows.push(ev);
    }
    if (stop || items.length < PAGE) break;
    start = items[0][0] - 1;
  }

  const today = now.toISOString().slice(0, 10);
  // chain-truth counters are day-scoped by design; for a rolling 24h window we
  // aggregate from the SAME scanned rows with the day counter's parser laws
  // (the counters take rows + owner + day — we call them per covered day and
  // sum; days = the UTC days touched by the window, honest about the boundary)
  const days = [...new Set(rows.map((e) => e.timestamp.slice(0, 10)))];
  let creates = 0, cancels = 0, fills = 0, steemIn = 0, steemOut = 0, sbdIn = 0, sbdOut = 0;
  for (const d of days) {
    const ops = countDayOrderOpsFromHistory(rows, account, d);
    if (ops) { creates += ops.creates; cancels += ops.cancels; }
    const f = countDayFillsFromHistory(rows, account, d);
    if (f) { fills += f.fills; steemIn += f.steemIn; steemOut += f.steemOut; sbdIn += f.sbdIn; sbdOut += f.sbdOut; }
  }

  // 2. live book vs witness feed
  let book = null;
  try {
    const orders = await rpc("condenser_api.get_open_orders", [account]);
    const asks = [], bids = [];
    for (const o of orders) {
      const b = parseAsset(o.sell_price?.base), q = parseAsset(o.sell_price?.quote);
      if (!b || !q || !(b.v > 0) || !(q.v > 0)) continue;
      if (b.sym === "STEEM" && q.sym === "SBD") asks.push(q.v / b.v);
      else if (b.sym === "SBD" && q.sym === "STEEM") bids.push(b.v / q.v);
    }
    const med = await rpc("condenser_api.get_current_median_history_price", []);
    const mb = parseAsset(med.base), mq = parseAsset(med.quote);
    const parity = mb && mq && mb.v > 0 && mq.v > 0
      ? (mb.sym === "SBD" ? mb.v / mq.v : mq.v / mb.v) : null;
    asks.sort((a, b) => a - b);
    bids.sort((a, b) => b - a);
    book = {
      openOrders: orders.length,
      asks: asks.length, bids: bids.length,
      bestAsk: asks[0] ?? null, bestBid: bids[0] ?? null,
      ownSpreadBps: asks[0] && bids[0] ? Math.round((asks[0] / bids[0] - 1) * 1e4) : null,
      bestAskVsParityBps: asks[0] && parity ? Math.round((asks[0] / parity - 1) * 1e4) : null,
      bestBidVsParityBps: bids[0] && parity ? Math.round((bids[0] / parity - 1) * 1e4) : null,
      witnessParity: parity,
    };
  } catch (e) {
    book = { error: String(e.message).slice(0, 120) };
  }

  const line = {
    ts: now.toISOString().replace("+00:00", "Z"),
    account, windowHours: HOURS,
    coverage: { pages, oldestTs: oldest, coversWindow: oldest ? oldest <= cutoff : false, rows: rows.length },
    ops: { creates, cancels, churnTotal: creates + cancels },
    fills: { count: fills, steemIn: Math.round(steemIn * 1000) / 1000, steemOut: Math.round(steemOut * 1000) / 1000, sbdIn: Math.round(sbdIn * 1000) / 1000, sbdOut: Math.round(sbdOut * 1000) / 1000 },
    book,
    verdict: fills > 0 ? "TRADING" : creates + cancels > 0 ? "CHURN-NO-FILLS" : "IDLE",
  };

  try {
    fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true });
    fs.appendFileSync(RECEIPTS, JSON.stringify(line) + "\n");
  } catch { /* fail-soft: stdout verdict stands */ }

  console.log(JSON.stringify(line));
}

main().catch((e) => { console.error(`[fill-kpi] FATAL: ${String(e?.message ?? e).slice(0, 200)}`); process.exit(1); });
