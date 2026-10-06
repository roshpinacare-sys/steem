// r194-b M1c: DEX-agg fallbacks for BLURT (BEP20 wrapped) + Paprika SBD ticker
const OUT = new URL("./r194b-prices-dex.json", import.meta.url).pathname;
const BLURT_BEP20 = "0xb0458283033e5a3f7867f409477f53754b667dcc";

async function probe(name, url, parse) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(url, { signal: ctl.signal, headers: { "accept": "application/json", "user-agent": "weave-r194b/1.0" } });
    clearTimeout(timer);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
    return { name, url, status: res.status, ms: Date.now() - t0, ok: res.ok, price: parse ? parse(res.status, body) : null, bodyPreview: JSON.stringify(body).slice(0, 800) };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

const probes = [
  probe("dexscreener-blurt-bep20", `https://api.dexscreener.com/latest/dex/tokens/${BLURT_BEP20}`, (s, b) => {
    if (s === 200 && b && Array.isArray(b.pairs) && b.pairs.length) {
      const withPrice = b.pairs.filter((p) => p.priceUsd).sort((a, c) => (c.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      if (withPrice.length) {
        const top = withPrice[0];
        return { usd: Number(top.priceUsd), dex: top.dexId, pair: `${top.baseToken?.symbol}/${top.quoteToken?.symbol}`, liqUsd: top.liquidity?.usd ?? null, vol24h: top.volume?.h24 ?? null, pairsFound: b.pairs.length };
      }
      return { noPrice: true, pairsFound: b.pairs.length };
    }
    return null;
  }),
  probe("geckoterminal-blurt-bep20", `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${BLURT_BEP20}`, (s, b) => {
    if (s === 200 && b && b.data && b.data.attributes) {
      const a = b.data.attributes;
      return { usd: a.price_usd !== null ? Number(a.price_usd) : null, symbol: a.symbol, name: a.name, vol24h: a.volume_usd?.h24 ?? null };
    }
    return null;
  }),
  probe("paprika-sbd-ticker", "https://api.coinpaprika.com/v1/tickers/sbd-steem-dollars", (s, b) => (s === 200 && b && b.quotes && b.quotes.USD) ? { usd: b.quotes.USD.price, active: b.is_active } : null),
  probe("mexc-blurt-listcheck", "https://api.mexc.com/api/v3/ticker/price", (s, b) => {
    if (s === 200 && Array.isArray(b)) {
      const hits = b.filter((t) => (t.symbol || "").includes("BLURT"));
      return hits.length ? hits : { listed: false };
    }
    return null;
  }),
];

const results = [];
for (const p of probes) results.push(await p);
await Bun.write(OUT, JSON.stringify({ at: new Date().toISOString(), probes: results }, null, 2));
console.log(JSON.stringify(results.map(({ name, status, ok, price, error }) => ({ name, status, ok, price, error })), null, 2));
