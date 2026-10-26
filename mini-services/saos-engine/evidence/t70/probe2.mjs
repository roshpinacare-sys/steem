/* ═══ T-70 PROBE v2 — closes the v1 gaps the run itself exposed ═══
 * v1 lessons (each a law-shaped fact, not a bug to forget):
 *   · the metrics key is `symbol`, not `token` (v1 printed "?" — the probe
 *     must read the measured shape, not an assumed one);
 *   · ceilUsd computed in the SAME object literal as spreadBps read the OLD
 *     row (undefined != null → false → all null) — the law computes in steps;
 *   · the deep book read was skipped (top-row token undefined) — v2 reads
 *     buyBook/sellBook with { symbol } and MEASURES the touch from the book;
 *   · volume semantics unverified — v2 cross-checks metrics.volume against
 *     the tradesHistory table (Σ quantity×price in SWAP.HIVE vs Σ quantity
 *     in tokens) on the #1 pond, so the law's USD leg rests on TWO reads.
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
const n = (s) => Number(String(s ?? "").replace(/,/g, "")) || 0;
const HIVE_USD = 0.056;

const metrics = await rpc("find", { contract: "market", table: "metrics", query: {}, limit: 100, offset: 0, orderBy: "volume", orderDirection: "desc" });

console.log("=== fixed top-12 (symbol-correct, ceil computed in steps) ===");
const rows = metrics
  .filter((m) => m && typeof m === "object" && m.symbol)
  .map((m) => {
    const vol = n(m.volume), ask = n(m.lowestAsk), bid = n(m.highestBid);
    const spreadBps = ask > 0 && bid > 0 && ask >= bid ? Math.round(((ask - bid) / bid) * 1e4 * 10) / 10 : null;
    const pondUsd = vol > 0 ? Math.round(vol * HIVE_USD * 1e4) / 1e4 : null;
    const ceilUsd = pondUsd != null && spreadBps != null ? Math.round(vol * (spreadBps / 1e4) * HIVE_USD * 1e6) / 1e6 : null;
    return { symbol: m.symbol, vol, spreadBps, pondUsd, ceilUsd };
  })
  .sort((a, b) => (b.pondUsd ?? -1) - (a.pondUsd ?? -1));
for (const r of rows.slice(0, 12)) {
  console.log(`${r.symbol.padEnd(14)} vol=${String(r.vol.toFixed(2)).padEnd(12)} spreadBps=${String(r.spreadBps).padEnd(9)} pondUsd/day=${String(r.pondUsd).padEnd(10)} ceilUsd/day=${r.ceilUsd}`);
}
const tot = (k) => rows.filter((r) => r[k] != null).slice(0, 20).reduce((s, r) => s + r[k], 0);
console.log(`Σ top-20 pondUsd=$${tot("pondUsd").toFixed(2)} · Σ top-20 captureCeilUsd=$${tot("ceilUsd").toFixed(4)}`);

console.log("\n=== deep book on the #1 pond (buyBook/sellBook by symbol) ===");
const top = rows.find((r) => r.pondUsd != null);
if (top) {
  const buys = await rpc("find", { contract: "market", table: "buyBook", query: { symbol: top.symbol }, limit: 50, offset: 0 });
  const sells = await rpc("find", { contract: "market", table: "sellBook", query: { symbol: top.symbol }, limit: 50, offset: 0 });
  console.log(`buyBook=${Array.isArray(buys) ? buys.length : "junk"} sellBook=${Array.isArray(sells) ? sells.length : "junk"}`);
  if (Array.isArray(buys) && buys[0]) console.log("buy-row:", JSON.stringify(buys[0]));
  if (Array.isArray(sells) && sells[0]) console.log("sell-row:", JSON.stringify(sells[0]));
  if (Array.isArray(buys) && Array.isArray(sells) && buys.length && sells.length) {
    const bb = buys.map((b) => Number(b.price)).filter((p) => p > 0).sort((a, b) => b - a)[0];
    const bs = sells.map((s) => Number(s.price)).filter((p) => p > 0).sort((a, b) => a - b)[0];
    console.log(`BOOK TOUCH: bestBid=${bb} bestAsk=${bs} spreadBps=${bb > 0 && bs >= bb ? (((bs - bb) / bb) * 1e4).toFixed(1) : "crossed"} (metrics said ${top.spreadBps})`);
    const buySbd = buys.slice(0, 5).reduce((s, b) => s + Number(b.price) * Number(b.quantity), 0);
    console.log(`top-5 bid depth ≈ ${buySbd.toFixed(2)} SWAP.HIVE`);
  }
}

console.log("\n=== volume-semantics cross-check on the #1 pond (tradesHistory) ===");
if (top) {
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  const th = await rpc("find", { contract: "market", table: "tradesHistory", query: { symbol: top.symbol }, limit: 1000, offset: 0 });
  const arr = Array.isArray(th) ? th : [];
  console.log("tradesHistory rows:", arr.length, arr[0] ? "keys: " + Object.keys(arr[0]).join(",") : "");
  const in24 = arr.filter((t) => Number(t.timestamp ?? 0) >= cutoff);
  const volHive = in24.reduce((s, t) => s + n(t.quantity) * n(t.price), 0);
  const volTok = in24.reduce((s, t) => s + n(t.quantity), 0);
  console.log(`24h trades=${in24.length} · Σqty×price=${volHive.toFixed(2)} SWAP.HIVE · Σqty=${volTok.toFixed(2)} ${top.symbol} · metrics.volume=${top.vol} ${top.symbol}`);
  console.log(`verdict: metrics.volume is ${Math.abs(volHive - top.vol) < Math.max(1, top.vol * 0.2) ? "SWAP.HIVE-DENOMINATED (Σqty×price ≈ volume)" : Math.abs(volTok - top.vol) < Math.max(1, top.vol * 0.2) ? "TOKEN-DENOMINATED (Σqty ≈ volume)" : "AMBIGUOUS (window partial?) — honest null rides"}`);
  const makers = new Map();
  for (const t of in24) {
    const mk = String(t.side ?? "").trim();
    if (mk) makers.set(mk, (makers.get(mk) ?? 0) + 1);
  }
  console.log("side histogram (maker proxy):", [...makers.entries()].slice(0, 6));
}
console.log("\nPROBE v2 DONE");
