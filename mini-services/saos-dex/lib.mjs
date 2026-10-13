/**
 * lib.mjs — T-75 · THE NETWORK DEX PURE CORE (ליבת-ה-DEX של הרשת).
 * ═══════════════════════════════════════════════════════════════════════════
 * The operator's order (trace 1a105e091e02754d): "examine our DEX well —
 * swaps to as many networks as possible, FIRST for Steem/Hive/Blurt (the
 * coins we already work with), opposing grids on our network from the other
 * side, a networked arbitrage market for the agents and soldiers, REAL swaps
 * to the real coin with value — not fake, routers that can receive and swap
 * even large amounts, and custody of real coins/tokens of all networks."
 *
 * THE HONEST ARCHITECTURE (the law that makes "real, not fake" provable):
 *   (1) ESCROW LAW — the network can never hold internally more of an asset
 *       than its measured backing: engine chain-verified inventory +
 *       on-chain-verified deposits. Every render says which.
 *   (2) RAILS LAW — every route leg is typed: armed-rail / gated-rail /
 *       internal-pool. A quote that ends in a gated rail says GATED. No
 *       fake swaps, ever (the operator: "ערך אמיתי ולא סתם שקר").
 *   (3) PARITY LAW (peg.mjs doctrine, generalized) — every internal price
 *       faces the oracle; a quote outside its parity band is REFUSED with
 *       the measured deviation named. Proof-carrying quotes.
 *   (4) OPPOSING GRIDS — bid-stack below parity, ask-stack above, spacing
 *       ≥ measured spread, asks never naked-short (≤ base inventory),
 *       asks respect the measured cost floor (T-64 law carried over).
 *   (5) AGENT WEB — agents/soldiers trade through intents (saos.intent.v1),
 *       settle instantly on the internal ledger, fees accrue to the vault,
 *       and every real settlement is a QUEUE OP drained ONLY by the engine's
 *       single signer (single-writer law on the money path, T-60).
 *   (6) CREDIT LAW — CREDIT is the network's internal accounting unit for
 *       agent commerce (x402-style); it is minted ONLY against journaled
 *       value events and NEVER renders as redeemable while no sweep backing
 *       exists. No self-printed-asset markets (T-54/A-2 doctrine).
 *
 * Everything here is PURE (state-shape in → verdict out, no IO, no time
 * except injected) — vectorable in selftest.mjs exactly like §68-§74.
 */

/* ── assets & rails registry ─────────────────────────────────────────── */

export const DEX_PORT = 3037;

/** The coins we already work with (operator: "קודם חשוב שנוכל גם לעשות
 * לsteem hive blurt וכו מטבעות שגם ככה אנחנו עובדים איתם") + the wrapped
 * Hive-Engine assets measured in dominion/enginepond. */
export const ASSETS = {
  STEEM:   { chain: "steem", kind: "native",  peg: null,
             rails: ["steem-limit-order", "steem-convert"] },
  SBD:     { chain: "steem", kind: "pegged",  peg: "USD",
             rails: ["steem-limit-order"] },
  HIVE:    { chain: "hive",  kind: "native",  peg: null,
             rails: ["hive-limit-order", "hive-engine-market"] },
  HBD:     { chain: "hive",  kind: "pegged",  peg: "USD",
             rails: ["hive-limit-order", "hive-engine-market"] },
  BLURT:   { chain: "blurt", kind: "native",  peg: null,
             rails: ["blurt-otc"] },
  "SWAP.HIVE": { chain: "hive-engine", kind: "wrapped", peg: "HIVE",
             rails: ["hive-engine-market"] },
  "SWAP.LTC":  { chain: "hive-engine", kind: "wrapped", peg: "LTC",
             rails: ["hive-engine-market"] },
  "SWAP.BTC":  { chain: "hive-engine", kind: "wrapped", peg: "BTC",
             rails: ["hive-engine-market"] },
  "SWAP.HBD":  { chain: "hive-engine", kind: "wrapped", peg: "HBD",
             rails: ["hive-engine-market"] },
  DEC:     { chain: "hive-engine", kind: "token", peg: null,
             rails: ["hive-engine-market"] },
  BEE:     { chain: "hive-engine", kind: "token", peg: null,
             rails: ["hive-engine-market"] },
  CREDIT:  { chain: "network", kind: "credit", peg: null, rails: [] },
};

/** RAIL LAW: which rails are armed TODAY on this machine (measured truth,
 * not aspiration). Steem limit orders = the signer exists + the lane is
 * law-proven (hypergrid/mover txids). Everything else = GATED with the
 * exact unlock named — the same honesty contract as dominion ponds. */
export const RAILS = {
  "steem-limit-order": {
    chain: "steem", status: "ARMED",
    note: "החתימה חיה (מנוע · txids נמדדו) — התרוקנות-התור דרך צעד-המנוע בלבד",
  },
  "steem-convert": {
    chain: "steem", status: "POSTURE-GATED",
    note: "נועל הון ל-3.5 ימים — נשלט פוסטור (T-28)",
  },
  "hive-limit-order": {
    chain: "hive", status: "GATED-NO-CREDENTIAL",
    unlock: "מפתח-active של Hive ב-.secrets — שער-בלתי-הפיך בידי-המפעיל",
  },
  "hive-engine-market": {
    chain: "hive-engine", status: "GATED-NO-CREDENTIAL",
    unlock: "מפתח-Hive מאופשר-Hive-Engine + float-SWAP.HIVE",
  },
  "blurt-otc": {
    chain: "blurt", status: "GATED-NO-BOOK",
    unlock: "ל-Blurt אין שוק-פנימי כלל (נמדד T-75-r) — הרשת יכולה להיות השוק-היחיד: משכן-OTC דורש מלאי-BLURT (מפעיל)",
  },
};

export const RAIL_STATUS_CLASS = {
  ARMED: "armed", "POSTURE-GATED": "gated",
  "GATED-NO-CREDENTIAL": "gated", "GATED-NO-BOOK": "gated",
};

/* ── small helpers ───────────────────────────────────────────────────── */

/** null-honest numeric coercion: null/undefined/"" → null (NOT 0 — the
 * Number(null)=0 trap emptied grid budgets; the vector §75e caught it). */
export const fnum = (x) => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
export const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
export const r3 = (x) => Math.round(Number(x) * 1e3) / 1e3;
export const bpsOf = (a, b) => (fnum(a) && fnum(b) && b !== 0 ? ((a - b) / Math.abs(b)) * 1e4 : null);

/* ── LAW 1 · escrow (משכן) — the "real, not fake" law ─────────────────── */

/** Pure escrow check. ledger.backing = { SYM: { internal, backing:[{source,
 * amount, ref?}] } }. The network is honest when internal ≤ Σ backing per
 * asset. CREDIT is exempt (its own mint law). Fail-closed on missing shape. */
export function escrowCheck(ledger) {
  const out = { ok: true, violations: [], checked: 0, law: "escrow-law: הרשת אינה מחזיקה מבפנים יותר מהמשכן-הנמדד שלה — אפס-הדפסה-עצמית" };
  if (!ledger || typeof ledger !== "object") { out.ok = false; out.violations.push({ asset: "*", why: "no-ledger" }); return out; }
  const backing = ledger.backing ?? {};
  const balances = ledger.balances ?? {};
  for (const [sym, meta] of Object.entries(ASSETS)) {
    if (sym === "CREDIT") continue; // credit-mint law, not escrow
    const internal = Object.values(balances).reduce((a, b) => a + (fnum(b?.[sym]) ?? 0), 0);
    const b = backing[sym];
    if (internal <= 0 && !(b?.internal > 0)) continue;
    out.checked++;
    /* STRICT covered-only ceiling: `covered` is what remains for HOLDERS
     * after the pool deployment (chain-liquid − pool). The old
     * max(covered, internal) ceiling allowed a double-count class where
     * holders + pool together exceeded the chain inventory (T-75 fix). */
    const covered = b ? (fnum(b.covered) ?? (b.backing ?? []).reduce((a, x) => a + (fnum(x?.amount) ?? 0), 0)) : 0;
    if (r6(internal) > r6(covered)) {
      out.ok = false;
      out.violations.push({ asset: sym, internal: r6(internal), covered: r6(covered), why: "internal-exceeds-backing" });
    }
  }
  return out;
}

/** CREDIT MINT LAW: mint only with a value-anchor ref; cap per mint; the
 * supply is journaled. Returns null (refused) or the mint entry. */
export const CREDIT_MINT_CAP = 10_000;
export function creditMint(ledger, { amount, ref, reason }) {
  const amt = fnum(amount);
  if (!amt || amt <= 0 || amt > CREDIT_MINT_CAP) return null;
  if (!ref || !reason) return null; // no anchor = no mint (no self-printing)
  const supply = fnum(ledger?.credit?.supply) ?? 0;
  if (supply + amt > CREDIT_MINT_CAP * 10) return null; // hard supply ceiling
  return { amount: r6(amt), ref: String(ref).slice(0, 120), reason: String(reason).slice(0, 120), at: null };
}

/* ── LAW 2 · AMM core (constant product, fee) — Uniswap-v2 math ──────── */

/** getAmountOut: in*(1-fee)*Rout / (Rin + in*(1-fee)). Pure, exact-ish
 * rounding to 6 decimals. Returns { out, impactBps, priceAfter }. */
export function ammOut({ amountIn, reserveIn, reserveOut, feeBps = 30 }) {
  const inAmt = fnum(amountIn), rIn = fnum(reserveIn), rOut = fnum(reserveOut), fee = fnum(feeBps);
  if (!inAmt || inAmt <= 0 || !rIn || rIn <= 0 || !rOut || rOut <= 0) return null;
  const f = fee == null || fee < 0 ? 30 : fee;
  const inAfter = inAmt * (1 - f / 1e4);
  if (inAfter <= 0) return null;
  const out = (inAfter * rOut) / (rIn + inAfter);
  const midBefore = rOut / rIn;
  const priceAfter = (rOut - out) / (rIn + inAfter);
  const impactBps = Math.abs(bpsOf(priceAfter, midBefore)) ?? 0;
  return { out: r6(out), impactBps: Math.round(impactBps * 10) / 10, priceAfter: r6(priceAfter), midBefore: r6(midBefore), feeBps: f };
}

/** LP mint on deposit: classic sqrt-product first-minter law. */
export function lpMint({ reserveA, reserveB, lpTotal, amountA, amountB }) {
  const a = fnum(amountA), b = fnum(amountB);
  if (!a || a <= 0 || !b || b <= 0) return null;
  if (!(fnum(lpTotal) > 0)) return { mint: Math.sqrt(a * b), first: true };
  const byA = (a / fnum(reserveA)) * fnum(lpTotal);
  const byB = (b / fnum(reserveB)) * fnum(lpTotal);
  return { mint: r6(Math.min(byA, byB)), first: false };
}

/* ── LAW 3 · parity band (proof-carrying quotes) ─────────────────────── */

/** Parity verdict for an internal mid vs an oracle/usd-derived fair price.
 * bandBps default 5000 (peg.mjs REFUSE band). Returns typed verdict. */
export function parityVerdict({ mid, fair, bandBps = 5000 }) {
  const m = fnum(mid), f = fnum(fair), band = fnum(bandBps);
  if (!m || m <= 0 || !f || f <= 0) return { verdict: "NO-MEASURE", devBps: null, bandBps: band ?? null };
  const devBps = Math.round((bpsOf(m, f) ?? 0) * 10) / 10;
  if (Math.abs(devBps) > (band ?? 5000)) return { verdict: "REFUSE-BAND", devBps, bandBps: band ?? 5000 };
  return { verdict: "IN-BAND", devBps, bandBps: band ?? 5000 };
}

