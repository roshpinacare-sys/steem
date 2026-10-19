/**
 * measure.mjs — keyless chain/market measurement (fail-closed, ladder-nodes).
 * Everything here is public data: no keys, no secrets, no repos.
 *
 * T-9 additions vs the lost estate:
 *   - measureFuel: curation + author rewards measured DIRECTLY from
 *     account_history (7d window) → real $/day for the fuel & content rails
 *     (previously trusted a KPI file from a repo that vanished — now we
 *     measure ourselves; sovereignty = own your measurements).
 */

const NODES = [
  "https://steemapi.boylikegirl.club",
  "https://api.justyy.com",
  "https://api.steemit.com",
];

const NAI = { "@@000000013": "SBD", "@@000000021": "STEEM" };

export async function rpcCall(method, params, timeoutMs = 12000) {
  for (const node of NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;
      return { ok: true, result: d.result, node };
    } catch { /* next node */ }
  }
  return { ok: false, error: "all-nodes-failed" };
}

const amt = (x) => {
  if (typeof x === "string") {
    const [v, sym] = x.split(" ");
    return sym && Number(v) > 0 ? { v: Number(v), sym } : null;
  }
  const o = x;
  if (o && o.amount != null && o.nai) {
    const v = Number(o.amount) / 10 ** (o.precision ?? 3);
    const sym = NAI[o.nai] ?? o.nai;
    return v > 0 ? { v, sym } : null;
  }
  return null;
};

const opOf = (x) => {
  const raw = x?.op;
  if (Array.isArray(raw)) return { type: raw[0], value: raw[1] ?? {} };
  return { type: raw?.type ?? "", value: raw?.value ?? {} };
};

/* ── account history: big window where nodes allow, condenser fallback ───── */
export async function accountHistory(account, limit = 1000) {
  let r = await rpcCall("account_history_api.get_account_history", { account, start: -1, limit });
  if (r.ok) return { hist: r.result?.history ?? [], node: r.node, api: "ah_api" };
  r = await rpcCall("condenser_api.get_account_history", [account, -1, Math.min(limit, 100)]);
  if (r.ok) return { hist: r.result ?? [], node: r.node, api: "condenser" };
  return { hist: [], node: null, api: null };
}

/* ── external prices ladder (UNITS MATTER):
 *   steemUsd  — USD per STEEM (binance STEEMUSDT → coingecko steem)
 *   sbdUsd    — USD per SBD  (binance SBDBTC×BTCUSDT → coingecko steem-dollars)
 *   parity    — SBD per STEEM = steemUsd/sbdUsd  ← THE BOOK UNIT (all ladder
 *               prices on the internal market are SBD-per-STEEM).
 * Fallbacks degrade honestly and are marked in `source`. */
