// ─────────────────────────────────────────────────────────────────────────────
// SAOS — live market snapshot for the SBD→STEEM convert mechanics.
// Single source of truth, shared by /api/ops/prepare and /api/ops/watch.
// READ-ONLY: condenser_api calls only, no keys, no broadcast.
//
// ROAST CORRECTION (docs/ROAST.md, verified empirically against the chain):
//   1. The operative conversion price is `current_median_history` (base/quote
//      RATIO ≈ 0.104 SBD/STEEM) — NOT `price_history[0]` (a stale witness-quote
//      series stuck at 0.044-0.046). Reading the wrong field produced the
//      fictional "+115% window" of wave-4. Zero convert fills exist chain-wide
//      at a true +115% premium — economic proof the operative feed is 0.104.
//   2. Selling converted STEEM happens into the BIDS, not the asks.
//   3. SBD trades at ≈ its redemption value (small discount) — equilibrium.
//      The window is EPISODIC: it opens only when the operative feed drops
//      well below the market bid (or vice-versa). This watcher's job is to
//      detect that honestly when it happens.
// ─────────────────────────────────────────────────────────────────────────────

const RPC_URL = "https://api.steemit.com";

/** Watcher key shared by WindowSample/WatchAlert rows. */
export const WINDOW_KEY = "BOT3_SBD_CONVERT";

/** A window counts as "open" above this executable edge (%). Conservative:
 * below it the 3.5-day STEEM price exposure is not worth the cycle. */
export const WINDOW_OPEN_THRESHOLD_PCT = 10;

/** Reference convert size for the depth-aware executable edge (SBD). */
export const EXEC_SIZE_SBD = 100;

export interface DepthQuote {
  sizeSbd: number;
  steemToSell: number;
  vwapSbdPerSteem: number;
  proceedsSbd: number;
  execEdgePct: number;
  filled: boolean;
}

export interface MarketSnapshot {
  /** Operative conversion feed (current_median_history ratio), SBD per STEEM. */
  feed: number;
  /** Median of the top-21 witness quotes — the (non-operative) peg fantasy. */
  witnessQuoteMedian: number;
  /** Best bid (SBD per STEEM) — where converted STEEM would actually sell. */
  bidTop: number;
  /** Best ask (SBD per STEEM) — where STEEM would be bought back. */
  askTop: number;
  /** STEEM received per 1 SBD at convert maturity (1/feed). */
  steemPerSbd: number;
  /** Top-of-book cycle edge using the bid: (steemPerSbd * bidTop - 1) * 100. */
  edgeInternalPct: number;
  /** Depth-aware edge at EXEC_SIZE_SBD (VWAP walk over bids). */
  execEdgePct: number;
  /** Depth quotes for reference sizes (10/100/500 SBD). */
  depth: DepthQuote[];
  /** 24h internal-market real volume as reported by the node. */
  vol24h: { sbd: number; steem: number; trades: number } | null;
  /** edgeInternalPct >= WINDOW_OPEN_THRESHOLD_PCT (top-of-book proxy). */
  open: boolean;
  /** execEdgePct at EXEC_SIZE_SBD >= WINDOW_OPEN_THRESHOLD_PCT. */
  openExec: boolean;
  headBlock: number | null;
  sampledAt: string;
}

interface FeedHistoryShape {
  current_median_history?: { base?: string; quote?: string } | null;
  price_history?: { base: string; quote: string }[];
}
interface OrderBookShape {
  bids?: { real_price?: string; order_price?: { base: string; quote: string } }[];
  asks?: { real_price?: string; order_price?: { base: string; quote: string } }[];
}
interface TradeShape {
  current_pays: string;
  open_pays: string;
}
interface DgpShape {
  head_block_number?: number;
}

let rpcId = 800;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
  return json.result as T;
}

function parseAsset(a: string | undefined | null): number {
  if (!a) return 0;
  return parseFloat(a.split(" ")[0]) || 0;
}

function priceOf(p: { real_price?: string; order_price?: { base: string; quote: string } } | undefined): number {
  if (!p) return 0;
  if (p.real_price) return parseFloat(p.real_price) || 0;
  if (p.order_price) {
    const b = parseAsset(p.order_price.base);
    const q = parseAsset(p.order_price.quote);
    if (q > 0) return b / q;
  }
  return 0;
}