/* ── LAW 4 · opposing grids (סריגים-מתנגדים) ─────────────────────────── */

/** Opposing grid plan around parity. Inputs measured (parity, spreadBps,
 * inventory, cost basis). LAWS: spacing ≥ max(spreadFloorBps, minSpacingBps);
 * asks ≤ base inventory (no naked short); asks ≥ cost floor (T-64: never
 * sell below measured avg cost); bids ≤ quote inventory; levels clamp to
 * what inventory can actually fund; per-level notional cap.
 * Returns { asks[], bids[], verdict, laws[] }. */
export function gridPlan({
  parity, spreadBps = 150, baseBal = 0, quoteBal = 0,
  levels = 3, spacingBps = 150, perLevelNotionalQuote = null,
  avgCost = null, base = "STEEM", quote = "SBD",
  priceTick = 0.000001,
}) {
  const P = fnum(parity);
  const laws = [];
  if (!P || P <= 0) return { verdict: "NO-PARITY", asks: [], bids: [], laws: ["אין-פאריטי — אין-סריג"] };
  const spread = fnum(spreadBps) ?? 150;
  const spacing = Math.max(fnum(spacingBps) ?? 150, spread, 50); // law: spacing ≥ spread floor
  const lv = Math.max(1, Math.min(8, Math.floor(fnum(levels) ?? 3)));
  const notional = fnum(perLevelNotionalQuote);
  const asks = [], bids = [];
  // cost floor for asks (T-64 carried over): never sell below measured basis
  const costFloor = fnum(avgCost) && fnum(avgCost) > 0 ? fnum(avgCost) : null;
  if (costFloor) laws.push(`רצפת-עלות ${r6(costFloor)} ${quote}/${base} (T-64) — אסק-מתחת-יסוד נזרק`);
  // quote budget per level: explicit cap > inventory/levels share
  const bidBudgetPer = Math.min(notional ?? Infinity, quoteBal / lv);
  const askBudgetPer = Math.min(notional ?? Infinity, baseBal / lv);
  for (let i = 1; i <= lv; i++) {
    const askPrice = P * (1 + (spacing * i) / 1e4);
    const bidPrice = P * (1 - (spacing * i) / 1e4);
    // ask: sized by base inventory share; never below cost floor
    if (askBudgetPer > 0) {
      let qty = askBudgetPer; // base units
      const floored = costFloor ? askPrice >= costFloor : true;
      if (floored && qty > 0) {
        const q = Math.min(qty, r6(baseBal - asks.reduce((a, x) => a + x.qty, 0)));
        if (q > 0) asks.push({ side: "ask", level: i, price: Math.max(askPrice, priceTick), qty: r6(q), notionalQuote: r6(q * askPrice) });
      }
    }
    // bid: sized by quote budget / price
    if (bidBudgetPer > 0 && bidPrice > 0) {
      const q = bidBudgetPer / bidPrice;
      if (q > 0) bids.push({ side: "bid", level: i, price: Math.max(bidPrice, priceTick), qty: r6(q), notionalQuote: r6(bidBudgetPer) });
    }
  }
  if (!asks.length) laws.push("אפס-אסקים כשרים — המלאי-בסיס ריק או מתחת-רצפת-העלות");
  if (!bids.length) laws.push("אפס-בידים כשרים — המלאי-מוביל ריק");
  return {
    verdict: asks.length || bids.length ? "GRID-PLANNED" : "GRID-EMPTY",
    parity: r6(P), spacingBps: spacing, levels: lv,
    asks, bids, laws,
  };
}

/* ── LAW 5 · router (multi-hop, split for large amounts) ─────────────── */

/** Route graph: nodes = assets, edges = internal pools (reserves) and rails
 * (typed, ARMED edges usable / GATED edges plan-only). Best path = max out
 * after fees+impact, computed by trying all simple paths (graph is tiny,
 * ≤ 12 nodes). GATED edges are included but mark the route gated — the
 * quote says the truth. */
export function buildGraph(pools, { rails = RAILS } = {}) {
  const adj = {};
  const addEdge = (from, to, edge) => { (adj[from] ??= []).push({ to, ...edge }); };
  for (const [id, p] of Object.entries(pools ?? {})) {
    if (!p?.assets || p.assets.length !== 2) continue;
    const [A, B] = p.assets;
    const rA = fnum(p.reserveA) ?? 0, rB = fnum(p.reserveB) ?? 0;
    if (rA > 0 && rB > 0) {
      addEdge(A, B, { kind: "pool", id, reserveIn: rA, reserveOut: rB, feeBps: fnum(p.feeBps) ?? 30 });
      addEdge(B, A, { kind: "pool", id, reserveIn: rB, reserveOut: rA, feeBps: fnum(p.feeBps) ?? 30 });
    } else {
      // empty pool: shape-only edge, unusable but visible
      addEdge(A, B, { kind: "pool-empty", id, reserveIn: 0, reserveOut: 0, feeBps: fnum(p.feeBps) ?? 30 });
      addEdge(B, A, { kind: "pool-empty", id, reserveIn: 0, reserveOut: 0, feeBps: fnum(p.feeBps) ?? 30 });
    }
  }
  for (const [id, r] of Object.entries(rails ?? {})) {
    // a rail is a conversion edge on its chain between native and peg
    const pairs = { "steem-limit-order": ["STEEM", "SBD"], "hive-limit-order": ["HIVE", "HBD"] }[id];
    if (!pairs) continue;
    const usable = r.status === "ARMED";
    addEdge(pairs[0], pairs[1], { kind: usable ? "rail" : "rail-gated", id, rail: id, status: r.status });
    addEdge(pairs[1], pairs[0], { kind: usable ? "rail" : "rail-gated", id, rail: id, status: r.status });
  }
  return adj;
}

/** Simulate a path: applies ammOut per pool leg; rails are 1:1 legs with
 * their own measured price (passed via railPrices[id]) — never invented. */
export function simulatePath({ path, graph, amountIn, railPrices = {} }) {
  let amount = fnum(amountIn);
  let legs = [], gated = false, totalImpactBps = 0, feeBpsSum = 0;
  if (!amount || amount <= 0) return null;
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i], to = path[i + 1];
    const edge = (graph[from] ?? []).find((e) => e.to === to);
    if (!edge) return null;
    if (edge.kind === "pool") {
      const o = ammOut({ amountIn: amount, reserveIn: edge.reserveIn, reserveOut: edge.reserveOut, feeBps: edge.feeBps });
      if (!o || o.out <= 0) return { amount: 0, legs, gated, verdict: "POOL-EXHAUSTED" };
      legs.push({ kind: "pool", id: edge.id, from, to, in: r6(amount), out: o.out, impactBps: o.impactBps, feeBps: edge.feeBps });
      totalImpactBps += o.impactBps; feeBpsSum += edge.feeBps;
      amount = o.out;
    } else if (edge.kind === "rail") {
      const px = fnum(railPrices[edge.id]);
      if (!px || px <= 0) return { amount: 0, legs, gated, verdict: "RAIL-NO-PRICE" };
      // rail price = units of `to` per unit of `from` (measured, caller-supplied)
      const out = amount * px;
      legs.push({ kind: "rail", id: edge.id, from, to, in: r6(amount), out: r6(out), price: px, status: edge.status });
      amount = out;
    } else if (edge.kind === "rail-gated") {
      gated = true;
      legs.push({ kind: "rail-gated", id: edge.id, from, to, in: r6(amount), out: null, status: edge.status });
      return { amount: null, legs, gated, verdict: "GATED-LEG", gatedLeg: edge };
    } else {
      return { amount: null, legs, gated, verdict: "NO-LIQUIDITY-LEG", gatedLeg: edge };
    }
  }
  return { amount: r6(amount), legs, gated, verdict: gated ? "GATED-LEG" : "ROUTED", totalImpactBps: Math.round(totalImpactBps * 10) / 10, feeBpsSum };
}

/** All simple paths from→to, depth-bounded. Returns array of paths. */
export function allPaths(graph, from, to, { maxDepth = 4 } = {}) {
  const out = [];
  const walk = (node, path) => {
    if (path.length - 1 > maxDepth) return;
    if (node === to && path.length > 1) { out.push([...path]); return; }
    for (const e of graph[node] ?? []) {
      if (path.includes(e.to)) continue;
      walk(e.to, [...path, e.to]);
    }
  };
  if (from === to) return out;
  walk(from, [from]);
  return out;
}

/** routeQuote: best usable path by output amount; ALSO a gated-best path
 * (honestly labeled) when no usable path exists. Split law for large
 * amounts: chunks of ≤ chunkMax (pool-depth share) — returns plan[] of
 * chunk quotes. */
export function routeQuote({ graph, in: from, out, amountIn, railPrices, chunkMax = null }) {
  const paths = allPaths(graph, from, out);
  if (!paths.length) return { verdict: "NO-ROUTE", from, to: out, amountIn: fnum(amountIn) ?? null };
  const sims = paths.map((p) => ({ path: p, sim: simulatePath({ path: p, graph, amountIn, railPrices }) }))
    .filter((x) => x.sim);
  const usable = sims.filter((x) => !x.sim.gated && x.sim.amount != null && x.sim.amount > 0);
  /* gated truth still renders, honestly labeled — when NO usable path exists,
   * the best gated path is returned as ROUTED-GATED (amount null) so callers
   * can NAME the gate instead of pretending no route exists. */
  const gated = sims.filter((x) => x.sim.gated);
  const pool = usable.length ? usable : gated;
  if (pool.length) pool.sort((a, b) => (b.sim.amount ?? -1) - (a.sim.amount ?? -1));
  const best = pool[0];
  if (!best) return { verdict: "NO-LIQUIDITY", from, to: out, amountIn: fnum(amountIn) ?? null, pathsTried: paths.length };
  const chunks = [];
  const cm = fnum(chunkMax);
  if (cm && cm > 0 && fnum(amountIn) > cm) {
    const n = Math.ceil(fnum(amountIn) / cm);
    const per = fnum(amountIn) / n;
    for (let i = 0; i < n; i++) {
      const s = simulatePath({ path: best.path, graph, amountIn: per, railPrices });
      chunks.push({ chunk: i + 1, of: n, amountIn: r6(per), out: s?.amount ?? null, verdict: s?.verdict ?? "SIM-FAIL" });
    }
  }
  return {
    verdict: best.sim.gated ? "ROUTED-GATED" : "ROUTED",
    from, to: out, amountIn: fnum(amountIn) ?? null,
    amountOut: best.sim.amount,
    path: best.path, legs: best.sim.legs,
    feeBpsSum: best.sim.feeBpsSum ?? 0, impactBps: best.sim.totalImpactBps ?? 0,
    gated: best.sim.gated, pathsTried: paths.length,
    split: chunks.length ? { chunks, law: "פיצול-סכומים-גדולים — חתיכות-לפי-עומק-הבריכה, minOut לכל-חתיכה" } : null,
  };
}

/* ── LAW 6 · arb scan (רשת-הארביטראז) ────────────────────────────────── */

