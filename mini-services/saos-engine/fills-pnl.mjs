/**
 * fills-pnl.mjs — T-564 · PER-FILL P&L ATTRIBUTION → CAPITAL ROUTING.
 * ═══════════════════════════════════════════════════════════════════════════
 * ABSORPTION PROVENANCE (owner order, T-560 study of
 * github.com/The-Swarm-Corporation/AutoHedge): AutoHedge's 300k-row grid CSV
 * carries per-fill PnL attribution — the ledger that turns "ops" (presence)
 * into "trades" (profit). The owner's own words made this the missing rung:
 * the grid layer measured PRESENCE (opsToday) but never PROFIT (fills → PnL).
 *
 * THE LAW (honest by construction):
 *   - fills come from the CHAIN: fill_order ops in account history (both
 *     sides normalized to steem/sbd amounts — same parser law as measureAll).
 *   - cursor law: PnL is measured from ADOPTION onward (first sweep pins the
 *     cursor at the newest history index; nothing retrospective is guessed).
 *   - average-cost basis in SBD terms: bid fills build the STEEM position's
 *     cost; ask fills realize (price − avgCost) × qty. An ask with no basis
 *     is a BASIS-GAP (counted honestly, PnL contribution 0) — never invented.
 *   - routing is a PROPOSAL ONLY: this module never transfers, never
 *     delegates, never signs. The R39 fuel lane owns movement; this module
 *     publishes the measured routing table (state/army-grid/pnl/routing.json)
 *     that the fuel/finance lanes may consume. The army-grid doc's law stands:
 *     "it is not a writer of transfers/delegations".
 *   - pagination is bounded (pages × window) and fail-soft per hand.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountHistory } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PNL_DIR = path.join(DIR, "state", "army-grid", "pnl");

const PAGES = 8;            /* 8 × 1000 ops bounded walk-back */
const WINDOW = 1000;
const SWEEP_GAP_MS = 350;   /* gentle on the nodes */
const DAY = 86_400_000;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, p);
};

const NAI = { "@@000000021": "STEEM", "@@000000013": "SBD", "@@000000037": "VESTS" };
const amt = (x) => {
  if (typeof x === "string") {
    const [v, sym] = x.split(" ");
    return sym && Number(v) > 0 ? { v: Number(v), sym } : null;
  }
  const o = x;
  if (o && o.amount != null && o.nai) {
    const v = Number(o.amount) / 10 ** (o.precision ?? 3);
    const sym = NAI[o.nai] ?? o.nai;
    return v > 0 ? { v, sym } : null;
  }
  return null;
};
const opOf = (x) => {
  const raw = x?.op;
  if (Array.isArray(raw)) return { type: raw[0], value: raw[1] ?? {} };
  return { type: raw?.type ?? "", value: raw?.value ?? {} };
};
const r3 = (x) => Math.round(x * 1e3) / 1e3;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/* paged walk-back: newest → older, until span ≥ lookbackDays or pages exhausted.
 * Mirrors measure.mjs's dual-API law (ah_api first, condenser fallback). */
async function pagedHistory(account, lookbackDays = 8) {
  const cutoffMs = Date.now() - lookbackDays * DAY;
  let start = -1;
  const out = [];
  for (let p = 0; p < PAGES; p++) {
    let hist = null;
    let r = await rpcCall("account_history_api.get_account_history", { account, start, limit: WINDOW - 1 });
    if (r.ok) hist = r.result?.history ?? null;
    else {
      r = await rpcCall("condenser_api.get_account_history", [account, start, WINDOW - 1]);
      if (r.ok) hist = r.result ?? null;
    }
    if (!hist || !hist.length) break;
    out.push(...hist);
    const tsOf = (x) => x?.timestamp ? Date.parse(x.timestamp + (x.timestamp.endsWith("Z") ? "" : "Z")) : 0;
    const oldest = hist.reduce((m, [, x]) => Math.min(m, tsOf(x) || Infinity), Infinity);
    const oldestIdx = hist[0]?.[0];
    if (!Number.isFinite(oldest) || oldest <= cutoffMs) break;
    if (typeof oldestIdx !== "number" || oldestIdx <= 0) break;
    start = oldestIdx - 1; /* continue below the oldest seen */
    await new Promise((res) => setTimeout(res, SWEEP_GAP_MS));
  }
  /* dedupe by idx (overlapping pages), sort ascending */
  const byIdx = new Map();
  for (const row of out) if (Array.isArray(row) && typeof row[0] === "number") byIdx.set(row[0], row);
  return [...byIdx.values()].sort((a, b) => a[0] - b[0]);
}

/* one hand: process fills newer than cursor with the average-cost law.
 * T-565 GRILL FIX — ADOPTION LAW: the original cursor law pinned the cursor
 * at the NEWEST index on first sweep, so every fill before adoption was
 * invisible — the grill caught the shipped module measuring honest-looking
 * ZEROS while the chain held 121 real fills in window. NEW LAW: adoption
 * processes the FULL bounded window (the same 8×1000 pages we already
 * fetched); early asks without basis are honest basis-gaps (zero PnL
 * invented), and the cursor pins at the window's newest index as before. */
