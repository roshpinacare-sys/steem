/* ═══ T-70 PROBE · THE THIRD WATER — Hive-Engine, measured-first ═══
 * The operator's mandate: "the biggest maker on the NETWORKS we operate on"
 * + "wide hands holding the whole crypto market". T-68 measured the Steem
 * pond, T-69 the HBD:HIVE pond. This probe measures the THIRD water the
 * machine can REACH without any credential: the Hive-Engine token markets
 * (read-only, public RPC). Zero guessing: every law below is written AFTER
 * this probe's measured shapes.
 *
 * Questions the probe answers (the operator's "raise many queries"):
 *   Q1  Does api.hive-engine.com answer from this sandbox?
 *   Q2  What does the metrics table carry per token (volume semantics)?
 *   Q3  What is the REAL touch spread on the top-liquid pairs?
 *   Q4  What 24h USD ceilings do the top ponds imply (via the measured
 *       hiveUsd leg 0.056)?
 *   Q5  Is there a per-trade FEE surface (the operator's "take other
 *       users' fees") — or is the fee story the same as the internal
 *       markets (income = spread only)?
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const BASE = "https://api.hive-engine.com/rpc/contracts";
let id = 1;
async function rpc(method, params, timeoutMs = 15_000) {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json();
  if (j?.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

const HIVE_USD = 0.056; // the measure ladder's measured hiveUsd leg (observe.parity.hiveUsd)

console.log("=== Q1/Q2 · metrics table, top 100 by volume ===");
let metrics = null;
try {
  metrics = await rpc("find", { contract: "market", table: "metrics", query: {}, limit: 100, offset: 0, orderBy: "volume", orderDirection: "desc" });
  console.log("rows:", Array.isArray(metrics) ? metrics.length : typeof metrics);
  if (Array.isArray(metrics) && metrics.length) {
    console.log("first-row keys:", Object.keys(metrics[0]));
    console.log("first-row:", JSON.stringify(metrics[0], null, 1).slice(0, 900));
    console.log("second-row:", JSON.stringify(metrics[1] ?? null).slice(0, 500));
  }
} catch (e) {
  console.log("metrics FAIL:", String(e?.message ?? e).slice(0, 200));
}

if (Array.isArray(metrics) && metrics.length) {
  console.log("\n=== Q3/Q4 · the top-12 ponds, spread + USD ceiling ===");
  const rows = metrics
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const vol = Number(String(m.volume ?? "").replace(/,/g, ""));
      const ask = Number(String(m.lowestAsk ?? "")), bid = Number(String(m.highestBid ?? ""));
      const last = Number(String(m.lastPrice ?? ""));
      return { token: m.token, vol, ask, bid, last, symbol: m.symbol ?? null, meta: m };
    })
    .map((r) => ({
      ...r,
      spreadBps: r.ask > 0 && r.bid > 0 && r.ask >= r.bid ? Math.round(((r.ask - r.bid) / r.bid) * 1e4 * 10) / 10 : null,
      pondUsd: r.vol > 0 ? Math.round(r.vol * HIVE_USD * 1e4) / 1e4 : null,
      ceilUsd: r.vol > 0 && r.spreadBps != null ? Math.round(r.vol * (r.spreadBps / 1e4) * HIVE_USD * 1e6) / 1e6 : null,
    }))
    .sort((a, b) => (b.pondUsd ?? -1) - (a.pondUsd ?? -1));
  for (const r of rows.slice(0, 12)) {
    console.log(`${(r.token ?? "?").padEnd(14)} vol=${String(r.vol ?? "—").padEnd(12)} ask=${String(r.ask).padEnd(10)} bid=${String(r.bid).padEnd(10)} spreadBps=${String(r.spreadBps).padEnd(8)} pondUsd=${String(r.pondUsd).padEnd(10)} ceilUsd/day=${r.ceilUsd}`);
  }
  const totalPond = rows.filter((r) => r.pondUsd != null).slice(0, 20).reduce((s, r) => s + (r.pondUsd ?? 0), 0);
  const totalCeil = rows.filter((r) => r.ceilUsd != null).slice(0, 20).reduce((s, r) => s + (r.ceilUsd ?? 0), 0);
  console.log(`\nΣ top-20 pondUsd/day=$${totalPond.toFixed(2)} · Σ top-20 captureCeilUsd/day=$${totalCeil.toFixed(4)}`);

  console.log("\n=== Q3-deep · real depth read on the #1 pond (buyBook/sellBook) ===");
  const top = rows.find((r) => r.pondUsd != null && r.token);
  if (top) {
    try {
      const buys = await rpc("find", { contract: "market", table: "buyBook", query: { token: top.token }, limit: 50, offset: 0 });
      const sells = await rpc("find", { contract: "market", table: "sellBook", query: { token: top.token }, limit: 50, offset: 0 });
      console.log(`buyBook rows=${Array.isArray(buys) ? buys.length : "junk"} · sellBook rows=${Array.isArray(sells) ? sells.length : "junk"}`);
      if (Array.isArray(buys) && buys[0]) console.log("buy-row keys:", Object.keys(buys[0]), "sample:", JSON.stringify(buys[0]));
      if (Array.isArray(sells) && sells[0]) console.log("sell-row keys:", Object.keys(sells[0]), "sample:", JSON.stringify(sells[0]));
      if (Array.isArray(buys) && Array.isArray(sells) && buys.length && sells.length) {
        const bb = buys.map((b) => Number(b.price)).filter((p) => p > 0).sort((a, b) => b - a)[0];
        const bs = sells.map((s) => Number(s.price)).filter((p) => p > 0).sort((a, b) => a - b)[0];
        const bookSpread = bb > 0 && bs >= bb ? ((bs - bb) / bb) * 1e4 : null;
        const buyQty = buys.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
        const sellQty = sells.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
        console.log(`DEEP book: bestBid=${bb} bestAsk=${bs} spreadBps=${bookSpread != null ? bookSpread.toFixed(1) : "crossed/null"} depthQty buy=${buyQty.toFixed(2)} sell=${sellQty.toFixed(2)} (top-50 each side)`);
      }
    } catch (e) {
      console.log("book FAIL:", String(e?.message ?? e).slice(0, 200));
    }
  }

  console.log("\n=== Q5 · fee surface hunt ===");
  const feeKeys = new Set();
  for (const m of metrics.slice(0, 20)) {
    for (const k of Object.keys(m)) if (/fee/i.test(k)) feeKeys.add(`${k}=${JSON.stringify(m[k])}`);
  }
  console.log("fee-named keys in top-20 metrics:", feeKeys.size ? [...feeKeys].slice(0, 10) : "NONE — the fee story is the same as the internal markets: the income is the SPREAD, fees are per-token config not a pond property");
}
console.log("\nPROBE DONE");
