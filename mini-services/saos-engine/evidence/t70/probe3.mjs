/* ═══ T-70 PROBE v3 — the pond truth, per pair, from the trades table ═══
 * v2 verdict: metrics.volume and metrics.spread are STALE SNAPSHOTS
 * (SWAP.BTC: 29,396 claimed vs 2,153 SWAP.HIVE measured; 7.3bps claimed vs
 * 521.9bps on the real book). The law reads the BOOK for the touch and the
 * TRADES for the pond. This probe measures the top-6 ponds that way, plus
 * the `type` field semantics (who is the maker on H-E), so no law guesses. */
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
const SYMS = ["SWAP.BTC", "SWAP.LTC", "DEC", "BEE", "SWAP.HBD", "ICON"];
const cutoff = Math.floor(Date.now() / 1000) - 86400;

for (const sym of SYMS) {
  try {
    const [th, buys, sells] = await Promise.all([
      rpc("find", { contract: "market", table: "tradesHistory", query: { symbol: sym }, limit: 1000, offset: 0 }),
      rpc("find", { contract: "market", table: "buyBook", query: { symbol: sym }, limit: 30, offset: 0 }),
      rpc("find", { contract: "market", table: "sellBook", query: { symbol: sym }, limit: 30, offset: 0 }),
    ]);
    const arr = Array.isArray(th) ? th.filter((t) => Number(t?.timestamp ?? 0) >= cutoff) : [];
    const volHive = arr.reduce((s, t) => s + n(t.quantity) * n(t.price), 0);
    const fills = arr.length;
    const oldest = arr.length ? Math.min(...arr.map((t) => Number(t.timestamp))) : null;
    const fullBasis = arr.length >= 1000 ? true : oldest != null && oldest <= cutoff;
    const types = new Map();
    for (const t of arr) { const k = String(t.type ?? "?"); types.set(k, (types.get(k) ?? 0) + 1); }
    const cpty = new Map();
    for (const t of arr) { for (const who of [t.buyer, t.seller]) { const a = String(who ?? "").trim(); if (a) cpty.set(a, (cpty.get(a) ?? 0) + n(t.quantity) * n(t.price)); } }
    const leaders = [...cpty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([a, v]) => `${a}:${((v / (volHive || 1)) * 100).toFixed(0)}%`);
    const bb = (Array.isArray(buys) ? buys : []).map((b) => n(b.price)).filter((p) => p > 0).sort((a, b) => b - a)[0] ?? null;
    const bs = (Array.isArray(sells) ? sells : []).map((s) => n(s.price)).filter((p) => p > 0).sort((a, b) => a - b)[0] ?? null;
    const spreadBps = bb != null && bs != null && bs >= bb ? Math.round(((bs - bb) / bb) * 1e4 * 10) / 10 : null;
    const pondUsd = Math.round(volHive * HIVE_USD * 1e4) / 1e4;
    const ceilUsd = spreadBps != null ? Math.round(volHive * (spreadBps / 1e4) * HIVE_USD * 1e6) / 1e6 : null;
    console.log(`${sym.padEnd(11)} fills24h=${String(fills).padEnd(5)} vol=${volHive.toFixed(1)} SWAP.HIVE ($${pondUsd}/d) touchBps=${spreadBps} ceilUsd/d=${ceilUsd} fullBasis=${fullBasis} type=${[...types.entries()].map(([k, v]) => k + "×" + v).join(",")} top=${leaders.join(" ")}`);
  } catch (e) {
    console.log(`${sym.padEnd(11)} FAIL: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}
console.log("\nPROBE v3 DONE");