export async function sweepHand(account) {
  const FILE = path.join(PNL_DIR, `${account}.json`);
  const prev = readJson(FILE, null) ?? {};
  const hist = await pagedHistory(account);
  if (!hist.length) return { ok: false, reason: "no-history" };

  /* cursor law (T-566 GRILL REVISION): the incremental filter is TIMESTAMP-based,
   * not index-based. The grill proved account_history INDICES ARE NODE-DEPENDENT
   * (steemit vs boylikegirl interleave virtual ops differently — same account,
   * same day, same op at DIFFERENT indices), so an idx>cursor filter mixes index
   * spaces whenever the NODES failover list answers from a different family —
   * silently skipping or double-counting fills. Timestamps are node-independent.
   * Edge (recorded, accepted): fills in the SAME second as windowTo are skipped
   * — bounded by the 10min sweep cadence and node truncation being rarer still. */
  const rows = prev.cursor != null && prev.windowTo
    ? hist.filter(([idx, x]) => {
        const ts = x?.timestamp ? Date.parse(x.timestamp + (x.timestamp.endsWith("Z") ? "" : "Z")) : 0;
        return ts > Date.parse(prev.windowTo.endsWith("Z") ? prev.windowTo : prev.windowTo + "Z");
      })
    : hist;
  const adopting = prev.cursor == null;
  const newestIdx = hist.length ? hist[hist.length - 1][0] : null;
  if (adopting) {
    /* process the whole window NOW (fall through with rows = hist) — the
     * state is written once at the end of this call, with adoptedAt kept */
  }
  if (!rows.length) { writeJson(FILE, { ...prev, updatedAt: new Date().toISOString() }); return { ok: true, fresh: true }; }

  const lots = prev.lots ?? { steemQty: 0, avgCostSbd: 0 };
  const realized = prev.realized ?? {};
  let basisGaps = prev.basisGaps ?? 0;
  const totals = prev.totals ?? { fills: 0, askFills: 0, bidFills: 0, realizedSbd: 0, volSteem: 0, volSbd: 0 };
  /* T-566 GRILL: the window edges track FILL rows only — the grill caught the
   * window drifting to create/cancel timestamps (non-fill ops ride the same
   * incremental rows) which mislabeled "measured window" on the card. */
  let lastFillTs = null;
  for (const [, x] of rows) {
    const { type, value } = opOf(x);
    if (type !== "fill_order" && type !== "fill_order_operation") continue;
    const cur = amt(value.current_pays), opn = amt(value.open_pays);
    if (!cur || !opn) continue;
    const isCur = value.current_owner === account;
    const mine = isCur ? cur : opn, theirs = isCur ? opn : cur;
    const day = String(x?.timestamp ?? "").slice(0, 10);
    if (!day) continue;
    lastFillTs = String(x?.timestamp ?? "") || lastFillTs;
    realized[day] = realized[day] ?? { realizedSbd: 0, askFills: 0, bidFills: 0, volSteem: 0, volSbd: 0 };
    let d = realized[day];

    if (mine.sym === "STEEM" && theirs.sym === "SBD") {
      /* ASK: sold steem, received sbd → realize against basis */
      const qty = mine.v, proceeds = theirs.v;
      d.askFills++; totals.askFills++; totals.fills++;
      d.volSteem += qty; totals.volSteem += qty; d.volSbd += proceeds; totals.volSbd += proceeds;
      if (lots.steemQty > 0) {
        const sold = Math.min(qty, lots.steemQty);
        const pnl = sold * ((proceeds / qty) - lots.avgCostSbd);
        d.realizedSbd += pnl; totals.realizedSbd += pnl;
        lots.steemQty -= sold;
        if (qty > sold) { /* sold more than basis held: the excess is a gap */
          basisGaps += qty - sold;
        }
      } else {
        basisGaps += qty; /* no basis — honest gap, zero PnL invented */
      }
    } else if (mine.sym === "SBD" && theirs.sym === "STEEM") {
      /* BID: bought steem, paid sbd → build basis */
      const qty = theirs.v, cost = mine.v;
      d.bidFills++; totals.bidFills++; totals.fills++;
      d.volSteem += qty; totals.volSteem += qty; d.volSbd += cost; totals.volSbd += cost;
      const newQty = lots.steemQty + qty;
      lots.avgCostSbd = newQty > 0 ? (lots.avgCostSbd * lots.steemQty + cost) / newQty : 0;
      lots.steemQty = newQty;
    }
  }

  const st = {
    account, cursor: Math.max(prev.cursor ?? 0, rows.length ? rows[rows.length - 1][0] : (prev.cursor ?? 0)),
    adoptedAt: prev.adoptedAt ?? new Date().toISOString(),
    /* T-566 GRILL (self-caught regression): windowFrom is STICKY — it records the
     * oldest edge of the measured window SINCE ADOPTION, not the last batch's
     * first row (the grill saw woq/siq collapse from==to after one incremental
     * sweep). windowTo advances ONLY with the newest FILL (not create/cancel). */
    windowFrom: prev.windowFrom ?? (rows.length && rows[0] ? String(rows[0][1]?.timestamp ?? "") : null),
    windowTo: lastFillTs ?? prev.windowTo ?? null,
    lots: { steemQty: r6(lots.steemQty), avgCostSbd: r6(lots.avgCostSbd) },
    realized: Object.fromEntries(Object.entries(realized).slice(-30).map(([k, v]) => [k, {
      realizedSbd: r6(v.realizedSbd), askFills: v.askFills, bidFills: v.bidFills,
      volSteem: r3(v.volSteem), volSbd: r3(v.volSbd),
    }])),
    basisGaps: r6(basisGaps),
    totals: {
      fills: totals.fills, askFills: totals.askFills, bidFills: totals.bidFills,
      realizedSbd: r6(totals.realizedSbd), volSteem: r3(totals.volSteem), volSbd: r3(totals.volSbd),
    },
    updatedAt: new Date().toISOString(),
  };
  writeJson(FILE, st);
  return { ok: true, cursor: st.cursor };
}