/** TOUCH-AWARE ARB SCAN (T-75g, LAW 18) — the honest successor to mid-arb.
 * A mid is not a fillable price: on a 900bps-wide book the mid-arb "edge"
 * vanishes (or inverts) the moment you touch the book. The real edge PAYS
 * the bestAsk and RECEIVES the bestBid.
 * VENUE KINDS (honesty taxonomy; kindOf falls back to id prefixes):
 *   pool   — our internal AMM: executable at spot; size impact priced at
 *            execution (routeQuote). No touch.
 *   book   — an external touched book: touch {bestAsk, bestBid} measured.
 *            A half-touched book (one side missing) fails honest → not
 *            treated as touched.
 *   oracle — fair VALUE from independent anchors. NOT a venue: nothing is
 *            fillable on it. A signal, never a leg.
 *   plan   — our own planned (not live) orders. Not fillable.
 * PAIRING CLASSES:
 *   TOUCH       book+book (both touched) — tradeable as-measured.
 *   POOL-TOUCH  pool+book — pool spot vs touched book; upper bound before
 *               pool impact (labeled "pool-impact-at-execution").
 *   POOL-POOL   pool+pool — spot vs spot, both executable.
 *   FAIR-SIGNAL any venue + oracle — mispricing vs fair value:
 *               SIGNAL-ONLY, never an executable arb (live proof T-75g:
 *               "buy oracle sell steem-book +343bps" was unfillable on
 *               the oracle leg).
 *   MID-ONLY    unclassified pairs — legacy mid pairing, visibility only.
 * Inverted pairs normalize with touch inversion (ask/bid swap: bid' =
 * 1/ask, ask' = 1/bid — measured inversion, not assumed). Fee law: net =
 * gross − 2×feeBps on executable classes. Quarantine (LAW 17) runs
 * upstream — quarantined venues never reach pairing. One row per venue
 * pair: the BEST executable direction. Sorted: executable (TRADEABLE)
 * first by netBps, then signals by |edge|; FAIR-SIGNAL capped at 3. */
export function arbScan({ venues, feeBps = 30, minEdgeBps = 20 }) {
  const fee = fnum(feeBps) ?? 30;
  const minE = fnum(minEdgeBps) ?? 20;
  const KINDS = ["pool", "book", "oracle", "plan"];
  const kindOf = (v) => {
    const k = String(v.kind ?? "").toLowerCase();
    if (KINDS.includes(k)) return k;
    const id = String(v.id ?? "");
    if (id.startsWith("oracle")) return "oracle";
    if (id.startsWith("internal:")) return "pool";
    return "mid";
  };
  const vs = (venues ?? [])
    .filter((v) => v && fnum(v.mid) > 0 && Array.isArray(v.pair) && v.pair.length === 2 && !String(v.status ?? "").startsWith("quarantined"))
    .map((v) => {
      const t = v.touch ?? null;
      let ask = fnum(t?.bestAsk), bid = fnum(t?.bestBid);
      if (!(ask > 0) || !(bid > 0)) { ask = null; bid = null; } // half-touched = not touched (fail-honest)
      const askDepth = fnum(t?.askDepth), bidDepth = fnum(t?.bidDepth);
      return {
        id: String(v.id ?? ""), kind: kindOf(v), mid: fnum(v.mid), ask, bid, pair: [String(v.pair[0]), String(v.pair[1])], source: v.source ?? null,
        // LAW 19 inputs: measured depth (quote units) + pool reserves, carried as-measured
        touch: ask > 0 ? { bestAsk: ask, bestBid: bid, askDepth: askDepth > 0 ? askDepth : null, bidDepth: bidDepth > 0 ? bidDepth : null } : null,
        reserves: v.reserves && fnum(v.reserves.A) > 0 && fnum(v.reserves.B) > 0 ? { A: fnum(v.reserves.A), B: fnum(v.reserves.B) } : null,
      };
    });
  const out = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i];
      let b = vs[j];
      let dir = null;
      if (a.pair[0] === b.pair[0] && a.pair[1] === b.pair[1]) dir = `${a.pair[0]}/${a.pair[1]}`;
      else if (a.pair[0] === b.pair[1] && a.pair[1] === b.pair[0]) {
        // invert b into a's pair space ([A,B] = B per A): touch inverts ask/bid
        const askB = b.bid > 0 ? 1 / b.bid : null;
        const bidB = b.ask > 0 ? 1 / b.ask : null;
        b = { ...b, mid: 1 / b.mid, ask: askB, bid: bidB };
        dir = `${a.pair[0]}/${a.pair[1]}`;
      }
      if (!dir) continue;
      const kinds = new Set([a.kind, b.kind]);
      const executable =
        (a.kind === "pool" || (a.kind === "book" && a.ask > 0)) &&
        (b.kind === "pool" || (b.kind === "book" && b.ask > 0));
      // pay = price to buy 1 A (in B); recv = proceeds of selling 1 A (in B)
      const payOf = (v) => (v.kind === "book" ? v.ask : v.mid);
      const recvOf = (v) => (v.kind === "book" ? v.bid : v.mid);
      if (executable) {
        const cls = a.kind === "book" && b.kind === "book" ? "TOUCH" : a.kind === "pool" && b.kind === "pool" ? "POOL-POOL" : "POOL-TOUCH";
        // dir1: buy on a, sell on b; dir2: buy on b, sell on a — best wins
        const d1 = recvOf(b) > 0 && payOf(a) > 0 ? recvOf(b) / payOf(a) - 1 : -Infinity;
        const d2 = recvOf(a) > 0 && payOf(b) > 0 ? recvOf(a) / payOf(b) - 1 : -Infinity;
        const buyOnA = d1 >= d2;
        const gross = buyOnA ? d1 : d2;
        const edge = Math.round(gross * 1e4 * 10) / 10;
        if (Math.abs(edge) < minE) continue;
        const netBps = Math.round((edge - 2 * fee) * 10) / 10;
        const buyV = buyOnA ? a : b, sellV = buyOnA ? b : a;
        // LAW 19: the edge is only as big as the depth it touches
        const cap = edgeDepthCap({
          buyLeg: { id: buyV.id, kind: buyV.kind, mid: buyV.mid, touch: buyV.touch, reserves: buyV.reserves },
          sellLeg: { id: sellV.id, kind: sellV.kind, mid: sellV.mid, touch: sellV.touch, reserves: sellV.reserves },
        });
        out.push({
          pair: dir, buy: buyV.id, sell: sellV.id,
          midA: r6(a.mid), midB: r6(b.mid), edgeBps: edge, netBps,
          cls, kind: "TRADEABLE",
          verdict: netBps > 0 ? "EDGE-AFTER-FEES" : "EDGE-BELOW-FEES",
          touch: { buyAt: r6(payOf(buyV)), sellAt: r6(recvOf(sellV)) },
          impact: cls === "POOL-TOUCH" ? "pool-impact-at-execution" : null,
          maxNotional: cap.maxNotional, depthVerdict: cap.verdict,
          depthBasis: cap.basis, depthWhy: cap.why ?? null,
          sources: [a.source, b.source],
        });
      } else {
        // signal classes: mid-vs-mid mispricing, never executable
        const cls = kinds.has("oracle") ? "FAIR-SIGNAL" : "MID-ONLY";
        const edge = Math.round((bpsOf(b.mid, a.mid) ?? 0) * 10) / 10;
        if (Math.abs(edge) < minE) continue;
        out.push({
          pair: dir, buy: edge > 0 ? b.id : a.id, sell: edge > 0 ? a.id : b.id,
          midA: r6(a.mid), midB: r6(b.mid), edgeBps: edge,
          netBps: Math.round((Math.abs(edge) - 2 * fee) * 10) / 10,
          cls, kind: "SIGNAL",
          verdict: cls === "FAIR-SIGNAL" ? "SIGNAL-ONLY" : "MID-ONLY-NOT-ACTIONABLE",
          touch: null, impact: null,
          sources: [a.source, b.source],
        });
      }
    }
  }
  const exec = out.filter((o) => o.kind === "TRADEABLE").sort((x, y) => y.netBps - x.netBps);
  const sigs = out.filter((o) => o.kind === "SIGNAL").sort((x, y) => Math.abs(y.edgeBps) - Math.abs(x.edgeBps));
  return [...exec, ...sigs.filter((s) => s.cls === "FAIR-SIGNAL").slice(0, 3), ...sigs.filter((s) => s.cls !== "FAIR-SIGNAL").slice(0, 3)].slice(0, 12);
}

/* ── LAW 19 · depth-aware sizing (מידוד-מודע-עומק — חוק-19) ──────────── */

/** Take at most half the measured top-of-book depth — the touched price
 * must roughly hold while we trade. Pool legs take ≤10% of the relevant
 * reserve (impact stays bounded; routeQuote still prices the real impact
 * at execution). Pure fractions, exported for vectors. */
export const DEPTH_FRACTION = 0.5;
export const POOL_FRACTION = 0.1;

/** An executable edge is only as big as the side it touches: buying pays
 * the ask — capped by the measured ask depth; selling receives the bid —
 * capped by the measured bid depth. Caps are in QUOTE units of the pair.
 *   book buy  → touch.askDepth  × DEPTH_FRACTION (measured)
 *   book sell → touch.bidDepth  × DEPTH_FRACTION (measured)
 *   pool buy  → reserveA × spot × POOL_FRACTION (the pool can only sell
 *               base it actually holds)
 *   pool sell → reserveB × POOL_FRACTION (the pool can only pay quote it
 *               actually holds)
 * Any leg without a MEASURED size → DEPTH-UNKNOWN (typed, maxNotional
 * null, the missing leg named) — never an assumed size. Pure. */
export function edgeDepthCap({ buyLeg, sellLeg, depthFraction = DEPTH_FRACTION, poolFraction = POOL_FRACTION }) {
  const fD = fnum(depthFraction), fP = fnum(poolFraction);
  if (!(fD > 0) || fD > 1 || !(fP > 0) || fP > 1) return { verdict: "REFUSED-FRACTION", maxNotional: null, basis: [], why: "fraction-out-of-band" };
  const basis = [];
  const caps = [];
  const unknown = (leg, why) => ({ verdict: "DEPTH-UNKNOWN", maxNotional: null, basis, why: `${leg}:${why}` });
  // buy leg — what we can buy before walking past the measured depth
  if (buyLeg?.kind === "book") {
    const d = fnum(buyLeg.touch?.askDepth);
    if (!(d > 0)) return unknown(buyLeg.id ?? "book", "no-measured-ask-depth");
    caps.push(d * fD);
    basis.push({ leg: buyLeg.id ?? null, cap: r6(d * fD), source: `askDepth × ${fD}` });
  } else if (buyLeg?.kind === "pool") {
    const rA = fnum(buyLeg.reserves?.A), spot = fnum(buyLeg.mid);
    if (!(rA > 0) || !(spot > 0)) return unknown(buyLeg.id ?? "pool", "no-reserves");
    caps.push(rA * spot * fP);
    basis.push({ leg: buyLeg.id ?? null, cap: r6(rA * spot * fP), source: `reserveA × spot × ${fP}` });
  }
  // sell leg — what the other side can absorb before the bid walks
  if (sellLeg?.kind === "book") {
    const d = fnum(sellLeg.touch?.bidDepth);
    if (!(d > 0)) return unknown(sellLeg.id ?? "book", "no-measured-bid-depth");
    caps.push(d * fD);
    basis.push({ leg: sellLeg.id ?? null, cap: r6(d * fD), source: `bidDepth × ${fD}` });
  } else if (sellLeg?.kind === "pool") {
    const rB = fnum(sellLeg.reserves?.B);
    if (!(rB > 0)) return unknown(sellLeg.id ?? "pool", "no-reserves");
    caps.push(rB * fP);
    basis.push({ leg: sellLeg.id ?? null, cap: r6(rB * fP), source: `reserveB × ${fP}` });
  }
  if (!caps.length) return { verdict: "DEPTH-UNKNOWN", maxNotional: null, basis, why: "no-legs" };
  return { verdict: "CAPPED", maxNotional: r6(Math.min(...caps)), basis };
}