/** Median of the top-N witness sbd_exchange_rate quotes (the peg series). */
function witnessMedian(quotes: number[]): number {
  const v = quotes.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** VWAP walk: sell `steemToSell` into the bids (best first). */
function walkBids(
  bids: { price: number; steem: number }[],
  steemToSell: number,
): { vwap: number; proceeds: number; filled: boolean } {
  let rem = steemToSell;
  let proceeds = 0;
  for (const lvl of bids) {
    if (rem <= 0) break;
    const take = Math.min(rem, lvl.steem);
    proceeds += take * lvl.price;
    rem -= take;
  }
  if (steemToSell <= 0) return { vwap: 0, proceeds: 0, filled: false };
  return { vwap: proceeds / steemToSell, proceeds, filled: rem <= 1e-9 };
}

/** Live operative feed + internal book + BOT-3 window math. */
export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const [feedHist, book, dgp, witnessList, trades] = await Promise.all([
    rpc<FeedHistoryShape>("condenser_api.get_feed_history", []),
    rpc<OrderBookShape>("condenser_api.get_order_book", [50]),
    rpc<DgpShape>("condenser_api.get_dynamic_global_properties", []).catch(
      () => null as DgpShape | null,
    ),
    rpc<{ sbd_exchange_rate?: { base?: string; quote?: string } }[]>(
      "condenser_api.get_witnesses_by_vote",
      ["", 21],
    ).catch(() => [] as { sbd_exchange_rate?: { base?: string; quote?: string } }[]),
    rpc<TradeShape[]>("condenser_api.get_trade_history", [
      new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19),
      new Date().toISOString().slice(0, 19),
      1000,
    ]).catch(() => null as TradeShape[] | null),
  ]);

  // ── Operative feed: current_median_history base/quote ratio ──────────────
  let feed = 0;
  const cm = feedHist?.current_median_history;
  if (cm?.base && cm?.quote) {
    const q = parseAsset(cm.quote);
    if (q > 0) feed = parseAsset(cm.base) / q;
  }
  if (feed <= 0 && feedHist?.price_history?.length) {
    // last-resort fallback: newest witness-quote entry (still better than 0)
    const last = feedHist.price_history[feedHist.price_history.length - 1];
    const q = parseAsset(last?.quote);
    if (q > 0) feed = parseAsset(last?.base) / q;
  }

  const wq = witnessList
    .map((w) => {
      const r = w?.sbd_exchange_rate;
      const q = parseAsset(r?.quote);
      return q > 0 ? parseAsset(r?.base) / q : 0;
    })
    .filter((x) => x > 0);
  const witnessQuoteMedian = witnessMedian(wq);

  const bids = (book?.bids ?? [])
    .map((b) => ({ price: priceOf(b), steem: parseAsset(String((b as { steem?: string }).steem ?? "")) }))
    .filter((b) => b.price > 0 && b.steem > 0);
  const asks = (book?.asks ?? []).map((a) => priceOf(a)).filter((p) => p > 0);
  const bidTop = bids[0]?.price ?? 0;
  const askTop = asks[0] ?? 0;

  const steemPerSbd = feed > 0 ? 1 / feed : 0;
  const edgeInternalPct =
    feed > 0 && bidTop > 0 ? (steemPerSbd * bidTop - 1) * 100 : 0;

  const sizes = [10, EXEC_SIZE_SBD, 500];
  const depth: DepthQuote[] = sizes.map((sizeSbd) => {
    const steemToSell = feed > 0 ? sizeSbd / feed : 0;
    const w = walkBids(bids, steemToSell);
    return {
      sizeSbd,
      steemToSell,
      vwapSbdPerSteem: Number(w.vwap.toFixed(6)),
      proceedsSbd: Number(w.proceeds.toFixed(4)),
      execEdgePct: Number(((w.proceeds / sizeSbd - 1) * 100).toFixed(2)),
      filled: w.filled,
    };
  });
  const exec100 = depth.find((d) => d.sizeSbd === EXEC_SIZE_SBD)!;
  const execEdgePct = exec100.execEdgePct;

  let vol24h: MarketSnapshot["vol24h"] = null;
  if (Array.isArray(trades)) {
    let sbd = 0;
    let steem = 0;
    for (const t of trades) {
      if (t.current_pays?.endsWith("SBD")) sbd += parseAsset(t.current_pays);
      else if (t.current_pays?.endsWith("STEEM")) steem += parseAsset(t.current_pays);
      if (t.open_pays?.endsWith("SBD")) sbd += parseAsset(t.open_pays);
      else if (t.open_pays?.endsWith("STEEM")) steem += parseAsset(t.open_pays);
    }
    vol24h = { sbd: Number(sbd.toFixed(2)), steem: Number(steem.toFixed(2)), trades: trades.length };
  }

  return {
    feed,
    witnessQuoteMedian: Number(witnessQuoteMedian.toFixed(6)),
    bidTop,
    askTop,
    steemPerSbd,
    edgeInternalPct,
    execEdgePct,
    depth,
    vol24h,
    open: edgeInternalPct >= WINDOW_OPEN_THRESHOLD_PCT,
    openExec: execEdgePct >= WINDOW_OPEN_THRESHOLD_PCT,
    headBlock: dgp?.head_block_number ?? null,
    sampledAt: new Date().toISOString(),
  };
}
