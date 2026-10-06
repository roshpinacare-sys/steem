// r194-b M1b: extra keyless fallbacks for BLURT/SBD price + raw book field inspection
const OUT = new URL("./r194b-prices-extra.json", import.meta.url).pathname;

async function probe(name, url, opts = {}, parse) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(url, { signal: ctl.signal, headers: { "accept": "application/json", "user-agent": "weave-r194b/1.0" }, ...opts });
    clearTimeout(timer);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
    return { name, url, status: res.status, ms: Date.now() - t0, ok: res.ok, price: parse ? parse(res.status, body) : null, bodyPreview: JSON.stringify(body).slice(0, 600) };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

const probes = [
  probe("mexc-blurt", "https://api.mexc.com/api/v3/ticker/price?symbol=BLURTUSDT", {}, (s, b) => (s === 200 && b && b.price) ? { usd: Number(b.price), pair: b.symbol } : null),
  probe("poloniex-blurt", "https://api.poloniex.com/markets/BLURT_USDT/price", {}, (s, b) => (s === 200 && b && (b.price || b.rate)) ? { usd: Number(b.price ?? b.rate) } : null),
  probe("binance-blurt-doc", "https://api.binance.com/api/v3/ticker/price?symbol=BLURTUSDT", {}, (s, b) => (s === 200 && b && b.price) ? { usd: Number(b.price) } : null),
  probe("coinlore-blurt", "https://api.coinlore.net/api/tickers/?start=0&limit=100", {}, (s, b) => {
    if (s === 200 && b && b.data) {
      const hit = b.data.find((c) => (c.symbol || "").toUpperCase() === "BLURT");
      return hit ? { usd: Number(hit.price_usd), id: hit.id } : { hit: false };
    }
    return null;
  }),
  probe("paprika-sbd-search", "https://api.coinpaprika.com/v1/search/?q=steem%20dollar&c=currencies&limit=5", {}, (s, b) => {
    if (s === 200 && b && Array.isArray(b.currencies)) return b.currencies.map((c) => ({ id: c.id, symbol: c.symbol, active: c.is_active, rank: c.rank }));
    return null;
  }),
  probe("paprika-blurt-ticker-direct", "https://api.coinpaprika.com/v1/tickers/blurt-blurt?quotes=USD", {}, (s, b) => {
    if (s === 200 && b && b.quotes && b.quotes.USD) return { usd: b.quotes.USD.price };
    return null;
  }),
  probe("coinpaprika-steem", "https://api.coinpaprika.com/v1/tickers/steem-steem", {}, (s, b) => (s === 200 && b && b.quotes && b.quotes.USD) ? { usd: b.quotes.USD.price, active: b.is_active } : null),
];

const results = [];
for (const p of probes) results.push(await p);

// raw book field inspection for qty parsing fix
async function rawBook(endpoint) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(endpoint, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_order_book", params: [2] }) });
    clearTimeout(timer);
    return await res.json();
  } catch (e) { clearTimeout(timer); return { error: String(e) }; }
}
const steemRaw = await rawBook("https://api.steemit.com");
const hiveRaw = await rawBook("https://api.hive.blog");

await Bun.write(OUT, JSON.stringify({ at: new Date().toISOString(), probes: results, steemBookFields: steemRaw, hiveBookFields: hiveRaw }, null, 2));
console.log(JSON.stringify({ probes: results.map(({ name, status, ok, price, error }) => ({ name, status, ok, price, error })), steemBidSample: steemRaw?.result?.bids?.[0], hiveBidSample: hiveRaw?.result?.bids?.[0] }, null, 2));
