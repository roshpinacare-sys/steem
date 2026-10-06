// r194-b M1: BLURT + SBD price probes across keyless sources (read-only)
// 1 attempt each, 7s timeout, honest failures. Output: r194b-prices.json
const OUT = new URL("./r194b-prices.json", import.meta.url).pathname;

async function probe(name, url, opts = {}, parse) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "accept": "application/json", "user-agent": "weave-r194b/1.0 (keyless measurement)" },
      ...opts,
    });
    clearTimeout(timer);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    const price = parse ? parse(res.status, body) : undefined;
    return { name, url, status: res.status, ms: Date.now() - t0, ok: res.ok, price: price ?? null, bodyPreview: typeof body === "string" ? body : JSON.stringify(body).slice(0, 900) };
  } catch (e) {
    return { name, url, status: 0, ms: Date.now() - t0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

const probes = [
  // ---- BLURT ----
  probe("paprika-blurt-ticker", "https://api.coinpaprika.com/v1/tickers/blurt-blurt", {}, (s, b) => {
    if (s === 200 && b && Array.isArray(b.quotes) && b.quotes.USD && typeof b.quotes.USD.price === "number") return { usd: b.quotes.USD.price, active: b.is_active ?? null };
    return null;
  }),
  probe("paprika-blurt-search", "https://api.coinpaprika.com/v1/search/?q=blurt&c=currencies&limit=5", {}, (s, b) => {
    if (s === 200 && b && Array.isArray(b.currencies)) {
      const hit = b.currencies.find((c) => (c.symbol || "").toUpperCase() === "BLURT" || (c.id || "").includes("blurt"));
      return hit ? { found: hit.id, symbol: hit.symbol, active: hit.is_active ?? null } : { found: null, list: b.currencies.map((c) => ({ id: c.id, symbol: c.symbol, active: c.is_active })) };
    }
    return null;
  }),
  probe("coincap-blurt-search", "https://api.coincap.io/v2/assets?search=blurt", {}, (s, b) => {
    if (s === 200 && b && b.data && Array.isArray(b.data) && b.data.length) {
      const hit = b.data[0];
      return { id: hit.id, symbol: hit.symbol, priceUsd: hit.priceUsd !== undefined ? Number(hit.priceUsd) : null };
    }
    return null;
  }),
  probe("cryptocompare-blurt", "https://min-api.cryptocompare.com/data/price?fsym=BLURT&tsyms=USD", {}, (s, b) => {
    if (s === 200 && b && typeof b.USD === "number" && b.USD > 0) return { usd: b.USD };
    return null;
  }),
  probe("coingecko-blurt", "https://api.coingecko.com/api/v3/simple/price?ids=blurt&vs_currencies=usd", {}, (s, b) => {
    if (s === 200 && b && b.blurt && typeof b.blurt.usd === "number") return { usd: b.blurt.usd };
    return null;
  }),
  // ---- SBD backup ----
  probe("cryptocompare-sbd", "https://min-api.cryptocompare.com/data/price?fsym=SBD&tsyms=USD", {}, (s, b) => {
    if (s === 200 && b && typeof b.USD === "number" && b.USD > 0) return { usd: b.USD };
    return null;
  }),
  probe("paprika-sbd-ticker", "https://api.coinpaprika.com/v1/tickers/sbd-sbd", {}, (s, b) => {
    if (s === 200 && b && b.quotes && b.quotes.USD && typeof b.quotes.USD.price === "number") return { usd: b.quotes.USD.price, active: b.is_active ?? null };
    return null;
  }),
  probe("coingecko-sbd", "https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars&vs_currencies=usd", {}, (s, b) => {
    if (s === 200 && b && b["steem-dollars"] && typeof b["steem-dollars"].usd === "number") return { usd: b["steem-dollars"].usd };
    return null;
  }),
  probe("coincap-sbd-search", "https://api.coincap.io/v2/assets?search=steem%20dollars", {}, (s, b) => {
    if (s === 200 && b && b.data && Array.isArray(b.data) && b.data.length) {
      const hit = b.data[0];
      return { id: hit.id, symbol: hit.symbol, priceUsd: hit.priceUsd !== undefined ? Number(hit.priceUsd) : null };
    }
    return null;
  }),
  // bonus: STEEM center sanity from same sources
  probe("cryptocompare-steem", "https://min-api.cryptocompare.com/data/price?fsym=STEEM&tsyms=USD", {}, (s, b) => {
    if (s === 200 && b && typeof b.USD === "number" && b.USD > 0) return { usd: b.USD };
    return null;
  }),
];

const results = [];
for (const p of probes) results.push(await p);

const summary = {
  at: new Date().toISOString(),
  task: "r194-b M1",
  blurtSources: results.filter((r) => /blurt/.test(r.name)),
  sbdSources: results.filter((r) => /sbd/.test(r.name)),
  bonus: results.filter((r) => /steem$/.test(r.name)),
};
await Bun.write(OUT, JSON.stringify({ summary, raw: results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
