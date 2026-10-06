// r147-a FORENSICS — measured-only analysis of the 87 real chain fills.
// Sources: sovereign/money/pnl-scan.json (fill_order checkpoint),
//          sovereign/money/history.json (daemon receipts w/ parity stamps),
//          live /api/money (book + parity). No fabrication: every number is computed.
import fs from "node:fs";
const HOME = "/home/z/my-project";

const cp = JSON.parse(fs.readFileSync(`${HOME}/sovereign/money/pnl-scan.json`, "utf8"));
const fills = (cp.fills || [])
  .map((f) => ({ idx: Number(f.idx), at: String(f.at), side: f.side, price: Number(f.price), steem: Number(f.steem), sbd: Number(f.sbd) }))
  .filter((f) => Number.isFinite(f.price) && f.price > 0)
  .sort((a, b) => a.idx - b.idx);

// history receipts with parity stamps (REPRICE/ARM-BUY etc. carry parity at action time)
const hist = JSON.parse(fs.readFileSync(`${HOME}/sovereign/money/history.json`, "utf8"));
const harr = Array.isArray(hist) ? hist : hist.entries || hist.history || [];
const parityStamps = harr
  .filter((e) => e && typeof e.at === "string" && Number.isFinite(Number(e.parity)) && Number(e.parity) > 0)
  .map((e) => ({ at: e.at, parity: Number(e.parity), kind: e.kind }))
  .sort((a, b) => a.at.localeCompare(b.at));

function parityAt(t) {
  let p = null, stamp = null;
  for (const s of parityStamps) {
    if (s.at <= t) { p = s.parity; stamp = s; } else break;
  }
  return { parity: p, stamp };
}

// FIFO exactly like src/lib/economy/pnl-ledger.ts
function fifo(fsFills) {
  const queue = [], trips = [];
  for (const f of fsFills) {
    if (f.side === "bought-steem") queue.push({ fillIdx: f.idx, at: f.at, steem: f.steem, price: f.price });
    else {
      let remain = f.steem;
      while (remain > 1e-9 && queue.length) {
        const head = queue[0];
        const take = Math.min(remain, head.steem);
        trips.push({
          openedAt: head.at, closedAt: f.at, steem: Math.round(take * 1e3) / 1e3,
          entryPrice: head.price, exitPrice: f.price,
          capturedSbd: Math.round((f.price - head.price) * take * 1e6) / 1e6,
          capturedBps: Math.round(((f.price - head.price) / head.price) * 10_000),
          openedByFillIdx: head.fillIdx, closedByFillIdx: f.idx,
        });
        head.steem -= take; remain -= take;
        if (head.steem <= 1e-9) queue.shift();
      }
    }
  }
  return { trips, openLots: queue };
}

const { trips, openLots } = fifo(fills);
const capturedSbd = trips.reduce((s, t) => s + t.capturedSbd, 0);
console.log("=== GLOBAL (checkpoint floor", cp.floorIso, "savedAt", cp.savedAt, "maxIndex", cp.maxIndex, ")");
console.log("fills", fills.length, "| trips", trips.length, "| capturedSbd", Math.round(capturedSbd * 1e6) / 1e6, "| openLots STEEM", Math.round(openLots.reduce((s, l) => s + l.steem, 0) * 1e3) / 1e3);

