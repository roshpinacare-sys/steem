/* ═══════════ T-69 PROBE · THE SECOND POND, MEASURED INDEPENDENTLY ═══════════
 * T-68 measured the Steem pond (428 trades/day, 1,614 STEEM/day ≈ $160/day,
 * capture ceiling $0.077/day at our 6.5% share). The operator's mandate says
 * "the NETWORKS (plural) we operate on" — the Hive internal market is the
 * second pond, ALREADY sensed every cycle (state/hive.json: 16,995 HIVE/24h,
 * spread 17.1bps) but never converted into dominion math. This probe:
 *   1. counts the pond's fills independently of get_volume (get_recent_trades
 *      — the same two-independent-reads-agree doctrine as the T-68 probe),
 *   2. records whether the Hive fills carry owners (the T-68 law-lock class:
 *      Steem's market_history strips them → ranking must ride OUR fill_order),
 *   3. measures the Hive USD leg (binance HIVEUSDT → coingecko hive),
 *   4. prints the honest multi-pond table (ceiling = pond × spread × share;
 *      absolute ceiling = pond × spread — THE POND IS THE LIMIT).
 * Read-only: zero orders, zero keys, zero state writes. */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const EP = ["https://api.hive.blog", "https://api.openhive.network"];
async function rpc(method, params, timeoutMs = 12_000) {
  let lastErr = null;
  for (const base of EP) {
    try {
      const r = await fetch(`${base}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
      const j = await r.json();
      if (j?.error) throw new Error(String(j.error.message).slice(0, 140));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("hive-endpoints-exhausted");
}
const num = (s) => Number(String(s ?? "").split(" ")[0]) || 0;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

const now = new Date();
const cutoff = now.getTime() - 86_400_000;

/* 1 · fills read (independent of get_volume) */
let fills = null, ownerFieldSeen = null, shapeSample = null, apiThatAnswered = null;
for (const [api, method, params] of [
  ["condenser", "condenser_api.get_recent_trades", [1000]],
  ["mh", "market_history_api.get_recent_trades", { limit: 1000 }],
]) {
  try {
    const rows = await rpc(method, params);
    const arr = Array.isArray(rows?.trades) ? rows.trades : Array.isArray(rows) ? rows : null;
    if (!arr) continue;
    apiThatAnswered = api;
    if (arr.length) {
      shapeSample = { keys: Object.keys(arr[0] ?? {}).slice(0, 12), sample: arr[0] };
      ownerFieldSeen = Object.keys(arr[0] ?? {}).some((k) => /^(taker|maker|owner|account)$/i.test(k));
    }
    const in24 = [];
    for (const t of arr) {
      const ts = Date.parse(String(t.date).endsWith("Z") ? t.date : `${t.date}Z`);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const cur = t.current_pays ?? "", opn = t.open_pays ?? "";
      const curSym = String(cur).split(" ")[1] ?? "", opnSym = String(opn).split(" ")[1] ?? "";
      let hive = 0, px = null;
      if (curSym === "HIVE" && opnSym === "HBD") { hive = num(cur); px = num(opn) / hive; }
      else if (curSym === "HBD" && opnSym === "HIVE") { hive = num(opn); px = num(cur) / hive; }
      if (hive > 0 && px > 0) in24.push({ ts, hive, px });
    }
    in24.sort((a, b) => a.ts - b.ts);
    const coveredHours = in24.length ? Math.max(0.1, (in24[in24.length - 1].ts - in24[0].ts) / 3600_000) : 0;
    const volSum = in24.reduce((s, r) => s + r.hive, 0);
    const sizes = in24.map((r) => r.hive).sort((a, b) => a - b);
    /* 6 · THE DOMINION LEADERBOARD — the field Steem's history STRIPS and
     * Hive's condenser EXPOSES: maker (the side resting on the book) earns
     * the spread. Aggregate by maker across the fetched window AND the 24h
     * slice — the honest "who holds the dominance we plan to take". */
    const byMaker24 = new Map();
    for (const t of arr) {
      const ts = Date.parse(String(t.date).endsWith("Z") ? t.date : `${t.date}Z`);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const cur = t.current_pays ?? "", opn = t.open_pays ?? "";
      const curSym = String(cur).split(" ")[1] ?? "", opnSym = String(opn).split(" ")[1] ?? "";
      let hive = 0;
      if (curSym === "HIVE" && opnSym === "HBD") hive = num(cur);
      else if (curSym === "HBD" && opnSym === "HIVE") hive = num(opn);
      if (!(hive > 0)) continue;
      const mk = String(t.maker ?? "").trim();
      if (!mk) continue;
      const e = byMaker24.get(mk) ?? { fills: 0, hive: 0 };
      e.fills += 1; e.hive += hive;
      byMaker24.set(mk, e);
    }
    const leaders24 = [...byMaker24.entries()]
      .map(([account, e]) => ({ account, fills: e.fills, hiveVol: r4(e.hive), volShare: e.hive > 0 ? Math.round((e.hive / in24.reduce((s, r) => s + r.hive, 0)) * 1e4) / 1e4 : 0 }))
      .sort((a, b) => b.hiveVol - a.hiveVol);
    fills = {
      api: apiThatAnswered, fetched: arr.length, in24h: in24.length,
      coveredHours: r4(coveredHours),
      volHiveInCoveredSpan: r4(volSum),
      volHivePerDayNormalized: coveredHours > 0 ? r4((volSum / coveredHours) * 24) : null,
      sizeP50: sizes.length ? r4(sizes[Math.floor(sizes.length / 2)]) : null,
      sizeP90: sizes.length ? r4(sizes[Math.floor(sizes.length * 0.9)]) : null,
      pxMin: in24.length ? Math.round(Math.min(...in24.map((r) => r.px)) * 1e6) / 1e6 : null,
      pxMax: in24.length ? Math.round(Math.max(...in24.map((r) => r.px)) * 1e6) / 1e6 : null,
      leaders24Top8: leaders24.slice(0, 8),
      leaderCount24: leaders24.length,
      top1VolShare: leaders24.length ? leaders24[0].volShare : null,
      top3VolShare: leaders24.length >= 3 ? Math.round((leaders24[0].volShare + leaders24[1].volShare + leaders24[2].volShare) * 1e4) / 1e4 : null,
      ourAccountInLeaders: leaders24.some((l) => l.account === (process.env.SAOS_ACCOUNT || "headcorner")),
    };
    break;
  } catch (e) { /* next form */ }
}

/* 2 · volume read (the sensor's existing source) */
const vol = await rpc("condenser_api.get_volume", []);
const getVol = { hiveVolume24h: num(vol?.hive_volume), hbdVolume24h: num(vol?.hbd_volume) };

/* 3 · the USD leg */
let hiveUsd = null, usdSource = "none";
try { const b = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=HIVEUSDT", { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)); if (b?.price) { hiveUsd = Number(b.price); usdSource = "binance:HIVEUSDT"; } } catch { /* ladder */ }
if (!(hiveUsd > 0)) {
  try { const g = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hive&vs_currencies=usd", { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)); const v = Number(g?.hive?.usd) || 0; if (v > 0) { hiveUsd = v; usdSource = "coingecko:hive"; } } catch { /* ladder */ }
}

/* 4 · the book spread (re-measured here, not trusted from state) */
const book = await rpc("condenser_api.get_order_book", [50]);
const bestAsk = num(book?.asks?.[0]?.real_price), bestBid = num(book?.bids?.[0]?.real_price);
const spreadBps = bestAsk > 0 && bestBid > 0 ? Math.round(((bestAsk - bestBid) / bestBid) * 1e4 * 10) / 10 : null;

/* 5 · the honest multi-pond table */
const pond = fills?.volHivePerDayNormalized ?? getVol.hiveVolume24h; // two independent reads to compare
const pondSource = fills?.volHivePerDayNormalized ? "recent-trades-normalized" : "get_volume";
const usd = (x) => (Number.isFinite(x) && hiveUsd > 0 ? r4(x * hiveUsd) : null);
const table = pond > 0 && spreadBps > 0 ? {
  pondHivePerDay: r4(pond), pondSource,
  pondUsdPerDay: usd(pond), spreadBps,
  capturePerShare: {
    share6p5: { hivePerDay: r4(pond * (spreadBps / 1e4) * 0.065), usdPerDay: usd(pond * (spreadBps / 1e4) * 0.065) },
    share25: { hivePerDay: r4(pond * (spreadBps / 1e4) * 0.25), usdPerDay: usd(pond * (spreadBps / 1e4) * 0.25) },
    share100: { hivePerDay: r4(pond * (spreadBps / 1e4)), usdPerDay: usd(pond * (spreadBps / 1e4)) },
  },
} : null;

const out = { at: now.toISOString(), fills, shapeSample, ownerFieldSeen, getVol, hiveUsd, usdSource, spreadBps, bestAsk, bestBid, table, note: "read-only probe — zero orders, zero keys" };
console.log(JSON.stringify(out, null, 2));
