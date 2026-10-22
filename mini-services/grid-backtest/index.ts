// grid-backtest — sovereign backtester for OUR grid, from OUR fills ledger.
// Law: read-only vs the engine (HTTP GET only) · zero external deps · honest math.
// Internal STEEM/SBD market = zero fee for limit trades (documented assumption).
// Reports which spacing config would have captured the most, vs our live config.
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = Number(process.env.PORT ?? 3048);
const ENGINE = process.env.ENGINE_URL ?? "http://127.0.0.1:3040";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const CURRENT = { spacingBps: 25, levels: 3 }; // live army-grid conf (measured)

type Fill = { seq: string; at: number; side: string; steem: number; sbd: number };
type Cfg = { spacingBps: number; maxQtySteem: number };
type Res = Cfg & {
  roundTrips: number; capturedSbd: number; sbdPerDay: number;
  peakInventorySteem: number; openInventorySteem: number;
};

let last: any = null;

const NODE = process.env.STEEM_NODE ?? "https://steemapi.boylikegirl.club";

// market truth: per-trade chain history (deepest per-trade window the node keeps,
// ~3 days) — every participant's fills, ours included.
async function chainTrades(hoursBack = 72): Promise<Fill[]> {
  const end = new Date();
  const start = new Date(end.getTime() - hoursBack * 3600000);
  const iso = (d: Date) => d.toISOString().replace(".000Z", "").replace("Z", "");
  const body = { jsonrpc: "2.0", method: "condenser_api.get_trade_history", params: [iso(start), iso(end), 1000], id: 1 };
  const r = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`node ${r.status}`);
  const d: any = await r.json();
  const unit = (s: string): [number, string] => { const [amt, cur] = String(s).trim().split(/\s+/); return [parseFloat(amt), cur]; };
  return (d.result ?? []).map((t: any) => {
    const [a1, c1] = unit(t.current_pays); const [a2, c2] = unit(t.open_pays);
    const steem = c1 === "STEEM" ? a1 : a2, sbd = c1 === "SBD" ? a1 : a2;
    return { seq: String(t.date), at: Date.parse(t.date + "Z"), side: "market", steem, sbd } as Fill;
  }).filter((f: Fill) => f.steem > 0 && f.sbd > 0).sort((a: Fill, b: Fill) => a.at - b.at);
}

async function loadFills(): Promise<{ fills: Fill[]; ours: number }> {
  const chain = await chainTrades();
  let ours = 0;
  try {
    const r = await fetch(`${ENGINE}/fills`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d: any = await r.json();
      const own = (d.fills ?? []).filter((f: Fill) => f.steem > 0 && f.sbd > 0);
      ours = own.length;
    }
  } catch { /* engine busy — chain truth alone is enough for the series */ }
  return { fills: chain, ours };
}

// replay: prices from fills (unit = sbd/steem). Buy on -S, sell on +S, capped qty.
function replay(prices: number[], spacingBps: number, maxQtySteem: number): Res {
  const s = spacingBps / 10000;
  const step = Math.max(0.5, maxQtySteem / 3);
  let qty = 0, cost = 0, avg = 0, trips = 0, profit = 0, peak = 0;
  let anchor: number | null = null;
  let wantBuy = true;
  for (const p of prices) {
    if (anchor == null) { anchor = p; continue; }
    const hit = wantBuy ? p <= anchor * (1 - s) : p >= anchor * (1 + s);
    if (!hit) continue;
    const px = wantBuy ? anchor * (1 - s) : anchor * (1 + s); // conservative fill at level
    if (wantBuy) {
      qty += step; cost += step * px; avg = qty > 0 ? cost / qty : 0;
    } else if (qty >= step) {
      profit += step * (px - avg); cost -= step * avg; qty -= step; trips++;
    }
    wantBuy = !wantBuy; anchor = px;
    if (qty > peak) peak = qty;
  }
  return { spacingBps, maxQtySteem, roundTrips: trips, capturedSbd: +profit.toFixed(4), sbdPerDay: 0, peakInventorySteem: +peak.toFixed(2), openInventorySteem: +qty.toFixed(2) };
}

async function runBacktest() {
  const { fills, ours } = await loadFills();
  if (fills.length < 10) throw new Error(`not-enough-fills (${fills.length})`);
  const prices = fills.map((f) => f.sbd / f.steem);
  const ats = fills.map((f) => f.at);
  const hours = (ats[ats.length - 1] - ats[0]) / 3600000;
  const maxQty = Math.max(10, Math.round((fills.reduce((a, f) => a + f.steem, 0) / fills.length) * 10));
  const spacings = [15, 25, 50, 100, 150, 200];
  const results: Res[] = spacings.map((sp) => {
    const r = replay(prices, sp, maxQty);
    r.sbdPerDay = +(r.capturedSbd / Math.max(hours / 24, 1 / 24)).toFixed(4);
    return r;
  });
  const ranked = [...results].sort((a, b) => b.capturedSbd - a.capturedSbd);
  const best = ranked[0] ?? null;
  const current = results.find((r) => r.spacingBps === CURRENT.spacingBps) ?? null;
  const verdict = best && current
    ? best.spacingBps === current.spacingBps
      ? `current-spacing-${CURRENT.spacingBps}bps-is-optimal-on-this-window`
      : `best-on-window=${best.spacingBps}bps (captured ${best.capturedSbd} SBD vs current ${current.capturedSbd} SBD) — advisory, not an order`
    : "insufficient-data";
  last = {
    at: new Date().toISOString(),
    fills: fills.length, hours: +hours.toFixed(2), oursInWindow: ours,
    results: ranked, best, current, verdict,
  };
  (last as any).source = "condenser_api.get_trade_history (market truth)";
  fs.mkdirSync(STATE, { recursive: true });
  const t = path.join(STATE, "backtest-latest.json.tmp." + process.pid);
  fs.writeFileSync(t, JSON.stringify(last, null, 2));
  fs.renameSync(t, path.join(STATE, "backtest-latest.json"));
  return last;
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const p = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    if (p === "/health") return Response.json({ ok: true, organ: "grid-backtest", port: PORT, engine: ENGINE, ranAt: last?.at ?? null, law: "read-only-vs-engine · zero-fee-internal-market · advisory-not-orders" });
    if (p === "/report") return Response.json(last ?? { ok: false, hint: "POST /run first" });
    if (p === "/run" && req.method === "POST") {
      return runBacktest().then((r) => Response.json({ ok: true, ...r })).catch((e) => Response.json({ ok: false, error: String(e).slice(0, 140) }, { status: 500 }));
    }
    return Response.json({ ok: false, error: "not-found", routes: ["/health", "/report", "/run"] }, { status: 404 });
  },
});

console.log(`grid-backtest listening on :${PORT} (engine=${ENGINE})`);
// auto-run on boot so /report is never empty
runBacktest().then((r) => console.log(`boot backtest: ${r.fills} fills · ${r.hours}h · verdict: ${r.verdict}`)).catch((e) => console.log(`boot backtest deferred: ${String(e).slice(0, 120)}`));
