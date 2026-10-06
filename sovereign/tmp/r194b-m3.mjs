// r194-b M3: Hive Engine market.metrics — top 10 by 24h volume (read-only)
// Output: r194b-hive-engine.json
async function heFind(limit = 100) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch("https://api.hive-engine.com/rpc/contracts", {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "user-agent": "weave-r194b/1.0" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "find",
        params: { contract: "market", table: "metrics", query: {}, limit, offset: 0, indexes: [] },
      }),
    });
    clearTimeout(timer);
    const j = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, j };
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

const r = await heFind(200);
let rows = [];
if (r.ok && r.j && Array.isArray(r.j.result)) rows = r.j.result;
const scored = rows
  .map((m) => ({
    symbol: m.symbol,
    volume24h: parseFloat(m.volume || "0"),
    lastPrice: m.lastPrice ? parseFloat(m.lastPrice) : null,
    lastDayPrice: m.lastDayPrice ? parseFloat(m.lastDayPrice) : null,
    priceChangePct: m.priceChangePercent !== undefined ? parseFloat(m.priceChangePercent) : null,
  }))
  .sort((a, b) => b.volume24h - a.volume24h);

const top10 = scored.slice(0, 10);
const sumVolume = scored.reduce((a, b) => a + b.volume24h, 0);
const find = (sym) => scored.find((s) => s.symbol === sym) || null;
const out = {
  at: new Date().toISOString(),
  endpoint: "https://api.hive-engine.com/rpc/contracts",
  method: "find contract=market table=metrics",
  marketsSeen: scored.length,
  sumVolumeAll: Number(sumVolume.toFixed(2)),
  top10ByVolume: top10,
  SWAP_HBD: find("SWAP.HBD"),
  SWAP_STEEM: find("SWAP.STEEM"),
  SWAP_HIVE: find("SWAP.HIVE"),
  DEC: find("DEC"),
  error: r.ok ? null : (r.error || `status ${r.status}`),
};
await Bun.write(new URL("./r194b-hive-engine.json", import.meta.url).pathname, JSON.stringify({ out, rawSample: rows.slice(0, 5) }, null, 2));
console.log(JSON.stringify(out, null, 2));
