/**
 * capabilities.ts — Live "hidden capability" probes (Task 27).
 *
 * Answers the operator's question: "מה השרשרת מאפשרת שהיא לא ידעה שהיא
 * מאפשרת?" — with measurements, not opinions:
 *  - chain pulse: a census of real ops in the last N blocks (what actually
 *    flows right now: votes, claim_account factories, custom_json protocols,
 *    internal-market orders, beneficiary royalty splits).
 *  - internal market: live SBD/STEEM order book depth + feed price (the
 *    zero-fee rails everyone forgot exist — and their honest liquidity wall).
 *  - claim factory: available_account_subsidies (the RC→account mint pool).
 *  - fee schedule: protocol facts (transfer/custom_json/orders cost 0 — only
 *    RC), plus the measured fact that get_required_fees was REMOVED from
 *    public nodes (assert_exception on steemit + justyy, 2026-09-02).
 *
 * Read-only. Server-only. Never throws — callers degrade per-field.
 */

const RPC_URL = "https://api.steemit.com";
const CENSUS_BLOCKS = 24;

let capRpcId = 9000;
async function capRpc<T>(method: string, params: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++capRpcId }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message ?? "RPC error"}`);
    if (json.result === undefined) throw new Error(`${method}: empty result`);
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

export interface ChainPulse {
  headBlock: number
  blocksScanned: number
  emptyBlocks: number
  opTotal: number
  topOps: { op: string; count: number }[]
  /** custom_json id → count — which protocols actually run on the chain now. */
  customIds: { id: string; count: number }[]
  /** Sidechain-token ops observed (ssc-mainnet-steem / scot / sm_*) — expected ~0. */
  sidechainTokenOps: number
  /** claim_account minted by others in the sample — proof the RC factory runs. */
  claimAccountsOthers: number
  /** Beneficiary royalty splits observed (comment_benefactor_reward). */
  beneficiarySplits: number
  /** Internal-market orders observed (limit_order_create). */
  marketOrders: number
}

export interface MarketSnapshot {
  feedSbdPerSteem: number
  bestAskSbdPerSteem: number | null
  bestBidSbdPerSteem: number | null
  spreadPct: number | null
  /** Visible sell-side depth in SBD (top 10 orders). */
  depthAsksSbd: number
  /** Visible buy-side depth in STEEM (top 10 orders). */
  depthBidsSteem: number
}

export interface ClaimPool {
  availableSubsidies: number
  /** Full pool ≈ this many accounts (pool refills via RC burn of proposers). */
  note: string
}

export interface CapabilitySnapshot {
  ok: boolean
  fetchedAt: string
  pulse: ChainPulse | null
  market: MarketSnapshot | null
  claimPool: ClaimPool | null
  dgp: { headBlock: number; sbdSupply: number; steemSupply: number; contentRewardPct: number } | null
  errors: string[]
}

async function scanPulse(): Promise<{ pulse: ChainPulse; headBlock: number }> {
  const dgp = await capRpc<{ head_block_number: number }>(
    "condenser_api.get_dynamic_global_properties",
    [],
  );
  const head = dgp.head_block_number;
  const tally = new Map<string, number>();
  const custom = new Map<string, number>();
  let empty = 0;
  type OpRecord = { op: [string, Record<string, unknown>] };
  for (let b = head - CENSUS_BLOCKS; b < head; b++) {
    const ops = (await capRpc<OpRecord[]>("condenser_api.get_ops_in_block", [b, false]).catch(
      () => [] as OpRecord[],
    )) as OpRecord[];
    if (!ops || ops.length === 0) {
      empty++;
      continue;
    }
    for (const rec of ops) {
      const [type, value] = rec.op;
      tally.set(type, (tally.get(type) ?? 0) + 1);
      if (type === "custom_json") {
        const id = String((value as { id?: string }).id ?? "?");
        custom.set(id, (custom.get(id) ?? 0) + 1);
      }
    }
  }
  const opTotal = [...tally.values()].reduce((a, b) => a + b, 0);
  const sidechainIds = [...custom.keys()].filter((id) =>
    /^ssc-|scot_|sm_/i.test(id),
  );
  const sidechainTokenOps = sidechainIds.reduce((a, id) => a + (custom.get(id) ?? 0), 0);
  const pulse: ChainPulse = {
    headBlock: head,
    blocksScanned: CENSUS_BLOCKS,
    emptyBlocks: empty,
    opTotal,
    topOps: [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([op, count]) => ({ op, count })),
    customIds: [...custom.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => ({ id, count })),
    sidechainTokenOps,
    claimAccountsOthers: tally.get("claim_account") ?? 0,
    beneficiarySplits: tally.get("comment_benefactor_reward") ?? 0,
    marketOrders: tally.get("limit_order_create") ?? 0,
  };
  return { pulse, headBlock: head };
}

async function scanMarket(): Promise<MarketSnapshot> {
  type Book = {
    asks: { real_price: string; sbd: number; steem: number }[];
    bids: { real_price: string; sbd: number; steem: number }[];
  };
  const [book, feed] = await Promise.all([
    capRpc<Book>("condenser_api.get_order_book", [10]),
    capRpc<{ current_median_history: { base: string; quote: string } }>(
      "condenser_api.get_feed_history",
      [],
    ),
  ]);
  const { base, quote } = feed.current_median_history;
  const feedSbdPerSteem = parseFloat(base.split(" ")[0]) / (parseFloat(quote.split(" ")[0]) || 1);
  // Order-book amounts are scaled by 1e3 on condenser (measured live).
  const bestAsk = book.asks?.[0] ? parseFloat(book.asks[0].real_price) : null;
  const bestBid = book.bids?.[0] ? parseFloat(book.bids[0].real_price) : null;
  return {
    feedSbdPerSteem,
    bestAskSbdPerSteem: bestAsk,
    bestBidSbdPerSteem: bestBid,
    spreadPct: bestAsk && bestBid ? ((bestAsk - bestBid) / bestAsk) * 100 : null,
    depthAsksSbd: (book.asks ?? []).reduce((a, o) => a + (o.sbd ?? 0), 0) / 1000,
    depthBidsSteem: (book.bids ?? []).reduce((a, o) => a + (o.steem ?? 0), 0) / 1000,
  };
}

async function scanClaimPool(): Promise<ClaimPool> {
  const dgp = await capRpc<{ available_account_subsidies: number }>(
    "condenser_api.get_dynamic_global_properties",
    [],
  );
  return {
    availableSubsidies: dgp.available_account_subsidies ?? 0,
    note: "מלאי זכאויות חי — כל RC חוזר יוצר חשבון חדש בעמלה 0",
  };
}

async function scanDgp(): Promise<CapabilitySnapshot["dgp"]> {
  const dgp = await capRpc<{
    head_block_number: number;
    current_sbd_supply: string;
    current_supply: string;
    content_reward_percent: number;
  }>("condenser_api.get_dynamic_global_properties", []);
  return {
    headBlock: dgp.head_block_number,
    sbdSupply: parseFloat(dgp.current_sbd_supply?.split(" ")[0] ?? "0"),
    steemSupply: parseFloat(dgp.current_supply?.split(" ")[0] ?? "0"),
    contentRewardPct: (dgp.content_reward_percent ?? 6500) / 100,
  };
}

export async function fetchCapabilitySnapshot(): Promise<CapabilitySnapshot> {
  const errors: string[] = [];
  const [pulseR, marketR, poolR, dgpR] = await Promise.allSettled([
    scanPulse(),
    scanMarket(),
    scanClaimPool(),
    scanDgp(),
  ]);
  if (pulseR.status === "rejected") errors.push(`pulse: ${String(pulseR.reason).slice(0, 120)}`);
  if (marketR.status === "rejected") errors.push(`market: ${String(marketR.reason).slice(0, 120)}`);
  if (poolR.status === "rejected") errors.push(`pool: ${String(poolR.reason).slice(0, 120)}`);
  if (dgpR.status === "rejected") errors.push(`dgp: ${String(dgpR.reason).slice(0, 120)}`);
  return {
    ok: errors.length === 0,
    fetchedAt: new Date().toISOString(),
    pulse: pulseR.status === "fulfilled" ? pulseR.value.pulse : null,
    market: marketR.status === "fulfilled" ? marketR.value : null,
    claimPool: poolR.status === "fulfilled" ? poolR.value : null,
    dgp: dgpR.status === "fulfilled" ? dgpR.value : null,
    errors,
  };
}