// windows
const W_WIDEN = "2026-10-02T00:29:02"; // commit b2a2979 (3→5 levels live)
const W_FILLDEPLOY = "2026-10-02T10:38:00"; // r146-d FILL-DEPLOY law live (~10:38Z)
const wins = [
  ["W0 pre-widening (<00:29:02Z)", (t) => t < W_WIDEN],
  ["W1 widening→FILL-DEPLOY [00:29:02,10:38)", (t) => t >= W_WIDEN && t < W_FILLDEPLOY],
  ["W2 post-FILL-DEPLOY (≥10:38Z)", (t) => t >= W_FILLDEPLOY],
];
console.log("\n=== PER-WINDOW TRIPS (FIFO closed rounds)");
for (const [name, pred] of wins) {
  const tt = trips.filter((t) => pred(t.closedAt));
  const sum = tt.reduce((s, x) => s + x.capturedSbd, 0);
  const bps = tt.map((x) => x.capturedBps);
  const avgBps = bps.length ? bps.reduce((a, b) => a + b, 0) / bps.length : null;
  console.log(name, "| trips", tt.length, "| capturedSbd", Math.round(sum * 1e6) / 1e6, "| avg capturedBps", avgBps == null ? "n/a" : Math.round(avgBps * 10) / 10, "| wins(>0bps)", bps.filter((b) => b > 0).length, "| losses(<0)", bps.filter((b) => b < 0).length);
  // detail for small windows
  for (const t of tt) console.log("   trip", t.steem, "STEEM", t.entryPrice.toFixed(6), "→", t.exitPrice.toFixed(6), "=", t.capturedSbd, "SBD", t.capturedBps + "bps", "closed", t.closedAt, "closeFillIdx", t.closedByFillIdx);
}
console.log("\n=== PER-WINDOW FILLS");
for (const [name, pred] of wins) {
  const ff = fills.filter((f) => pred(f.at));
  const buys = ff.filter((f) => f.side === "bought-steem");
  const sells = ff.filter((f) => f.side === "sold-steem");
  const volSbd = ff.reduce((s, f) => s + f.sbd, 0);
  console.log(name, "| fills", ff.length, "(bought", buys.length, "/ sold", sells.length, ") | volSbd", Math.round(volSbd * 1e3) / 1e3, "| STEEM", Math.round(ff.reduce((s, f) => s + f.steem, 0) * 1e3) / 1e3);
  for (const f of ff) {
    const { parity, stamp } = parityAt(f.at);
    const prem = parity ? Math.round((f.price / parity - 1) * 1e4) : null;
    console.log("   fill idx", f.idx, f.at, f.side, f.steem, "@", f.price, "premVsParity", prem == null ? "no-parity-stamp" : prem + "bps", "(stamp", stamp ? stamp.kind + "@" + stamp.at : "none", ")");
  }
}

// ladder-level buckets (sell premiums 0..400bps, buy offsets 100..500bps)
function bucket(premBps, levels) {
  if (premBps == null) return null;
  let best = null, bd = Infinity;
  for (const L of levels) { const d = Math.abs(premBps - L); if (d < bd) { bd = d; best = L; } }
  return bd <= 120 ? best : `off(${premBps})`;
}
const SELL_LEVELS = [0, 100, 200, 300, 400];
const BUY_LEVELS = [100, 200, 300, 400, 500];
console.log("\n=== LADDER-LEVEL WIN-RATE (fills mapped to ladder level by premium vs contemporaneous parity)");
for (const [name, pred] of wins) {
  const ff = fills.filter((f) => pred(f.at));
  const counts = {};
  for (const f of ff) {
    const { parity } = parityAt(f.at);
    const prem = parity ? Math.round((f.price / parity - 1) * 1e4) : null;
    const lvl = f.side === "sold-steem" ? bucket(prem, SELL_LEVELS) : bucket(prem == null ? null : -prem, BUY_LEVELS);
    const k = (f.side === "sold-steem" ? "SELL L" : "BUY -") + (lvl ?? "?");
    counts[k] = counts[k] || { n: 0, steem: 0, sbd: 0 };
    counts[k].n++; counts[k].steem += f.steem; counts[k].sbd += f.sbd;
  }
  console.log(name, JSON.stringify(counts));
}

// last-24h fills
const day = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 19);
const f24 = fills.filter((f) => f.at >= day);
console.log("\nlast24h fills:", f24.length, "| sides:", JSON.stringify(f24.reduce((m, f) => { m[f.side] = (m[f.side] || 0) + 1; return m; }, {})));

// receipt noise: REPRICE-FAIL count
const fails = harr.filter((e) => e && e.kind === "REPRICE-FAIL");
const fails24 = fails.filter((e) => e.at >= day);
console.log("REPRICE-FAIL total in receipts book:", fails.length, "| last24h:", fails24.length);
const nofuel = fails.filter((e) => String(e.error || "").includes("אין דלק"));
console.log("REPRICE-FAIL NO-FUEL total:", nofuel.length, "| first", nofuel[0]?.at, "| last", nofuel[nofuel.length - 1]?.at);
const kinds = harr.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {});
console.log("receipt kinds:", JSON.stringify(kinds));