export async function externalParity() {
  let steemUsd = 0, sbdUsd = 0, source = "none";
  try {
    const [s, b] = await Promise.all([
      fetch("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const sbd = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SBDBTC", { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (s?.price) steemUsd = Number(s.price);
    if (sbd?.price && b?.price) sbdUsd = Number(sbd.price) * Number(b.price);
    if (steemUsd > 0 && sbdUsd > 0) source = "binance:STEEMUSDT+SBDBTC";
  } catch { /* ladder */ }
  if (!(steemUsd > 0) || !(sbdUsd > 0)) {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        if (!(steemUsd > 0)) steemUsd = Number(j?.steem?.usd) || 0;
        if (!(sbdUsd > 0)) sbdUsd = Number(j?.["steem-dollars"]?.usd) || 0;
        if (steemUsd > 0 && sbdUsd > 0) source = (source === "none" ? "" : source + "+") + "coingecko";
      }
    } catch { /* ladder */ }
  }
  // T-9: coingecko rate-limits aggressively (429/403 from some sandboxes) —
  // coinpaprika is the second independent STEEM source (no key, generous).
  if (!(steemUsd > 0)) {
    try {
      const r = await fetch("https://api.coinpaprika.com/v1/tickers/steem-steem", { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        const v = Number(j?.quotes?.USD?.price);
        if (v > 0) { steemUsd = v; source = (source === "none" ? "" : source + "+") + "coinpaprika"; }
      }
    } catch { /* ladder */ }
  }
  if (steemUsd > 0 && sbdUsd > 0) {
    return { steemUsd, sbdUsd, parity: steemUsd / sbdUsd, source };
  }
  // last resort: internal feed is SBD-per-STEEM by definition (marked, weaker).
  // T-9 honesty: in this fallback parity==feed so the band check is a tautology —
  // flagged lowConfidence so downstream gates can refuse auto-arming on it.
  // STRUCTURAL MARKET FACT (measured 2026-09-29): SBD is delisted from binance
  // (SBDBTC "Invalid symbol"), poloniex, upbit, mexc, lbank; coinpaprika marks
  // it is_active:false. The chain's own witness feed is now the only live
  // SBD↔STEEM anchor — sovereignty in its purest form.
  // T-18 (measured live 2026-09-30 17:47): the fallback used to emit sbdUsd=0 —
  // a BLIND dollar leg while the book still traded. The witness feed plus a
  // live steemUsd leg DERIVE an honest dollar estimate: sbdUsd ≈ steemUsd /
  // feed (identity holds by definition: feed = SBD per STEEM = steemUsd/sbdUsd).
  // Class-honest: lowConfidence stays TRUE, source names the derivation —
  // downstream gates keep refusing auto-arm on it; convert/parity cards stop
  // dividing by zero. When steemUsd itself is dead too, 0 stays 0 — no invention.
  const feed = await internalFeed();
  if (feed.median > 0) {
    const sbdDerived = steemUsd > 0 ? steemUsd / feed.median : 0;
    return {
      steemUsd: steemUsd || 0,
      sbdUsd: sbdDerived,
      parity: feed.median,
      source: sbdDerived > 0 ? "internal-feed-fallback+derived-sbd" : "internal-feed-fallback",
      lowConfidence: true,
    };
  }
  return { steemUsd: steemUsd || 0, sbdUsd: sbdUsd || 0, parity: 0, source: "none", lowConfidence: true };
}

export async function internalFeed() {
  const r = await rpcCall("condenser_api.get_feed_history", []);
  if (!r.ok) return { median: 0, source: "none" };
  const cm = r.result?.current_median_history;
  const b = amt(cm?.base), q = amt(cm?.quote);
  if (!b || !q || b.sym !== "SBD" || q.sym !== "STEEM" || !(q.v > 0)) return { median: 0, source: "none" };
  return { median: b.v / q.v, source: "condenser:get_feed_history" };
}

/* ── T-19 market pulse — THE NETWORK MEASURED, not assumed ─────────────────
 * The operator ordered real productivity; productivity begins with knowing
 * the market's actual throughput. Measured live 2026-09-30: the whole
 * STEEM/SBD internal market trades ~49 fills/24h — the honest ceiling any
 * market-maker can capture on this venue. Everything class-honest:
 * trades/volatility/depth are MEASURED, share-of-flow is DERIVED. */
export async function marketPulse({ windowHours = 24 } = {}) {
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600_000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "");
  const [tr, ob] = await Promise.all([
    rpcCall("market_history_api.get_trade_history", { start: iso(start), end: iso(end), limit: 1000 }),
    rpcCall("condenser_api.get_order_book", [50]),
  ]);
  const trades = tr.ok ? (tr.result?.trades ?? []) : [];
  const nai = (x) => (x && x.amount != null ? Number(x.amount) / 10 ** (x.precision ?? 3) : 0);
  const rows = [];
  for (const t of trades) {
    const cur = t.current_pays ?? {}, opn = t.open_pays ?? {};
    const cv = nai(cur), ov = nai(opn);
    if (!(cv > 0) || !(ov > 0)) continue;
    const curSym = NAI[cur.nai] ?? cur.nai, opnSym = NAI[opn.nai] ?? opn.nai;
    let px = null, steem = 0;
    if (curSym === "SBD" && opnSym === "STEEM") { px = cv / ov; steem = ov; }
    else if (curSym === "STEEM" && opnSym === "SBD") { px = ov / cv; steem = cv; }
    if (px != null && px > 0) rows.push({ at: t.date, px, steem });
  }
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const pxs = rows.map((r) => r.px).sort((a, b) => a - b);
  const book = ob.ok ? ob.result : null;
  const bestAsk = book?.asks?.[0]?.real_price ? Number(book.asks[0].real_price) : null;
  const bestBid = book?.bids?.[0]?.real_price ? Number(book.bids[0].real_price) : null;
  const askDepth = book?.asks?.length ? Math.round(book.asks.reduce((s, a) => s + (a.steem || 0), 0)) / 1000 : null;
  const bidDepthSbd = book?.bids?.length ? Math.round(book.bids.reduce((s, b) => s + (b.sbd || 0), 0)) / 1000 : null;
  const hours = Math.max(0.1, windowHours);
  const sizeSorted = rows.map((r) => r.steem).sort((a, b) => a - b);
  return {
    at: end.toISOString(), windowHours,
    class: "measured",
    trades: rows.length,
    tradesPerDay: Math.round((rows.length / hours) * 24 * 100) / 100,
    volSteem: Math.round(rows.reduce((s, r) => s + r.steem, 0) * 1000) / 1000,
    priceMin: pxs.length ? Math.round(pxs[0] * 1e6) / 1e6 : null,
    priceMax: pxs.length ? Math.round(pxs[pxs.length - 1] * 1e6) / 1e6 : null,
    rangeBps: pxs.length && pxs[0] > 0 ? Math.round(((pxs[pxs.length - 1] - pxs[0]) / pxs[0]) * 10000) : null,
    sizeP50: sizeSorted.length ? Math.round(sizeSorted[Math.floor(sizeSorted.length / 2)] * 1000) / 1000 : null,
    sizeP90: sizeSorted.length ? Math.round(sizeSorted[Math.floor(sizeSorted.length * 0.9)] * 1000) / 1000 : null,
    book: { bestAsk, bestBid, spreadBps: bestAsk > 0 && bestBid > 0 ? Math.round(((bestAsk - bestBid) / bestBid) * 10000 * 100) / 100 : null, askDepthSteem: askDepth, bidDepthSbd },
  };
}

export async function accountState(account) {
  const [a, rc, dyn] = await Promise.all([
    rpcCall("condenser_api.get_accounts", [[account]]),
    rpcCall("rc_api.find_rc_accounts", { accounts: [account] }),
    rpcCall("condenser_api.get_dynamic_global_properties", []),
  ]);
  const acc = a.ok ? a.result?.[0] : null;
  const rcAcc = rc.ok ? rc.result?.rc_accounts?.[0] : null;
  const out = {
    ok: !!acc,
    node: a.node ?? null,
    steem: null, sbd: null, vests: null, spOwn: null, rcPct: null,
    totalVestingShares: null, totalVestingFund: null,
    delegIn: null,
  };
  if (acc) {
    const bal = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
    out.steem = bal(acc.balance);
    out.sbd = bal(acc.sbd_balance);
    out.vests = bal(acc.vesting_shares);
    const tvs = dyn.ok ? dyn.result?.total_vesting_shares : null;
    const tvf = dyn.ok ? dyn.result?.total_vesting_fund_steem : null;
    if (tvs && tvf) {
      const V = (s) => Number(String(s).split(" ")[0]) || 0;
      out.totalVestingShares = V(tvs);
      out.totalVestingFund = V(tvf);
      const vestsPerSp = V(tvs) / V(tvf);
      const delegInV = bal(acc.delegated_vesting_shares);
      out.delegIn = delegInV;
      /* W12-b · RECEIVED SUPPORT IS CAPACITY: the chain-judged lesson of the
       * round-1 ladder — spTotal was OWN-vests-only while every soldier
       * carries historical delegations IN (since 09-29). RC capacity is
       * OWN + RECEIVED; a planner that reads own-only re-delegates blind
       * and (SET semantics) REDUCES support. Both truths now measured. */
      const receivedV = bal(acc.received_vesting_shares);
      out.receivedVests = receivedV;
      out.spReceived = receivedV / vestsPerSp;
      out.spEffective = (out.vests + receivedV) / vestsPerSp;
      out.spOwn = (out.vests - delegInV) / vestsPerSp;
      out.spTotal = (out.vests) / vestsPerSp;
    }
    if (rcAcc) {
      const cur = parseInt(rcAcc.rc_manabar?.current_mana ?? "0", 10);
      const max = parseInt(rcAcc.max_rc ?? "0", 10);
      out.rcPct = max > 0 ? Math.round((cur / max) * 1000) / 10 : null;
    }
  }
  return out;
}

/* ── open orders (book state, keyless read) ──────────────────────────────── */
export async function openOrders(account) {
  const r = await rpcCall("condenser_api.get_open_orders", [account]);
  if (!r.ok) return { ok: false, orders: [] };
  const orders = (r.result ?? []).map((o) => {
    const sp = o.sell_price ?? {};
    const [bAmt, bSym] = String(sp.base ?? "? ?").split(" ");
    const [qAmt, qSym] = String(sp.quote ?? "? ?").split(" ");
    /* WAVE-91 UNIT FIX (measured 2026-10-16): unit is ALWAYS SBD-per-STEEM.
     * The old `quote/base` inverted BIDS (a 0.5 SBD→4.93 STEEM bid read as
     * 9.86 instead of 0.1014) — classifyStale then flagged EVERY real bid
     * stale every cycle (chronic self-churn) and the self-cross guard
     * "lifted" an ask to 10.18 against an imaginary 10.17 bid. */
    const isAsk = String(bSym).includes("STEEM");
    const unit = (Number(bAmt) > 0 && Number(qAmt) > 0)
      ? (isAsk ? Number(qAmt) / Number(bAmt) : Number(bAmt) / Number(qAmt))
      : 0;
    return {
      orderid: o.orderid,
      side: isAsk ? "ask" : "bid",
      base: `${bAmt} ${bSym}`,
      quote: `${qAmt} ${qSym}`,
      unit: Math.round(unit * 1e6) / 1e6,
      created: o.created,
    };
  });
  return { ok: true, orders };
}

/* ── real fills + rails fuel from ONE history window ─────────────────────── */
export async function measureAll(account, { window = 1000, nowMs = Date.now() } = {}) {
  const { hist, node, api } = await accountHistory(account, window);
  const fills = [];
  const curationVests = [];   // [tsMs, vests]
  const authorPayouts = [];   // [tsMs, sbd, steem, vests]
  let parseErr = "";
  const tsOf = (x) => x?.timestamp ? Date.parse(x.timestamp + (x.timestamp.endsWith("Z") ? "" : "Z")) : 0;
  try {
    for (const [, x] of hist ?? []) {
      const { type, value } = opOf(x);
      const ts = tsOf(x);
      if (type === "fill_order" || type === "fill_order_operation") {
        const cur = amt(value.current_pays), opn = amt(value.open_pays);
        if (!cur || !opn) continue;
        const isCur = value.current_owner === account;
        const mine = isCur ? cur : opn, theirs = isCur ? opn : cur;
        if (mine.sym === "STEEM" && theirs.sym === "SBD") fills.push({ seq: x?.trx_id ?? fills.length, at: ts, side: "ask", steem: mine.v, sbd: theirs.v });
        else if (mine.sym === "SBD" && theirs.sym === "STEEM") fills.push({ seq: x?.trx_id ?? fills.length, at: ts, side: "bid", steem: theirs.v, sbd: mine.v });
      } else if (type === "curation_reward" || type === "curation_reward_operation") {
        const v = amt(value.reward);
        if (v && v.sym === "VESTS") curationVests.push([ts, v.v]);
      } else if (type === "author_reward" || type === "author_reward_operation") {
        const sbd = amt(value.sbd_payout), st = amt(value.steem_payout), vs = amt(value.vesting_payout);
        authorPayouts.push([ts, sbd?.v ?? 0, st?.v ?? 0, vs?.v ?? 0]);
      }
    }
  } catch (e) { parseErr = String(e?.message ?? e).slice(0, 140); }

  const DAY = 86_400_000;
  const stamps = (hist ?? []).map(([, x]) => tsOf(x)).filter((t) => t > 0);
  const newest = stamps.length ? Math.max(...stamps) : 0;
  const oldest = stamps.length ? Math.min(...stamps) : 0;
  const spanDays = newest > oldest ? (newest - oldest) / DAY : 0;
  // per-day rates use the ACTUAL covered span (never extrapolate from a
  // shorter window as if it were 7d — honesty about denominators)
  const spanFor7 = Math.min(Math.max(spanDays, 1e-9), 7);
  const cur7 = curationVests.filter(([t]) => t >= nowMs - 7 * DAY);
  const vestsPerDay = cur7.length ? cur7.reduce((s, [, v]) => s + v, 0) / spanFor7 : 0;
  const auth7 = authorPayouts.filter(([t]) => t >= nowMs - 7 * DAY);
  const authorSbdPerDay = auth7.length ? auth7.reduce((s, [, a]) => s + a, 0) / spanFor7 : 0;
  const authorVestsPerDay = auth7.length ? auth7.reduce((s, [,, , v]) => s + v, 0) / spanFor7 : 0;
  const lastFillAt = fills.length ? Math.max(...fills.map((f) => f.at)) : null;

  return {
    ok: hist.length > 0, node, api, histLen: hist.length, window,
    fills, parseErr,
    lastFillAt: lastFillAt ? new Date(lastFillAt).toISOString() : null,
    fuel: {
      curationVestsPerDay: Math.round(vestsPerDay * 1e3) / 1e3,
      authorSbdPerDay: Math.round(authorSbdPerDay * 1e6) / 1e6,
      authorVestsPerDay: Math.round(authorVestsPerDay * 1e3) / 1e3,
      curationOps: cur7.length,
      authorOps: auth7.length,
      windowSpanDays: Math.round(spanDays * 100) / 100,
      windowOps: (hist ?? []).length,
      measured: true,
    },
  };
}

/* vests/day → SP/day → USD/day given chain totals + steemUsd */
export function fuelToUsdPerDay(vestsPerDay, totalVestingShares, totalVestingFund, steemUsd) {
  if (!(totalVestingShares > 0) || !(totalVestingFund > 0) || !(steemUsd > 0)) return null;
  const vestsPerSp = totalVestingShares / totalVestingFund;
  const spPerDay = vestsPerDay / vestsPerSp;
  return Math.round(spPerDay * steemUsd * 1e4) / 1e4;
}
