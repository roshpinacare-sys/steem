// r194-b M5: HIVE/USD + targeted Hive-Engine rows (SWAP.HIVE, SWAP.BLURT) for BLURT center derivation
const OUT = new URL("./r194b-center.json", import.meta.url).pathname;

async function probe(name, url, opts, parse) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(url, { signal: ctl.signal, headers: { "accept": "application/json", "user-agent": "weave-r194b/1.0" }, ...(opts || {}) });
    clearTimeout(timer);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { name, url, status: res.status, ms: Date.now() - t0, ok: res.ok, value: parse ? parse(res.status, body) : null, bodyPreview: JSON.stringify(body).slice(0, 500) };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

async function heFindOne(symbol) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch("https://api.hive-engine.com/rpc/contracts", {
      method: "POST", signal: ctl.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "find", params: { contract: "market", table: "metrics", query: { symbol }, limit: 1, offset: 0, indexes: [] } }),
    });
    clearTimeout(timer);
    const j = await res.json().catch(() => null);
    return j && Array.isArray(j.result) && j.result[0] ? j.result[0] : null;
  } catch { clearTimeout(timer); return null; }
}

const results = [];
results.push(await probe("paprika-hive-ticker", "https://api.coinpaprika.com/v1/tickers/hive-hive", null, (s, b) => (s === 200 && b && b.quotes && b.quotes.USD) ? { usd: b.quotes.USD.price, active: b.is_active } : null));
results.push(await probe("paprika-hive-search", "https://api.coinpaprika.com/v1/search/?q=hive&c=currencies&limit=5", null, (s, b) => (s === 200 && b && Array.isArray(b.currencies)) ? b.currencies.map((c) => ({ id: c.id, symbol: c.symbol, active: c.is_active })) : null));
results.push(await probe("coingecko-hive", "https://api.coingecko.com/api/v3/simple/price?ids=hive&vs_currencies=usd", null, (s, b) => (s === 200 && b && b.hive && typeof b.hive.usd === "number") ? { usd: b.hive.usd } : null));

const swapHive = await heFindOne("SWAP.HIVE");
const swapBlurt = await heFindOne("SWAP.BLURT");
const swapHbd = await heFindOne("SWAP.HBD");
const swapSteem = await heFindOne("SWAP.STEEM");

await Bun.write(OUT, JSON.stringify({ at: new Date().toISOString(), probes: results, heRows: { SWAP_HIVE: swapHive, SWAP_BLURT: swapBlurt, SWAP_HBD: swapHbd, SWAP_STEEM: swapSteem } }, null, 2));

const hiveUsd = results.find((r) => r.name === "paprika-hive-ticker")?.value?.usd ?? null;
const blurtHive = swapBlurt ? parseFloat(swapBlurt.lastPrice) : null;
console.log(JSON.stringify({
  probes: results.map(({ name, status, ok, value, error }) => ({ name, status, ok, value, error })),
  heRows: {
    SWAP_HIVE: swapHive && { lastPrice: swapHive.lastPrice, lowestAsk: swapHive.lowestAsk, highestBid: swapHive.highestBid, volume: swapHive.volume },
    SWAP_BLURT: swapBlurt && { lastPrice: swapBlurt.lastPrice, lowestAsk: swapBlurt.lowestAsk, highestBid: swapBlurt.highestBid, volume: swapBlurt.volume },
    SWAP_HBD: swapHbd && { lastPrice: swapHbd.lastPrice, volume: swapHbd.volume },
    SWAP_STEEM: swapSteem && { lastPrice: swapSteem.lastPrice, volume: swapSteem.volume },
  },
  derived: {
    hiveUsd,
    blurtHive,
    blurtUsdIfHive: (hiveUsd && blurtHive) ? Number((blurtHive * hiveUsd).toFixed(6)) : null,
  },
}, null, 2));