/* THE CAPITAL-ROUTING PROPOSAL (measurement → routing table, no movement):
 * rank hands by 7d realized PnL + fill activity; the fuel lane consumes. */
export function routingTable(hands) {
  const now = Date.now();
  const rows = [];
  for (const h of hands) {
    const st = readJson(path.join(PNL_DIR, `${h.account}.json`), null);
    if (!st) { rows.push({ account: h.account, measured: false, route: "observe" }); continue; }
    let pnl7 = 0, fills7 = 0, vol7 = 0;
    for (const [day, v] of Object.entries(st.realized ?? {})) {
      if (Date.parse(`${day}T00:00:00Z`) >= now - 7 * DAY) {
        pnl7 += v.realizedSbd ?? 0; fills7 += (v.askFills ?? 0) + (v.bidFills ?? 0); vol7 += v.volSteem ?? 0;
      }
    }
    rows.push({
      account: h.account, measured: true,
      realized7dSbd: r6(pnl7), fills7d: fills7, vol7dSteem: r3(vol7),
      realizedTotalSbd: st.totals?.realizedSbd ?? 0,
      basisGaps: st.basisGaps ?? 0,
      route: pnl7 > 0 && fills7 >= 3 ? "fuel-eligible" : "observe",
    });
  }
  rows.sort((a, b) => (b.realized7dSbd ?? 0) - (a.realized7dSbd ?? 0));
  const measured = rows.filter((r) => r.measured);
  const table = {
    at: new Date().toISOString(),
    law: "PROPOSAL-ONLY — the fuel lane owns movement; this table never transfers",
    positiveHands: measured.filter((r) => (r.realized7dSbd ?? 0) > 0).length,
    fuelEligible: rows.filter((r) => r.route === "fuel-eligible").map((r) => r.account),
    hands: rows,
  };
  writeJson(path.join(PNL_DIR, "routing.json"), table);
  return table;
}

/* layer sweep — one bounded pass over the roster (fail-soft per hand) */
export async function sweepAll(roster) {
  const results = [];
  for (const account of roster) {
    try { results.push({ account, ...(await sweepHand(account)) }); }
    catch (e) { results.push({ account, ok: false, reason: String(e?.message ?? e).slice(0, 120) }); }
  }
  return results;
}

/* read-only state for /army-grid */
export function pnlState() {
  let files = [];
  try { files = fs.readdirSync(PNL_DIR).filter((f) => f.endsWith(".json") && f !== "routing.json"); } catch { /* none yet */ }
  const hands = [];
  for (const f of files) {
    const st = readJson(path.join(PNL_DIR, f), null);
    if (!st?.account) continue;
    const today = new Date().toISOString().slice(0, 10);
    hands.push({
      account: st.account,
      adoptedAt: st.adoptedAt ?? null,
      cursor: st.cursor ?? null,
      /* T-566 GRILL: measured-window honesty on the card (state had it, card didn't) */
      windowFrom: st.windowFrom ?? null,
      windowTo: st.windowTo ?? null,
      today: { ...(st.realized?.[today] ?? { realizedSbd: 0, askFills: 0, bidFills: 0, volSteem: 0, volSbd: 0 }) },
      totals: st.totals ?? null,
      basisGaps: st.basisGaps ?? 0,
      openPositionSteem: st.lots?.steemQty ?? 0,
      avgCostSbd: st.lots?.avgCostSbd ?? 0,
    });
  }
  const routing = readJson(path.join(PNL_DIR, "routing.json"), null);
  return { hands, routing };
}