/* ── LAW 20 · intent-side depth enforcement (אכיפת-עומק-בכוונה — חוק-20) ── */

/** A board edge is a CLAIM; settlement enforces it. An intent riding a
 * TRADEABLE board edge (same asset pair, either orientation) must fit
 * inside that edge's maxNotional (LAW 19, quote units). The matched edge
 * = the board's BEST (max netBps) TRADEABLE row for the intent's pair —
 * the edge an agent reading the board would actually ride. Rules:
 *   no board / no TRADEABLE row for the pair → PASS (plain internal swap;
 *     routeQuote impact + band guard + slippage still govern it);
 *   matched edge CAPPED and intent notional > maxNotional → REFUSED-DEPTH
 *     (edge named, cap named, intent notional named);
 *   matched edge not CAPPED (DEPTH-UNKNOWN / missing touch) →
 *     REFUSED-DEPTH-UNKNOWN — no provable size, any amount is unverifiable
 *     against unmeasured depth (fail-closed, the missing leg named);
 *   intent notional: paying the quote asset → amountIn IS the quote notional;
 *     paying the base asset → amountIn × max(buyAt, sellAt) — the WORST
 *     touched price bounds both legs (buy leg pays buyAt per base, sell
 *     leg receives sellAt per base; bounding by the larger bounds both).
 * Pure. */
export function intentDepthGuard(intent, board) {
  const from = String(intent?.in ?? "").toUpperCase();
  const to = String(intent?.out ?? "").toUpperCase();
  const amountIn = fnum(intent?.amountIn);
  if (!from || !to || from === to || !(amountIn > 0)) return { verdict: "PASS", why: "not-edge-ride" };
  const rows = (Array.isArray(board) ? board : Array.isArray(board?.opportunities) ? board.opportunities : [])
    .filter((o) => o && o.kind === "TRADEABLE" && typeof o.pair === "string" && o.pair.includes("/"));
  if (!rows.length) return { verdict: "PASS", why: "no-board-edge" };
  const matched = rows
    .map((o) => { const [base, quote] = o.pair.split("/"); return { o, base, quote }; })
    .filter(({ base, quote }) => (from === base && to === quote) || (from === quote && to === base))
    .sort((x, y) => (fnum(y.o.netBps) ?? -Infinity) - (fnum(x.o.netBps) ?? -Infinity));
  if (!matched.length) return { verdict: "PASS", why: "no-board-edge" };
  const { o, base, quote } = matched[0];
  const meta = { edgePair: o.pair, edgeBuy: o.buy ?? null, edgeSell: o.sell ?? null, edgeNetBps: o.netBps ?? null, maxNotional: o.maxNotional ?? null };
  if (o.depthVerdict !== "CAPPED" || !(fnum(o.maxNotional) > 0))
    return { verdict: "REFUSED-DEPTH-UNKNOWN", why: "edge-depth-not-measured", depthWhy: o.depthWhy ?? null, ...meta };
  const buyAt = fnum(o.touch?.buyAt), sellAt = fnum(o.touch?.sellAt);
  let notional;
  if (from === quote) notional = amountIn;
  else if (from === base) notional = amountIn * Math.max(buyAt ?? 0, sellAt ?? 0);
  else return { verdict: "PASS", why: "no-board-edge" };
  if (!(notional > 0)) return { verdict: "REFUSED-DEPTH-UNKNOWN", why: "edge-touch-missing", ...meta };
  if (notional > fnum(o.maxNotional) * (1 + 1e-9))
    return { verdict: "REFUSED-DEPTH", why: "amount-above-max-notional", edgeNotional: r6(notional), ...meta };
  return { verdict: "PASS", why: "within-max-notional", edgeNotional: r6(notional), ...meta };
}

/* ── LAW 7 · intents (saos.intent.v1) + internal settlement ──────────── */

/** Validate an agent trade intent against ledger+pools. Fail-closed on:
 * unknown agent, unknown asset, non-positive amount, expired, no route,
 * minOut above routed out, escrow violation, and — when a board snapshot
 * is passed (LAW 20) — an amount above the matched TRADEABLE edge's
 * maxNotional (REFUSED-DEPTH) or an edge whose depth is unmeasured
 * (REFUSED-DEPTH-UNKNOWN; no provable size). Returns typed verdict;
 * when board passed, `depth` always carries the guard provenance. */
export function validateIntent(intent, { graph, railPrices, ledger, board }) {
  const id = intent?.id ?? null;
  const agent = String(intent?.agent ?? "").slice(0, 40);
  const from = String(intent?.in ?? "").toUpperCase();
  const to = String(intent?.out ?? "").toUpperCase();
  const amountIn = fnum(intent?.amountIn);
  const minOut = fnum(intent?.minOut);
  if (!id) return { verdict: "REFUSED", why: "no-id" };
  if (!agent) return { verdict: "REFUSED", why: "no-agent" };
  if (!ASSETS[from] || !ASSETS[to] || from === to) return { verdict: "REFUSED", why: "bad-pair" };
  if (!amountIn || amountIn <= 0) return { verdict: "REFUSED", why: "bad-amount" };
  if (intent?.expires && new Date(intent.expires).getTime() < Date.now()) return { verdict: "REFUSED", why: "expired" };
  const bal = fnum(ledger?.balances?.[agent]?.[from]) ?? 0;
  if (bal + 1e-9 < amountIn) return { verdict: "REFUSED", why: "agent-balance", have: r6(bal) };
  if (!graph || !graph[from]) return { verdict: "REFUSED", why: "no-route" };
  const q = routeQuote({ graph, in: from, out: to, amountIn, railPrices });
  if (q.verdict === "NO-ROUTE") return { verdict: "REFUSED", why: "no-route" };
  if (q.verdict === "ROUTED-GATED" || q.gated) return { verdict: "REFUSED-GATED", why: "route-hits-gated-rail", gatedLeg: q.legs?.find((l) => l.kind === "rail-gated") ?? null, route: q.path };
  if (q.verdict !== "ROUTED" || !(q.amountOut > 0)) return { verdict: "REFUSED", why: q.verdict === "NO-LIQUIDITY" ? "no-liquidity" : (q.verdict ?? "no-liquidity") };
  if (minOut != null && q.amountOut < minOut) return { verdict: "REFUSED-SLIPPAGE", why: "min-out", amountOut: q.amountOut, minOut };
  // LAW 20: last gate before OK — the intent would fill internally, but if
  // it rides a board edge the edge's measured maxNotional is the law.
  if (board) {
    const dg = intentDepthGuard(intent, board);
    if (dg.verdict !== "PASS") return { verdict: dg.verdict, why: dg.why, depth: dg };
    return { verdict: "OK", quote: q, depth: dg };
  }
  return { verdict: "OK", quote: q };
}

/** Pure settlement deltas of an OK intent: agent -in/+out, pool reserves
 * absorb in/receive out, vault fee stays on the pool's in-side asset. */
export function settleIntentDeltas(intent, quote) {
  const agent = String(intent.agent).slice(0, 40);
  const from = String(intent.in).toUpperCase();
  const to = String(intent.out).toUpperCase();
  const deltas = [];
  deltas.push({ holder: agent, asset: from, delta: -r6(fnum(intent.amountIn)) });
  deltas.push({ holder: agent, asset: to, delta: r6(quote.amountOut) });
  for (const leg of quote.legs ?? []) {
    if (leg.kind !== "pool") continue;
    const fee = r6((fnum(leg.in) ?? 0) * ((fnum(leg.feeBps) ?? 30) / 1e4));
    if (fee > 0) deltas.push({ holder: "__vault__", asset: leg.from, delta: fee, kind: "fee" });
  }
  return deltas;
}

/* ── LAW 8 · settlement queue ops (the engine drains, single signer) ─── */

/** ORDER-ID PARTITION LAW (uint32 spaces, no collision ever):
 *   cycle:    ~[1.7e9, 1.8e9]  (tSec-based)
 *   mover:    [2.026e9, 2.027e9] (YYYYMMDD*100+seq)
 *   hyper:    [2.1e9, 4.294e9]
 *   DEX:      [1.90e9, 1.949e9]  ← this service only. */
export const DEX_ORDER_BASE = 1_900_000_000;
export const DEX_ORDER_MAX = 1_949_999_999;
export function dexOrderId(seq) {
  const s = Math.floor(fnum(seq) ?? 0);
  const id = DEX_ORDER_BASE + (s % (DEX_ORDER_MAX - DEX_ORDER_BASE));
  return id >>> 0;
}

/** Build a lawful STEEM limit-order queue op from a grid level. Laws:
 * asks never naked-short (≤ dex internal base balance which ≤ backing),
 * asks ≥ cost floor, bids only when flow guard is not PAUSE-FLOW,
 * notional caps, amounts r3 (chain precision), expiration 24h. */
export function steemQueueOp({ level, dexBaseBal, avgCost, guardAction, seq, nowSec }) {
  const P = fnum(level?.price), qty = fnum(level?.qty);
  if (!P || P <= 0 || !qty || qty <= 0) return { op: null, refuse: "bad-level" };
  if (!Array.isArray(level) && level.side !== "ask" && level.side !== "bid") return { op: null, refuse: "bad-side" };
  const base = fnum(dexBaseBal) ?? 0;
  if (level.side === "ask") {
    if (qty > base + 1e-9) return { op: null, refuse: "naked-short-ask" };
    if (fnum(avgCost) > 0 && P < fnum(avgCost)) return { op: null, refuse: "below-cost-floor" };
  }
  if (level.side === "bid" && guardAction === "PAUSE-FLOW") return { op: null, refuse: "flow-guard-pause" };
  const id = dexOrderId(seq);
  const op = level.side === "ask"
    ? ["limit_order_create", {
        owner: "__ACCOUNT__", orderid: id,
        amount_to_sell: `${r3(qty).toFixed(3)} STEEM`, min_to_receive: `${r3(qty * P).toFixed(3)} SBD`,
        fill_or_kill: false, expiration: Math.floor(fnum(nowSec) ?? Date.now() / 1000) + 86400,
      }]
    : ["limit_order_create", {
        owner: "__ACCOUNT__", orderid: id,
        amount_to_sell: `${r3(qty * P).toFixed(3)} SBD`, min_to_receive: `${r3(qty).toFixed(3)} STEEM`,
        fill_or_kill: false, expiration: Math.floor(fnum(nowSec) ?? Date.now() / 1000) + 86400,
      }];
  return { op, refuse: null, orderid: id };
}

/* ── LAW 9 · deposit custody (משכן-הפקדות) ───────────────────────────── */

/** DEPOSIT ACCEPT LAW: a real on-chain transfer to the machine (memo
 * "dex-deposit:<agent>") may credit the network ledger ONLY for assets
 * whose EXIT rail is armed — crediting custody without a lawful way out
 * would be a lock-in lie (the operator: "ערך אמיתי ולא סתם שקר"). Assets
 * with gated exits are recorded as PENDING-UNACCEPTED with the reason.
 * Pure: returns the verdict; no IO. */
export function depositAcceptLaw({ asset, memo, rails = RAILS }) {
  const sym = String(asset ?? "").toUpperCase();
  const m = String(memo ?? "");
  if (!ASSETS[sym]) return { verdict: "REFUSED", why: "unknown-asset" };
  const agent = m.startsWith("dex-deposit:") ? m.slice("dex-deposit:".length).trim().slice(0, 40) : null;
  if (!agent) return { verdict: "REFUSED", why: "bad-memo", note: "ממוא חייב: dex-deposit:<agent-id>" };
  const exitArmed = (ASSETS[sym].rails ?? []).some((r) => rails[r]?.status === "ARMED");
  if (!exitArmed) {
    return { verdict: "PENDING-UNACCEPTED", agent, asset: sym, why: "no-armed-exit-rail", note: "אין-מסילת-יציאה חמושה — ההפקדה נרשמת ולא נקלטת (אין-נעילה-כוזבת)" };
  }
  return { verdict: "ACCEPT", agent, asset: sym };
}

