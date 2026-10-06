// r194-b M2: Steem + Hive internal market refresh (condenser JSON-RPC, read-only)
// Output: r194b-steem-book.json + r194b-hive-book.json
async function rpc(endpoint, method, params) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "user-agent": "weave-r194b/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    clearTimeout(timer);
    const j = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, j };
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

// condenser amounts look like "123.456 UNIT"
const amt = (s) => (typeof s === "string" ? parseFloat(s) : NaN);

// condenser order fields: { order_price:{base,quote}, real_price, baseQtyField, quoteQtyField, created }
// Steem: steem/sbd numeric (milli-units ×1000) · Hive: hive/hbd
function bookStats(buy, sell, baseField, quoteField) {
  const rows = (arr) => (arr || []).slice(0, 5).map((x) => ({
    price: amt(x.real_price),
    qty: (x[baseField] || 0) / 1000,      // base asset units (STEEM/HIVE)
    value: (x[quoteField] || 0) / 1000,   // quote asset units (SBD/HBD)
  }));
  const bids = rows(buy);
  const asks = rows(sell);
  const topBid = bids[0]?.price ?? null;
  const topAsk = asks[0]?.price ?? null;
  const mid = topBid && topAsk ? (topBid + topAsk) / 2 : null;
  const spreadBps = topBid && topAsk ? ((topAsk - topBid) / mid) * 10000 : null;
  const bidDepthBase = bids.reduce((a, b) => a + (b.qty || 0), 0);
  const bidDepthQuote = bids.reduce((a, b) => a + (b.value || 0), 0);
  const askDepthBase = asks.reduce((a, b) => a + (b.qty || 0), 0);
  const askDepthQuote = asks.reduce((a, b) => a + (b.value || 0), 0);
  return { bids, asks, topBid, topAsk, mid, spreadBps: spreadBps === null ? null : Number(spreadBps.toFixed(2)), bidDepthTop5: bidDepthBase, bidDepthTop5Quote: bidDepthQuote, askDepthTop5: askDepthBase, askDepthTop5Quote: askDepthQuote };
}

async function refresh(name, endpoint, base, quote) {
  const [book, feed, vol] = [
    await rpc(endpoint, "condenser_api.get_order_book", [10]),
    await rpc(endpoint, "condenser_api.get_current_median_history_price", []),
    await rpc(endpoint, "condenser_api.get_volume", []),
  ];
  let stats = null;
  if (book.ok && book.j && book.j.result) stats = name === "steem" ? bookStats(book.j.result.bids, book.j.result.asks, "steem", "sbd") : bookStats(book.j.result.bids, book.j.result.asks, "hive", "hbd");
  const feedPrice = feed.ok && feed.j && feed.j.result
    ? amt(feed.j.result.base?.amount ?? feed.j.result.base) / (amt(feed.j.result.quote?.amount ?? feed.j.result.quote) || 1)
    : null;
  const out = {
    at: new Date().toISOString(),
    endpoint, market: `${base}/${quote}`,
    bookError: book.ok ? null : (book.error || `status ${book.status}`),
    feed: feed.ok && feed.j && feed.j.result ? { raw: feed.j.result, price: feedPrice } : { error: feed.error || `status ${feed.status}` },
    volume: vol.ok && vol.j && vol.j.result ? vol.j.result : { error: vol.error || `status ${vol.status}` },
    book: stats,
  };
  await Bun.write(new URL(`./r194b-${name}-book.json`, import.meta.url).pathname, JSON.stringify(out, null, 2));
  return out;
}

const steem = await refresh("steem", "https://api.steemit.com", "STEEM", "SBD");
const hive = await refresh("hive", "https://api.hive.blog", "HIVE", "HBD");
console.log(JSON.stringify({ steem, hive }, null, 2));