/* ── LAW 10 · CREDIT redemption (הנזלת-אמת של המטבע-הדמה) ────────────── */

/** CREDIT face value: $0.01 per CREDIT (the network's unit of account).
 * REDEMPTION LAW: CREDIT is redeemable against the VAULT's REAL fee
 * inventory only, at the MEASURED parity of the moment — never printed,
 * never promised beyond what the vault actually holds. This is the lawful
 * liquefaction path for the network credit: real fees in → real coin out.
 * Pure; fail-closed on missing measurements. */
export const CREDIT_FACE_USD = 0.01;
export const CREDIT_MIN_REDEEM = 100; // $1.00 — dust-refusal law
export function redemptionQuote({ credit, asset, vaultBalance, steemUsd, sbdUsd, agentBalance }) {
  const c = fnum(credit);
  const sym = String(asset ?? "").toUpperCase();
  if (!c || c <= 0) return { verdict: "REFUSED", why: "bad-amount" };
  if (c < CREDIT_MIN_REDEEM) return { verdict: "REFUSED", why: "below-min-redeem", min: CREDIT_MIN_REDEEM };
  const held = fnum(agentBalance) ?? 0;
  if (held + 1e-9 < c) return { verdict: "REFUSED", why: "agent-balance", have: r6(held) };
  const vault = fnum(vaultBalance) ?? 0;
  let unitOut = null; // real units per CREDIT at measured parity
  if (sym === "STEEM") {
    const px = fnum(steemUsd);
    if (!px || px <= 0) return { verdict: "REFUSED", why: "no-measured-parity" };
    unitOut = CREDIT_FACE_USD / px;
  } else if (sym === "SBD") {
    const px = fnum(sbdUsd);
    if (!px || px <= 0) return { verdict: "REFUSED", why: "no-measured-parity" };
    unitOut = CREDIT_FACE_USD / px;
  } else return { verdict: "REFUSED", why: "non-redeemable-asset", note: "רק-מסילה-חמושה (STEEM/SBD) ניתנת-למשיכה" };
  const out = r6(c * unitOut);
  if (out > vault + 1e-9) return { verdict: "REFUSED-VAULT", why: "vault-inventory", vault: r6(vault), requested: out };
  return { verdict: "OK", credit: r6(c), asset: sym, out, unitOut: r6(unitOut), law: "המשכה מהמלאי-האמיתי-של-הכספת בלבד — אפס-הדפסה" };
}

/* ── LAW 11 · vault sweep (מיחזור-עמלות לשוק) ────────────────────────── */

/** Vault sweep: when the fee vault's backed assets pass the threshold AND
 * the flow guard allows buying, the vault recycles its income into the
 * opposing grid (asks sell vault STEEM, bids buy with vault SBD) — fees
 * become market presence instead of idle dust. Under PAUSE-FLOW: asks
 * only. Pure planner. */
export function vaultSweepPlan({ vaultSteem, vaultSbd, parity, guardAction, threshold = 0.5 }) {
  const P = fnum(parity);
  const vS = fnum(vaultSteem) ?? 0, vB = fnum(vaultSbd) ?? 0;
  if (!P || P <= 0) return { verdict: "NO-PARITY", levels: [] };
  const levels = [];
  if (vS >= (fnum(threshold) ?? 0.5)) levels.push({ side: "ask", price: r6(P * 1.015), qty: r6(vS * 0.8), from: "vault" });
  if (vB >= (fnum(threshold) ?? 0.5) && guardAction !== "PAUSE-FLOW") levels.push({ side: "bid", price: r6(P * 0.985), qty: r6((vB * 0.8) / P), from: "vault" });
  return { verdict: levels.length ? "SWEEP-PLANNED" : "BELOW-THRESHOLD", levels };
}

/* ── LAW 12 · batch clearing (מחבת-CoW — מחיר-ניקוי אחיד) ────────────── */

/** Deterministic 32-bit FNV-1a — the recomputability digest (CoW trust
 * artifact: anyone can re-derive the batch result from its inputs). */
export function fnv1aHex(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export const BATCH_FEE_BPS = 30; // 15bps from each side (half-fee law)
export const BATCH_MAX_ORDERS = 50;
export const BATCH_MAX_PER_AGENT = 5;

/** BATCH CLEARING (mini-CoW): a call auction where ALL fills clear at ONE
 * uniform price. LAWS:
 *  (1) UNIFORM PRICE — every executed sell has limit ≤ p* ≤ every executed
 *      buy limit; nobody trades outside their limit, ever.
 *  (2) MAX-VOLUME — p* maximizes matched quantity Q(p)=min(Σsells@p,Σbuys@p);
 *      ties → min imbalance; the price is the CoW MIDPOINT of the candidate
 *      range achieving the max (surplus stays with traders, not a matching
 *      engine's pocket).
 *  (3) PARITY GATE — p* must sit in the oracle band or the WHOLE batch is
 *      refused (no internal price that lies vs the measured truth).
 *  (4) FUND-CHECK FIXED POINT — underfunded agents are dropped and the
 *      auction re-runs (max 6 passes) — nobody buys what they cannot pay.
 *  (5) CONSERVATION — deltas sum to ~0 per asset except the vault fee rows;
 *      agent-vs-agent crossing never mints (escrow-safe by construction).
 *  (6) RECOMPUTABILITY — every closed batch carries an fnv1a digest of its
 *      canonical inputs; the artifact is re-derivable forever.
 * Unmatched remainder is UNFILLED (honest), never force-filled through a
 * pool at a fake price. Pure: no IO, no clock. */
export function batchClear({ batch, parity, bandBps = 5000, feeBps = BATCH_FEE_BPS, balances = {}, base = "STEEM", quote = "SBD" }) {
  const laws = [];
  const rejected = [];
  const batchId = batch?.id ?? null;
  const emptyOut = (verdict, extra = {}) => ({ verdict, batchId, clearingPrice: null, matchedQty: 0, fills: [], unfilled: [], rejected, deltas: [], laws, parity: fnum(parity) ?? null, ...extra });
  if (!batchId) return emptyOut("EMPTY", { why: "no-batch-id" });
  const raw = Array.isArray(batch.orders) ? batch.orders : [];

  /** auction over one candidate order set; deterministic throughout */
  const auction = (orders) => {
    const sells = orders.filter((o) => o.side === "sell").sort((a, b) => a.limit - b.limit || String(a.id).localeCompare(String(b.id)));
    const buys = orders.filter((o) => o.side === "buy").sort((a, b) => b.limit - a.limit || String(a.id).localeCompare(String(b.id)));
    if (!sells.length || !buys.length) return null;
    const sideAt = (p) => {
      let S = 0; for (const o of sells) if (o.limit <= p + 1e-12) S += o.qty;
      let B = 0; for (const o of buys) if (o.limit >= p - 1e-12) B += o.qty;
      return { S, B, Q: Math.min(S, B), imb: Math.abs(S - B) };
    };
    const cands = [...new Set([...sells.map((o) => o.limit), ...buys.map((o) => o.limit)])].sort((a, b) => a - b);
    let best = null;
    for (const p of cands) {
      const { Q, imb } = sideAt(p);
      if (Q <= 0) continue;
      if (!best || Q > best.Q + 1e-12 || (Math.abs(Q - best.Q) < 1e-12 && imb < best.imb)) best = { Q, imb, p };
    }
    if (!best) return null;
    // CoW midpoint of the candidate range achieving max volume (Q is flat on
    // the whole range — S non-decreasing, B non-increasing → min stays ≥ Q*)
    const achieving = cands.filter((p) => { const { Q } = sideAt(p); return Math.abs(Q - best.Q) < 1e-12; });
    const pLo = Math.min(...achieving), pHi = Math.max(...achieving);
    const price = r6((pLo + pHi) / 2);
    const { Q: QatPrice } = sideAt(price);
    if (Math.abs(QatPrice - best.Q) > 1e-9) return null; // clearing-unstable (defensive, typed)
    const fills = [];
    let rem = QatPrice;
    for (const o of sells) {
      if (rem <= 1e-12) break;
      const fq = Math.min(o.qty, rem); rem -= fq;
      fills.push({ orderId: o.id, agent: o.agent, side: "sell", limit: o.limit, qty: o.qty, fillQty: r6(fq), clearingPrice: price });
    }
    let rem2 = QatPrice;
    for (const o of buys) {
      if (rem2 <= 1e-12) break;
      const fq = Math.min(o.qty, rem2); rem2 -= fq;
      fills.push({ orderId: o.id, agent: o.agent, side: "buy", limit: o.limit, qty: o.qty, fillQty: r6(fq), clearingPrice: price });
    }
    return { clearingPrice: price, matchedQty: r6(QatPrice), fills };
  };

  const countByAgent = new Map();

  // sanitize pass (per-agent cap maintained while counting)
  const clean = [];
  for (const o of raw) {
    const qty = fnum(o?.qty), limit = fnum(o?.limit);
    const agent = String(o?.agent ?? "").slice(0, 40);
    const side = String(o?.side ?? "").toLowerCase();
    const id = o?.id ?? null;
    if (!agent) { rejected.push({ orderId: id, why: "no-agent" }); continue; }
    if (side !== "buy" && side !== "sell") { rejected.push({ orderId: id, agent, why: "bad-side" }); continue; }
    if (!qty || qty <= 0) { rejected.push({ orderId: id, agent, why: "bad-qty" }); continue; }
    if (!limit || limit <= 0) { rejected.push({ orderId: id, agent, why: "bad-limit" }); continue; }
    if ((countByAgent.get(agent) ?? 0) >= BATCH_MAX_PER_AGENT) { rejected.push({ orderId: id, agent, why: "per-agent-cap" }); continue; }
    countByAgent.set(agent, (countByAgent.get(agent) ?? 0) + 1);
    clean.push({ id, agent, side, limit, qty: r6(qty) });
  }
  if (clean.length > BATCH_MAX_ORDERS) {
    for (const o of clean.slice(BATCH_MAX_ORDERS)) rejected.push({ orderId: o.id, agent: o.agent, why: "batch-cap" });
    clean.length = BATCH_MAX_ORDERS;
  }
  if (!clean.length) return emptyOut("EMPTY", { why: "no-valid-orders" });

  // fund-check fixed point: drop underfunded agents, re-run the auction
  let pool = clean;
  let res = null;
  for (let pass = 0; pass < 6; pass++) {
    res = auction(pool);
    if (!res) break;
    const half = ((fnum(feeBps) ?? 30) / 2) / 1e4;
    const need = new Map();
    for (const f of res.fills) {
      const n = need.get(f.agent) ?? { b: 0, q: 0 };
      if (f.side === "sell") n.b = r6(n.b + f.fillQty);
      else n.q = r6(n.q + f.fillQty * res.clearingPrice * (1 + half));
      need.set(f.agent, n);
    }
    const broke = new Set();
    for (const [agent, n] of need) {
      const b = balances?.[agent] ?? {};
      if (n.b > (fnum(b[base]) ?? 0) + 1e-9) broke.add(agent);
      if (n.q > (fnum(b[quote]) ?? 0) + 1e-9) broke.add(agent);
    }
    if (!broke.size) break;
    for (const a of broke) rejected.push({ agent: a, why: "underfunded-at-clear" });
    laws.push(`מעבר-${pass + 1}: ${broke.size} סוכן/ים נפסלו — אין-מימון במחיר-הניקוי`);
    pool = pool.filter((o) => !broke.has(o.agent));
    if (!pool.length) { res = null; break; }
  }
  if (!res) return emptyOut("NO-CROSS", { why: "אין-הצלבה בין-הצדדים — המחבת נסגרת ריקה ביושר" });

  // PARITY GATE on the FINAL clearing price
  const band = parityVerdict({ mid: res.clearingPrice, fair: parity, bandBps });
  if (band.verdict !== "IN-BAND") {
    return emptyOut("REFUSE-BAND", {
      why: "מחיר-הניקוי מחוץ-לרצועת-הפאריטי — המחבת נדחית כולה (אין-מחיר-פנימי-כוזב)",
      clearingPrice: res.clearingPrice, matchedQty: res.matchedQty, band,
    });
  }

  // deltas: conservation BY CONSTRUCTION — the vault fee is the exact
  // residual of the agents' quote flows (never an invented number)
  const half = ((fnum(feeBps) ?? 30) / 2) / 1e4;
  const deltas = [];
  let quoteFlow = 0;
  for (const f of res.fills) {
    const notional = f.fillQty * res.clearingPrice;
    if (f.side === "sell") {
      deltas.push({ holder: f.agent, asset: base, delta: -r6(f.fillQty) });
      const dq = r6(notional * (1 - half));
      deltas.push({ holder: f.agent, asset: quote, delta: dq });
      quoteFlow = r6(quoteFlow + dq);
    } else {
      deltas.push({ holder: f.agent, asset: base, delta: r6(f.fillQty) });
      const dq = -r6(notional * (1 + half));
      deltas.push({ holder: f.agent, asset: quote, delta: dq });
      quoteFlow = r6(quoteFlow + dq);
    }
  }
  const feeQuote = r6(-quoteFlow); // exact residual → Σ quote deltas = 0
  if (Math.abs(feeQuote) > 0) deltas.push({ holder: "__vault__", asset: quote, delta: feeQuote, kind: "fee" });

  const fillByOrder = new Map(res.fills.map((f) => [String(f.orderId), f.fillQty]));
  const unfilled = pool
    .filter((o) => (fillByOrder.get(String(o.id)) ?? 0) < o.qty - 1e-9)
    .map((o) => ({ orderId: o.id, agent: o.agent, side: o.side, qty: o.qty, filled: r6(fillByOrder.get(String(o.id)) ?? 0) }));

  const digest = fnv1aHex(JSON.stringify({ batchId, orders: pool, p: res.clearingPrice, fills: res.fills, parity: fnum(parity) ?? null }));
  return {
    verdict: "CLEARED", batchId,
    clearingPrice: res.clearingPrice, matchedQty: res.matchedQty,
    fills: res.fills, unfilled, rejected, deltas,
    feeQuote, band, digest,
    parity: fnum(parity) ?? null,
    laws: [...laws, "מחיר-ניקוי אחיד לכל-המילויים — אפס-סנדוויץ'-פנימי (דפוס-CoW)", "שימור-מדויק: Σ-דלתות לכל-נכס = עמלת-הכספת בלבד"],
  };
}

/** Build internal pool mids + measured real-venue mids from the engine
 * status shape (single source of truth; nothing re-measured here). */
export function venueMids({ pools, engineStatus }) {
  const out = [];
  for (const [id, p] of Object.entries(pools ?? {})) {
    if (!p?.assets || p.assets.length !== 2) continue;
    const rA = fnum(p.reserveA), rB = fnum(p.reserveB);
    if (!(rA > 0) || !(rB > 0)) continue;
    out.push({ id: `internal:${id}`, pair: p.assets, mid: r6(rB / rA), kind: "pool", reserves: { A: r6(rA), B: r6(rB) }, status: "measured", source: "הבריכה-הפנימית של הרשת (משכן-נמדד)" });
  }
  const s = engineStatus ?? {};
  const book = s.market?.book ?? null;
  if (book && fnum(book.bestAsk) > 0 && fnum(book.bestBid) > 0) {
    // LAW 19: engine book carries measured sizes — askDepthSteem (BASE
    // units) converts to quote at the touched ask (the honest floor: deeper
    // asks cost MORE, so depth × bestAsk under-states the SBD needed);
    // bidDepthSbd is already quote units.
    const askD = fnum(book.askDepthSteem), bidD = fnum(book.bidDepthSbd);
    const askAt = fnum(book.bestAsk);
    out.push({
      id: "steem-book", pair: ["STEEM", "SBD"], mid: r6((askAt + fnum(book.bestBid)) / 2), kind: "book",
      touch: {
        bestAsk: askAt, bestBid: fnum(book.bestBid),
        askDepth: askD > 0 && askAt > 0 ? r6(askD * askAt) : null,
        bidDepth: bidD > 0 ? r6(bidD) : null,
      },
      status: "measured", source: "ספר-השוק-הפנימי של Steem (נמדד-חי)",
    });
  }
  const hp = s.hive?.plan ?? null;
  if (hp && fnum(hp.mid) > 0) {
    // T-75g: the hive "book" is OUR PLAN (verdict PLANNED), not a live
    // external book — kind "plan", no touch, never a fillable venue.
    out.push({ id: "hive-book", pair: ["HBD", "HIVE"], mid: r6(fnum(hp.mid)), kind: "plan", status: "measured", source: "תוכנית-הספר של Hive (מתוכנן — לא ספר-חי)" });
  }
  for (const pond of s.enginepond?.ponds ?? []) {
    const t = pond?.touch ?? null;
    if (t && fnum(t.bestBid) > 0 && fnum(t.bestAsk) > 0) {
      const askD = fnum(t.askDepthTop5Hive), bidD = fnum(t.bidDepthTop5Hive);
      out.push({
        id: `he-${String(pond.symbol).toLowerCase()}`, pair: [String(pond.symbol ?? "").toUpperCase(), "SWAP.HIVE"], mid: r6((fnum(t.bestBid) + fnum(t.bestAsk)) / 2), kind: "book",
        touch: {
          bestAsk: fnum(t.bestAsk), bestBid: fnum(t.bestBid),
          askDepth: askD > 0 ? r6(askD) : null,
          bidDepth: bidD > 0 ? r6(bidD) : null,
        },
        status: "measured", source: "ספר-Hive-Engine (נמדד-חי)",
      });
    }
  }
  // oracle-normalized cross pegs (estimated, honestly labeled)
  // CONVENTION LAW: pair [A,B] mid = units of B per unit of A. With
  // steemUsd/sbdUsd measured: 1 SBD = sbdUsd/steemUsd STEEM — caught live
  // (T-75): an inverted oracle mid produced a phantom 9,000% "edge".
  const st2 = fnum(s.observe?.parity?.steemUsd), sb2 = fnum(s.observe?.parity?.sbdUsd);
  if (st2 > 0 && sb2 > 0) out.push({ id: "oracle-steem-sbd", pair: ["SBD", "STEEM"], mid: r6(sb2 / st2), kind: "oracle", status: "estimated", source: "אורקל — יחס-USD:SBD:STEEM (מדידת-המנוע)" });
  return out;
}

/* ── LAW 13 · capital-intake drill (תרגיל-קליטת-הון) ─────────────────── */

/** CONVERTS LANDING: group live conversion requests (chain shape
 * [{ conversion_date, amount: "N SBD" }]) into landing waves by UTC day.
 * The operator's money event (3.5-day Steem converts) becomes a measured
 * schedule: which day, how much, what lands within 24h. Pure; clock
 * injected. Fail-closed typed on empty/invalid. */
export function convertsLanding({ requests, nowSec }) {
  const now = fnum(nowSec) ?? Date.now() / 1000;
  const rows = (Array.isArray(requests) ? requests : [])
    .map((r) => {
      const amt = fnum(String(r?.amount ?? "").split(" ")[0]);
      const t = r?.conversion_date ? new Date(r.conversion_date).getTime() / 1000 : null;
      return amt && amt > 0 && t && Number.isFinite(t) ? { at: t, sbd: r6(amt), iso: String(r.conversion_date) } : null;
    })
    .filter(Boolean);
  if (!rows.length) return { verdict: "NO-LOCKS", totalSbd: 0, waves: [], nextAt: null, law: "אין-נעילות-המרה בחשבון — אין-אירוע-הון מתוכנן" };
  const byDay = new Map();
  for (const r of rows) {
    const day = new Date(r.at * 1000).toISOString().slice(0, 10);
    const w = byDay.get(day) ?? { day, from: null, to: null, sbd: 0, count: 0 };
    w.sbd = r6(w.sbd + r.sbd); w.count++;
    w.from = w.from === null || r.at < w.from ? r.at : w.from;
    w.to = w.to === null || r.at > w.to ? r.at : w.to;
    byDay.set(day, w);
  }
  const waves = [...byDay.values()].sort((a, b) => a.from - b.from).map((w) => ({
    day: w.day, sbd: w.sbd, count: w.count,
    windowUtc: `${new Date(w.from * 1000).toISOString().slice(11, 16)}–${new Date(w.to * 1000).toISOString().slice(11, 16)}`,
    within24h: w.from <= now + 86_400,
  }));
  return {
    verdict: "SCHEDULED",
    totalSbd: r6(rows.reduce((a, r) => a + r.sbd, 0)),
    waves,
    nextAt: waves.length ? new Date(Math.min(...rows.map((r) => r.at)) * 1000).toISOString() : null,
    law: "לוח-זמנים נמדד-חי מהשרשרת (סריקת-משכן חסרת-מפתח) — הכסף נכנס, המכונה קולטת",
  };
}

/** CAPITAL-INTAKE DRILL: a DRY-RUN of the exact machine path when real money
 * lands (the operator: "מחר מקבלים כסף — שהכל כבר יעבוד מוכח"). Reuses the
 * SAME law functions as the live path so the drill proves the machine, not a
 * parallel truth:
 *   L1 MEASURED-ONLY — parity + balances must be live measurements;
 *   L2 PARITY-PROPORTIONAL DEPLOY — identical law to syncEscrow (25% default,
 *      wantB = wantA × parity, capped by the quote side);
 *   L3 GRID RE-PLAN — gridPlan pre vs post with the same floor/spacing laws;
 *   L4 AUTO-ARM CANDIDATES — steemQueueOp on the post-plan tops (the drill
 *      refuses where the live path would refuse — PAUSE-FLOW bids included);
 *   L5 ESCROW PROJECTED — post covered = post inventory − post pool; the
 *      projection must hold escrow-law with the CURRENT holder floats kept
 *      whole (conservative);
 *   L6 NEVER-SHRINK — with unchanged parity, more inventory can never plan
 *      smaller reserves (proven by construction, asserted in output).
 * PURE — no IO, no mutation, no clock except injected. Zero live risk. */
export const INTAKE_DEPLOY_PCT = 0.25;
export function intakeDrill({ snapshot, inboundSbd = 0, inboundSteem = 0, deployPct = INTAKE_DEPLOY_PCT, nowSec = null }) {
  const laws = ["תרגיל-יבש — אפס-סיכון-הון; חוקי-המסילה החיים בדיוק (L2–L4) מיושמים כאן"];
  const st = fnum(snapshot?.steem), sb = fnum(snapshot?.sbd), P = fnum(snapshot?.parity);
  const inSbd = fnum(inboundSbd) ?? 0, inSteem = fnum(inboundSteem) ?? 0;
  if (!P || P <= 0 || st == null || st < 0 || sb == null || sb < 0) return { verdict: "REFUSED-NO-MEASURE", why: "פאריטי/יתרות אינן מדידה-חיה — אין-תרגיל על-אמת-לא-נמדדת", laws };
  if (inSbd < 0 || inSteem < 0 || !Number.isFinite(inSbd) || !Number.isFinite(inSteem)) return { verdict: "REFUSED-BAD-INBOUND", why: "קליטה שלילית/בלתי-סבירה נדחית", laws };
  const pct = fnum(deployPct) && fnum(deployPct) > 0 && fnum(deployPct) <= 1 ? fnum(deployPct) : INTAKE_DEPLOY_PCT;
  const spreadBps = Math.max(fnum(snapshot?.spreadBps) ?? 150, 150);
  const avgCost = fnum(snapshot?.avgCost) && fnum(snapshot?.avgCost) > 0 ? fnum(snapshot?.avgCost) : null;
  const guard = snapshot?.guardAction ?? null;

  // L2 — parity-proportional deployment, pre vs post (syncEscrow's exact law)
  const deploy = (steem, sbd) => {
    const a = Math.min(steem * pct, (sbd * pct) / P);
    return { A: Math.max(0, r6(a)), B: Math.max(0, r6(a * P)) };
  };
  const pre = deploy(st, sb);
  const post = deploy(st + inSteem, sb + inSbd);

  // L3 — grid re-plan, same laws both sides
  const gPre = gridPlan({ parity: P, spreadBps, baseBal: pre.A, quoteBal: pre.B, levels: 3, spacingBps: Math.max(spreadBps, 150), avgCost, base: "STEEM", quote: "SBD" });
  const gPost = gridPlan({ parity: P, spreadBps, baseBal: post.A, quoteBal: post.B, levels: 3, spacingBps: Math.max(spreadBps, 150), avgCost, base: "STEEM", quote: "SBD" });

  // L4 — auto-arm candidates on the POST plan tops (the drill refuses where
  // the live path refuses — the same steemQueueOp laws at the same gates)
  const seq = Math.floor(fnum(nowSec) ?? Date.now() / 1000);
  const askCand = gPost.asks[0]
    ? steemQueueOp({ level: gPost.asks[0], dexBaseBal: post.A, avgCost, guardAction: guard, seq, nowSec: seq })
    : { op: null, refuse: "no-lawful-ask" };
  const bidCand = gPost.bids[0]
    ? steemQueueOp({ level: gPost.bids[0], dexBaseBal: post.A, avgCost, guardAction: guard, seq: seq + 1, nowSec: seq })
    : { op: null, refuse: "no-lawful-bid" };

  // L5 — escrow projected: post covered = post inventory − post pool;
  // current holder floats kept whole (conservative projection)
  const coveredSteem = Math.max(0, r6(st + inSteem - post.A));
  const coveredSbd = Math.max(0, r6(sb + inSbd - post.B));
  const escrowProjected = { ok: coveredSteem >= 0 && coveredSbd >= 0, coveredSteem, coveredSbd, law: "משכן-נבוא: הכיסוי-אחרי-הקליטה = יתרה-חדשה − בריכה-חדשה (הצפים נשמרים שלמים)" };

  // L6 — never-shrink assertion (same parity, more inventory)
  const neverShrink = post.A >= pre.A - 1e-9 && post.B >= pre.B - 1e-9;
  if (!neverShrink) laws.push("הפרת-לעולם-אינו-מתכווץ — נבדקה ונכשלה (אין-כזאת במתמטיקה של-החוק; אם-מופיעה, יש באג)");

  return {
    verdict: neverShrink ? "DRILL-OK" : "DRILL-BROKEN",
    at: nowSec ? new Date(nowSec * 1000).toISOString() : null,
    intake: { SBD: r6(inSbd), STEEM: r6(inSteem) },
    pre: { poolA: pre.A, poolB: pre.B, askTop: gPre.asks[0] ?? null, bidTop: gPre.bids[0] ?? null, asks: gPre.asks.length, bids: gPre.bids.length },
    post: { poolA: post.A, poolB: post.B, askTop: gPost.asks[0] ?? null, bidTop: gPost.bids[0] ?? null, asks: gPost.asks.length, bids: gPost.bids.length },
    armCandidates: {
      ask: { lawful: !!askCand.op, refuse: askCand.refuse ?? null, price: gPost.asks[0]?.price ?? null, qty: gPost.asks[0]?.qty ?? null, orderid: askCand.orderid ?? null },
      bid: { lawful: !!bidCand.op, refuse: bidCand.refuse ?? null, price: gPost.bids[0]?.price ?? null, qty: gPost.bids[0]?.qty ?? null, orderid: bidCand.orderid ?? null },
    },
    escrowProjected,
    neverShrink,
    expected: {
      topAskNotionalQuote: gPost.asks[0] ? r6(gPost.asks[0].qty * gPost.asks[0].price) : 0,
      drainBand: gPost.asks.length ? [r6(gPost.asks[0].price), r6(gPost.asks[gPost.asks.length - 1].price)] : null,
    },
    laws: [...laws, ...(gPost.laws ?? []).slice(0, 2)],
  };
}

/* ── LAW 14 · inbound router map (מפת-ראוטרים-נכנסים לכל-הרשתות) ─────── */

/** INBOUND ROUTER MAP: the "receive and swap large amounts on EVERY network"
 * mandate rendered as one honest artifact. For each chain the registry knows:
 *   • receive — asset(s) + the memo law;
 *   • accept TODAY — armed-exit → credited instantly; gated → PENDING-
 *     UNACCEPTED with the exact reason (depositAcceptLaw, reused);
 *   • swap-to-value — best path to STEEM/SBD through the LIVE graph, typed
 *     usable/gated (routeQuote, reused — no invented prices);
 *   • large-amount law — chunk reference from the live pool depth share.
 * Pure: pools + rails injected. The LAW exists for every network; the ARMED
 * state exists where credentials/inventory exist — rendered as measured. */
export function inboundRouterMap({ pools, rails = RAILS, assets = ASSETS }) {
  const graph = buildGraph(pools ?? {}, { rails });
  const chainNames = { steem: "Steem", hive: "Hive", blurt: "Blurt", "hive-engine": "Hive-Engine" };
  const byChain = new Map();
  for (const [sym, a] of Object.entries(assets)) {
    if (sym === "CREDIT") continue; // credit has its own redemption law (L10)
    if (!byChain.has(a.chain)) byChain.set(a.chain, []);
    byChain.get(a.chain).push(sym);
  }
  const networks = [];
  for (const [chain, syms] of byChain) {
    const rows = syms.map((sym) => {
      const acc = depositAcceptLaw({ asset: sym, memo: "dex-deposit:<agent-id>", rails });
      const target = sym === "STEEM" ? "SBD" : "STEEM";
      const q = routeQuote({ graph, in: sym, out: target, amountIn: 1, railPrices: {} });
      const poolDepth = Object.entries(pools ?? {})
        .filter(([, p]) => (p?.assets ?? []).includes(sym) && fnum(p.reserveA) > 0 && fnum(p.reserveB) > 0)
        .map(([id]) => id);
      return {
        sym,
        accept: acc.verdict === "ACCEPT" ? "ACCEPT" : "PENDING-UNACCEPTED",
        acceptWhy: acc.verdict === "ACCEPT" ? "מסילת-יציאה חמושה — נקלט מיידית למשכן" : "אין-מסילת-יציאה חמושה — נרשם ולא נקלט (אין-נעילה-כוזבת)",
        exitRails: (assets[sym].rails ?? []).map((r) => ({ id: r, status: rails[r]?.status ?? "UNSPECIFIED" })),
        unlock: (assets[sym].rails ?? []).map((r) => rails[r]?.unlock ?? null).filter(Boolean)[0] ?? null,
        swapToValue: {
          verdict: q.verdict === "ROUTED" ? "SWAPABLE-NOW" : q.verdict === "ROUTED-GATED" ? "GATED-PATH" : "NO-LIQUIDITY-YET",
          path: q.path ?? null,
          gated: !!q.gated,
        },
        largeAmountLaw: poolDepth.length
          ? "פיצול-לפי-עומק-הבריכה-החיה (חוק-הגודל: REFUSED-IMPACT → תוכנית-חתיכות) — הראוטר מקבל-סכומים-גדולים בחתיכות-חוקיות"
          : "אין-בריכה-ממומנת-על-המטבע — הראוטר נפתח עם-הפקדה-מאומתת (שער-המפעיל) או credential",
      };
    });
    networks.push({
      chain,
      name: chainNames[chain] ?? chain,
      assets: rows,
      acceptAny: rows.some((r) => r.accept === "ACCEPT"),
      law: "משכן-הפקדות: העברה אמיתית עם ממוא dex-deposit:<agent-id>",
    });
  }
  return {
    verdict: "ROUTER-MAP",
    networks,
    law: "ראוטרים-נכנסים לכל-הרשתות: החוק קיים-לכולן; המצב-חמוש קיים-רק-במה שיש-עליו credential/מלאי — מוצג-כמדוד, לא כמבטיח",
  };
}

/* ── LAW 15 · BLURT escrow-OTC desk (דלפק-OTC ל-Blurt) ────────────────── */

/** BLURT ACCOUNT LAW: a Blurt account name is 3–16 chars of [a-z0-9-.] and
 * starts with a letter (Steem-family account grammar). Fail-closed for
 * delivery ops — a typo'd account is a burned escrow, never attempted. */
export const BLURT_ACCOUNT_RE = /^[a-z][a-z0-9-.]{2,15}$/;

/** BLURT RAIL STATUS (derived, honest): the blurt-otc rail's LIVE status.
 * The RAILS registry keeps the baseline; this derivation renders the
 * measured present — no price → GATED-NO-MEASURE; price but no inventory →
 * GATED-NO-INVENTORY; both but no delivery credential → QUOTED-INTERNAL
 * (internal settlement lawful, chain delivery still gated); all three →
 * ARMED. Never a promise — a derivation over measurements. */
export function blurtRailStatus({ blurtUsd, blurtInventory, hasCredential = null }) {
  const px = fnum(blurtUsd), inv = fnum(blurtInventory) ?? 0;
  const laws = ["ל-Blurt אין שוק-פנימי כלל (נמדד T-75-r) — הרשת יכולה להיות השוק-היחיד שלו, ביושר"];
  if (!(px > 0)) return { status: "GATED-NO-MEASURE", unlock: "מדידת BLURT/USD בסולם-המנוע (binance→CG) — נמדדת-עכשיו או null, לעולם לא מומצאת", inventory: r6(inv), price: null, laws };
  if (inv <= 0) return { status: "GATED-NO-INVENTORY", unlock: "מלאי-BLURT נכנס כהפקדה-מאומתת (memo dex-deposit) או float-מפעיל — שער-בלתי-הפיך בידי-המפעיל", inventory: 0, price: r6(px), laws };
  if (hasCredential !== true) return { status: "QUOTED-INTERNAL", unlock: "מפתח-Blurt על-המנוע לחתימת-העברות-אספקה (שער-המפעיל); עד-אז: סחר-פנימי-בלבד על-המשכן", inventory: r6(inv), price: r6(px), laws };
  return { status: "ARMED", unlock: null, inventory: r6(inv), price: r6(px), laws };
}

/** BLURT OTC PLAN: two-sided desk quotes at MEASURED prices only. LAWS:
 *  (1) DUAL-ORACLE PRICE — SBD-per-BLURT = blurtUsd / sbdUsd; a missing
 *      leg is NO-MEASURE typed (never a blended/invented price);
 *  (2) INVENTORY — asks ≤ measured BLURT escrow inventory (no naked short:
 *      the desk sells only what the escrow actually holds);
 *  (3) FUNDS — bids ≤ vault SBD (the desk buys only with real fee
 *      inventory — never printed money);
 *  (4) HONEST-WIDE SPREAD — spacing ≥ max(spreadBps, 300bps): an
 *      illiquid chain gets a wide honest desk, not a fake tight one
 *      (Blurt 24h vol measured ~$46/day, T-75-r);
 *  (5) SIZES — per-level inventory/quote split, r6 everywhere.
 * Pure; fail-closed; no clock. */
export const BLURT_OTC_MIN_SPREAD_BPS = 300;
export function blurtOtcPlan({ blurtUsd, sbdUsd, blurtInventory, vaultSbd, spreadBps = 1500, levels = 2 }) {
  const px = fnum(blurtUsd), su = fnum(sbdUsd), inv = fnum(blurtInventory) ?? 0, vSbd = fnum(vaultSbd) ?? 0;
  const laws = [];
  if (!(px > 0) || !(su > 0)) return { verdict: "NO-MEASURE", why: "אין-מדידת-BLURT/USD או SBD/USD — אין-מחיר-חוקי בלי-שתי-הרגליים (חוק-אורקל-כפול)", asks: [], bids: [], laws };
  const P = px / su; // SBD per BLURT — dual-oracle law
  const spacing = Math.max(fnum(spreadBps) ?? 1500, BLURT_OTC_MIN_SPREAD_BPS);
  const lv = Math.max(1, Math.min(4, Math.floor(fnum(levels) ?? 2)));
  const asks = [], bids = [];
  const invPer = inv / lv, budgetPer = vSbd / lv;
  for (let i = 1; i <= lv; i++) {
    if (invPer > 0) {
      const price = P * (1 + (spacing * i) / 1e4);
      asks.push({ side: "ask", level: i, price: r6(price), qty: r6(invPer), notionalSbd: r6(invPer * price) });
    }
    if (budgetPer > 0) {
      const price = P * (1 - (spacing * i) / 1e4);
      if (price > 0) bids.push({ side: "bid", level: i, price: r6(price), qty: r6(budgetPer / price), notionalSbd: r6(budgetPer) });
    }
  }
  if (inv <= 0) laws.push("אפס-אסקים — אין-מלאי-BLURT נמדד (אין-מכירה-בחוסר-כיסוי)");
  if (vSbd <= 0) laws.push("אפס-בידים — אין-מלאי-SBD בכספת (אין-קנייה-בכסף-מומצא)");
  return {
    verdict: asks.length || bids.length ? "OTC-QUOTED" : "OTC-EMPTY",
    priceSbdPerBlurt: r6(P), spreadBps: spacing, levels: lv,
    asks, bids, laws,
    law: "דלפק-OTC דו-צדדי על-מדידות-בלבד: אסק ≤ משכן-BLURT · ביד ≤ כספת-SBD · פריסה-רחבה-כנה לשרשרת-דקה",
  };
}

/** BLURT DELIVERY OP (queue shape for the engine's single signer — the SAME
 * single-writer law as steemQueueOp): a plain Blurt transfer of REAL escrow
 * inventory to the buyer, memo saos-otc:v1:<ref>|seq:<n> for traceability.
 * Typed refuses; the op reaches the queue ONLY when the rail is armed —
 * until then this shape is PLANNED evidence, never broadcast. */
export function blurtDeliveryOp({ qty, to, blurtInventory, ref, seq }) {
  const q = fnum(qty), inv = fnum(blurtInventory) ?? 0;
  const acct = String(to ?? "").toLowerCase();
  if (!q || q <= 0) return { op: null, refuse: "bad-qty" };
  if (!BLURT_ACCOUNT_RE.test(acct)) return { op: null, refuse: "bad-account" };
  if (q > inv + 1e-9) return { op: null, refuse: "no-inventory" };
  return {
    op: ["transfer", {
      from: "__ACCOUNT__", to: acct,
      amount: `${r3(q).toFixed(3)} BLURT`,
      memo: `saos-otc:v1:${String(ref ?? "ref").slice(0, 48)}|seq:${Math.floor(fnum(seq) ?? 0)}`,
    }],
    refuse: null, qty: r6(q), to: acct,
    law: "אספקה = העברת-BLURT אמיתית מהמשכן, ממוא-מעקב — חתימת-המנוע בלבד, רק-במסילה-חמושה",
  };
}

/* ── LAW 16 · HE pond calibration (כיול-הבריכות-העטופות) ──────────────── */

/** HE CALIBRATION — the T-75-r verify-before-arm list, productized into a
 * standing law. Every Hive-Engine pond mid (measured in SWAP.HIVE units by
 * the engine's enginepond) implies a USD price through the SWAP.HIVE peg
 * (1:1 HIVE) and the engine's hiveUsd leg. The implied price faces the
 * independent USD anchor (binance/CG ladder). DRIFT beyond maxDriftBps is
 * typed — thin wrapped books rot silently (SWAP.LTC −1.5% measured
 * 2026-10-04); the calibration refuses to let them lie. A symbol without
 * an independent anchor is NO-ANCHOR typed — never assumed. Pure. */
export const HE_ANCHOR_SYMBOLS = { "SWAP.LTC": "ltcUsd", "SWAP.BTC": "btcUsd", "SWAP.HIVE": "hiveUsd", "SWAP.HBD": "hbdUsd", "DEC": "decUsd" };
export function heCalibration({ ponds, hiveUsd, ltcUsd = null, btcUsd = null, hbdUsd = null, decUsd = null, maxDriftBps = 300 }) {
  const hv = fnum(hiveUsd);
  if (!(hv > 0)) return { verdict: "NO-MEASURE", why: "אין-רגל-דולר ל-HIVE — הכיול אינו מוגדר (fail-closed)", rows: [] };
  const anchors = { ltcUsd: fnum(ltcUsd), btcUsd: fnum(btcUsd), hiveUsd: hv, hbdUsd: fnum(hbdUsd), decUsd: fnum(decUsd) };
  const rows = (Array.isArray(ponds) ? ponds : []).map((pond) => {
    const sym = String(pond?.symbol ?? "").toUpperCase();
    const t = pond?.touch ?? null;
    const bid = fnum(t?.bestBid), ask = fnum(t?.bestAsk);
    if (!(bid > 0) || !(ask > 0)) return { sym, verdict: "NO-MEASURE", why: "אין-ספר-חי על-הבריכה (touch ריק)" };
    const mid = (bid + ask) / 2;
    const impliedUsd = mid * hv; // SWAP.HIVE peg 1:1 → HIVE → USD
    const anchorKey = HE_ANCHOR_SYMBOLS[sym] ?? null;
    const anchor = anchorKey ? anchors[anchorKey] : null;
    const spreadBps = ask >= bid ? Math.round(((ask - bid) / ((ask + bid) / 2)) * 1e4 * 10) / 10 : null;
    if (!(anchor > 0)) return { sym, mid: r6(mid), spreadBps, impliedUsd: r6(impliedUsd), verdict: "NO-ANCHOR", why: "אין-עוגן-דולר בלתי-תלוי למטבע-זה — לא מניחים" };
    const driftBps = Math.round((bpsOf(impliedUsd, anchor) ?? 0) * 10) / 10;
    return {
      sym, mid: r6(mid), spreadBps, impliedUsd: r6(impliedUsd), anchorUsd: r6(anchor), driftBps,
      verdict: Math.abs(driftBps) <= (fnum(maxDriftBps) ?? 300) ? "CALIBRATED" : "DRIFTED",
    };
  });
  const real = rows.filter((r) => r.verdict === "CALIBRATED" || r.verdict === "DRIFTED");
  const verdict = rows.length === 0 ? "NO-MEASURE" : real.some((r) => r.verdict === "DRIFTED") ? "DRIFT-DETECTED" : real.length ? "ALL-CALIBRATED" : "NO-ANCHORS";
  return {
    verdict, rows,
    law: "כיול-אמת: מחיר-מרומז-מהספר מול-עוגן-דולר בלתי-תלוי — סטייה-מעבר-לרצועה מוקלדת (ספרים-דקים לא משקרים בשקט)",
  };
}

/* ── LAW 17 · drift guard + oracle venues (משמר-הסטייה ואורקלי-העוגן) ── */

/** ORACLE VENUES — the fair price of every anchored HE pond as a scan
 * venue. Convention law (same as venueMids): pair [A,B] mid = units of B
 * per unit of A, so pair [SYM, SWAP.HIVE] mid = usd(SYM)/usd(HIVE). A row
 * without an anchor produces NO venue (never an assumed price). Status
 * "estimated" — oracle-derived, honestly labeled. Pure. */
export function heOracleVenues({ calibration, hiveUsd }) {
  const hv = fnum(hiveUsd);
  if (!(hv > 0) || !Array.isArray(calibration?.rows)) return [];
  return calibration.rows
    .filter((r) => fnum(r?.anchorUsd) > 0 && !!r?.sym)
    .map((r) => ({
      id: `oracle-he-${String(r.sym).toLowerCase()}`,
      pair: [String(r.sym).toUpperCase(), "SWAP.HIVE"],
      mid: r6(fnum(r.anchorUsd) / hv),
      kind: "oracle",
      status: "estimated",
      calib: r.verdict ?? null,
      source: `אורקל — עוגן-USD בלתי-תלוי (${r.verdict ?? "?"}) דרך-פג-ה-SWAP.HIVE`,
    }));
}

/** DRIFT GUARD — a proven-rotted pond must not be scanned as if its mid
 * were truth. Annotates each he-* venue with its calibration verdict;
 * a DRIFTED pond is QUARANTINED (status "quarantined-drift") — arbScan
 * never pairs it, so a rotted mid can never mint a phantom edge (the
 * mid of a thin book is not a fillable price — measured: SWAP.LTC mid
 * −392bps below fair while its ASK sits ABOVE fair: mid-arb there would
 * have been a money-loser dressed as opportunity). CALIBRATED/NO-ANCHOR
 * venues stay scannable, honestly labeled. Internal/book/oracle venues
 * pass through untouched. Pure. */
export function pondDriftGuard({ venues, calibration }) {
  const rows = Array.isArray(calibration?.rows) ? calibration.rows : [];
  const bySym = new Map(rows.map((r) => [String(r?.sym ?? "").toUpperCase(), r]));
  let quarantined = [];
  const guarded = (Array.isArray(venues) ? venues : []).map((v) => {
    if (!v || !Array.isArray(v.pair)) return v;
    const id = String(v.id ?? "");
    if (id.startsWith("oracle-he-")) return { ...v, calib: v.calib ?? null };
    if (!id.startsWith("he-")) return v;
    const sym = String(v.pair[0] ?? "").toUpperCase();
    const row = bySym.get(sym);
    if (!row) return { ...v, calib: "NO-MEASURE" };
    if (row.verdict === "DRIFTED") {
      quarantined.push(id);
      return { ...v, status: "quarantined-drift", calib: "DRIFTED", driftBps: row.driftBps ?? null };
    }
    return { ...v, calib: row.verdict === "CALIBRATED" ? "CALIBRATED" : row.verdict === "NO-ANCHOR" ? "NO-ANCHOR" : row.verdict, driftBps: row.driftBps ?? null };
  });
  return { venues: guarded, quarantined, law: "משמר-סטייה: בריכה-שקועה-מעל-הרצועה נכנסת-להסגר — mid שקוע אינו מחיר-מילוי; אין-קצה-פנטום מספר-דק" };
}
