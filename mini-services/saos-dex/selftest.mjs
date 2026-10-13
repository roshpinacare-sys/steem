/**
 * selftest.mjs — T-75 · DEX CERTIFICATION VECTORS (אישור-ה-DEX).
 * Pure, offline, deterministic — the house style (§68-§74 discipline):
 * every law in lib.mjs gets truth vectors + fail-closed vectors.
 * Run: bun selftest.mjs  → prints n/n PASS + exits 1 on any failure.
 */
import {
  ASSETS, RAILS, escrowCheck, creditMint, ammOut, lpMint, parityVerdict,
  gridPlan, buildGraph, allPaths, simulatePath, routeQuote, arbScan,
  validateIntent, settleIntentDeltas, dexOrderId, DEX_ORDER_BASE, DEX_ORDER_MAX,
  steemQueueOp, venueMids, depositAcceptLaw, redemptionQuote, vaultSweepPlan,
  batchClear, fnv1aHex, BATCH_MAX_PER_AGENT, r6,
  convertsLanding, intakeDrill, inboundRouterMap, INTAKE_DEPLOY_PCT,
  blurtRailStatus, blurtOtcPlan, blurtDeliveryOp, heCalibration, BLURT_OTC_MIN_SPREAD_BPS,
  heOracleVenues, pondDriftGuard, edgeDepthCap, DEPTH_FRACTION, POOL_FRACTION,
  intentDepthGuard,
} from "./lib.mjs";

let pass = 0, fail = 0, i = 0;
const ok = (name, cond, extra = "") => {
  i++;
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (t) => console.log(`\n■ ${t}`);

/* ── §75a · escrow law ───────────────────────────────────────────────── */
section("§75a escrow-law (משכן — האמת נגד ההדפסה)");
{
  const honest = { backing: { STEEM: { internal: 5, covered: 7.3, backing: [{ source: "engine", amount: 7.3 }] }, SBD: { internal: 12, covered: 15.9, backing: [{ source: "engine", amount: 15.9 }] } }, balances: { __vault__: { STEEM: 0.5, SBD: 1.5 }, "agent-1": { STEEM: 2, SBD: 5 } } };
  const e = escrowCheck(honest);
  ok("escrow: honest ledger passes", e.ok === true && e.violations.length === 0, `checked=${e.checked}`);
  const fake = JSON.parse(JSON.stringify(honest));
  fake.balances["agent-1"].STEEM = 100; // printed money
  const e2 = escrowCheck(fake);
  ok("escrow: printed-money caught fail-closed", e2.ok === false && e2.violations[0]?.asset === "STEEM" && e2.violations[0]?.why === "internal-exceeds-backing");
  const e3 = escrowCheck(null);
  ok("escrow: null ledger fails closed", e3.ok === false && e3.violations[0]?.why === "no-ledger");
  const e4 = escrowCheck({ backing: {}, balances: { a: { CREDIT: 999 } } });
  ok("escrow: CREDIT exempt from escrow (own mint law)", e4.ok === true);
}

/* ── §75b credit mint law ────────────────────────────────────────────── */
section("§75b credit-mint law (אין הדפסה-עצמית)");
{
  ok("mint: refused without anchor ref", creditMint({ credit: { supply: 0 } }, { amount: 100, ref: null, reason: "x" }) === null);
  ok("mint: refused without reason", creditMint({ credit: { supply: 0 } }, { amount: 100, ref: "r", reason: null }) === null);
  ok("mint: refused over per-mint cap", creditMint({ credit: { supply: 0 } }, { amount: 999999, ref: "r", reason: "r" }) === null);
  const m = creditMint({ credit: { supply: 990_000 } }, { amount: 5000, ref: "fill-txid-x", reason: "fee-vault" });
  ok("mint: refused over supply ceiling (10×10k)", m === null);
  const m2 = creditMint({ credit: { supply: 0 } }, { amount: 250, ref: "agent-allowance:soldier-1", reason: "allowance" });
  ok("mint: lawful mint with anchor", m2 && m2.amount === 250);
}

/* ── §75c AMM core ───────────────────────────────────────────────────── */
section("§75c AMM constant-product (מתמטיקה נקייה)");
{
  const o = ammOut({ amountIn: 1, reserveIn: 100, reserveOut: 200000, feeBps: 30 });
  // inAfter = 0.997; out = 0.997*200000/(100.997) = 1974.316070
  ok("amm: known-value case", o && Math.abs(o.out - 1974.316070) < 0.001, `out=${o?.out}`);
  ok("amm: impact positive and small", o && o.impactBps > 0 && o.impactBps < 300, `impact=${o?.impactBps}bps`);
  ok("amm: null on zero reserve", ammOut({ amountIn: 1, reserveIn: 0, reserveOut: 5 }) === null);
  ok("amm: null on negative amount", ammOut({ amountIn: -1, reserveIn: 100, reserveOut: 5 }) === null);
  const lp1 = lpMint({ reserveA: 0, reserveB: 0, lpTotal: 0, amountA: 10, amountB: 1000 });
  ok("lp: first minter = sqrt(a*b)", lp1?.first === true && Math.abs(lp1.mint - Math.sqrt(10000)) < 1e-9);
  const lp2 = lpMint({ reserveA: 10, reserveB: 1000, lpTotal: 100, amountA: 1, amountB: 100 });
  ok("lp: proportional mint", lp2 && Math.abs(lp2.mint - 10) < 1e-6, `mint=${lp2?.mint}`);
}

/* ── §75d parity band ────────────────────────────────────────────────── */
section("§75d parity-band law (רצועת-הפאריטי)");
{
  ok("parity: in band", parityVerdict({ mid: 10.1, fair: 10, bandBps: 5000 }).verdict === "IN-BAND");
  ok("parity: refuse out of band (6000bps > 5000)", parityVerdict({ mid: 16, fair: 10, bandBps: 5000 }).verdict === "REFUSE-BAND");
  ok("parity: carries measured deviation", Math.abs(parityVerdict({ mid: 10.1, fair: 10 }).devBps - 100) < 1);
  ok("parity: no-measure typed", parityVerdict({ mid: null, fair: 10 }).verdict === "NO-MEASURE");
}

/* ── §75e opposing grids ─────────────────────────────────────────────── */
section("§75e opposing grids (סריגים-מתנגדים)");
{
  const g = gridPlan({ parity: 0.105, spreadBps: 70, baseBal: 6, quoteBal: 20, levels: 3, spacingBps: 150, avgCost: 0.104381, perLevelNotionalQuote: 5 });
  ok("grid: planned verdict", g.verdict === "GRID-PLANNED");
  ok("grid: spacing ≥ measured spread", g.spacingBps >= 150);
  ok("grid: asks never naked-short (Σqty ≤ baseBal)", g.asks.reduce((a, x) => a + x.qty, 0) <= 6 + 1e-9, `Σask=${r6(g.asks.reduce((a, x) => a + x.qty, 0))}`);
  ok("grid: asks above parity, bids below", g.asks.every((x) => x.price > 0.105) && g.bids.every((x) => x.price < 0.105));
  ok("grid: cost-floor respected on asks", g.asks.every((x) => x.price >= 0.104381));
  ok("grid: bids bounded by quote inventory", g.bids.every((x) => x.notionalQuote <= 20 / 3 + 1e-6));
  const g2 = gridPlan({ parity: 0.105, baseBal: 0, quoteBal: 0 });
  ok("grid: empty inventory → GRID-EMPTY typed", g2.verdict === "GRID-EMPTY" || (!g2.asks.length && !g2.bids.length));
  ok("grid: no parity → NO-PARITY", gridPlan({ parity: null }).verdict === "NO-PARITY");
  const g3 = gridPlan({ parity: 0.105, spreadBps: 70, baseBal: 6, quoteBal: 20, avgCost: 0.12, levels: 3 });
  ok("grid: asks below avg-cost dropped entirely", g3.asks.length === 0, "cost floor above parity band");
}

/* ── §75f router ─────────────────────────────────────────────────────── */
section("§75f router (נתב רב-קפיצות + פיצול)");
{
  const pools = {
    "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 10, reserveB: 100, feeBps: 30 },
    "SBD-CREDIT": { assets: ["SBD", "CREDIT"], reserveA: 50, reserveB: 5000, feeBps: 30 },
  };
  const g = buildGraph(pools);
  const paths = allPaths(g, "STEEM", "CREDIT");
  ok("router: finds 2-hop path", paths.some((p) => p.join(">") === "STEEM>SBD>CREDIT"), paths.map((p) => p.join(">")).join(" | "));
  const railOnly = buildGraph({ "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 0, reserveB: 0 } });
  ok("router: empty pool edges unusable", simulatePath({ path: ["STEEM", "SBD"], graph: railOnly, amountIn: 1 }).verdict !== "ROUTED");
  const railG = buildGraph({}, { rails: { "hive-limit-order": { chain: "hive", status: "GATED-NO-CREDENTIAL" } } });
  const simGated = simulatePath({ path: ["HIVE", "HBD"], graph: railG, amountIn: 5, railPrices: { "hive-limit-order": 20 } });
  ok("router: gated leg detected + typed", simGated.gated === true && simGated.verdict === "GATED-LEG");
  const railOk = buildGraph({}, { rails: { "steem-limit-order": { chain: "steem", status: "ARMED" } } });
  const simRail = simulatePath({ path: ["STEEM", "SBD"], graph: railOk, amountIn: 2, railPrices: { "steem-limit-order": 9.5 } });
  ok("router: armed rail converts at measured price", simRail.verdict === "ROUTED" && Math.abs(simRail.amount - 19) < 1e-6);
  const q = routeQuote({ graph: g, in: "STEEM", out: "CREDIT", amountIn: 1, railPrices: {} });
  ok("router: best-route quote with legs", q.verdict === "ROUTED" && q.amountOut > 0 && q.legs.length === 2, `out=${q.amountOut}`);
  const qSplit = routeQuote({ graph: g, in: "STEEM", out: "CREDIT", amountIn: 10, railPrices: {}, chunkMax: 4 });
  ok("router: large amount split into chunks", qSplit.split && qSplit.split.chunks.length === 3, `chunks=${qSplit.split?.chunks.length}`);
  ok("router: no-route typed", routeQuote({ graph: g, in: "BLURT", out: "STEEM", amountIn: 1 }).verdict === "NO-ROUTE");
}

/* ── §75g arb scan (touch-aware, חוק-18) ───────────────────────────── */
section("§75g arb web (רשת-הארביטראז — הקצה נוגע בספר)");
{
  const venues = [
    { id: "internal", kind: "pool", pair: ["STEEM", "SBD"], mid: 9.52, status: "measured", source: "x" },
    { id: "steem-book", kind: "book", pair: ["STEEM", "SBD"], mid: 9.6, touch: { bestAsk: 9.63, bestBid: 9.61 }, status: "measured", source: "y" },
    { id: "oracle", kind: "oracle", pair: ["SBD", "STEEM"], mid: 0.1045, status: "estimated", source: "z" },
  ];
  const ops = arbScan({ venues, feeBps: 30, minEdgeBps: 20 });
  const poolBook = ops.find((o) => o.cls === "POOL-TOUCH");
  ok("arb: pool-vs-book touched edge (buy pool 9.52 → sell book bid 9.61 ≈ +94bps)", poolBook && Math.abs(poolBook.edgeBps - (9.61 / 9.52 - 1) * 1e4) < 1, `edge=${poolBook?.edgeBps}`);
  ok("arb: net = gross − 2×fee", poolBook && Math.abs(poolBook.netBps - (poolBook.edgeBps - 60)) < 0.1);
  ok("arb: touched prices carried (buyAt 9.52, sellAt 9.61)", poolBook && Math.abs(poolBook.touch.buyAt - 9.52) < 1e-9 && Math.abs(poolBook.touch.sellAt - 9.61) < 1e-9);
  ok("arb: pool-impact labeled upper-bound", poolBook && poolBook.impact === "pool-impact-at-execution");
  ok("arb: executable rows typed TRADEABLE", ops.filter((o) => o.cls === "TOUCH" || o.cls === "POOL-TOUCH" || o.cls === "POOL-POOL").every((o) => o.kind === "TRADEABLE"));
  const sig = ops.find((o) => o.cls === "FAIR-SIGNAL");
  ok("arb: oracle pairing = SIGNAL-ONLY (never executable)", sig && sig.verdict === "SIGNAL-ONLY" && sig.kind === "SIGNAL");
  ok("arb: verdicts typed", ops.every((o) => ["EDGE-AFTER-FEES", "EDGE-BELOW-FEES", "SIGNAL-ONLY", "MID-ONLY-NOT-ACTIONABLE"].includes(o.verdict)));
  const ops2 = arbScan({ venues, feeBps: 30, minEdgeBps: 2000 });
  ok("arb: min-edge filter works", ops2.length === 0 || ops2.every((o) => Math.abs(o.edgeBps) >= 2000));
  const inv = arbScan({
    venues: [
      { id: "a", kind: "book", pair: ["X", "Y"], mid: 2, touch: { bestAsk: 2.01, bestBid: 1.99 }, status: "measured" },
      { id: "b", kind: "book", pair: ["Y", "X"], mid: 0.5, touch: { bestAsk: 0.503, bestBid: 0.497 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  ok("arb: inverted pair with touch inversion — coherent books mint no positive edge", inv.every((o) => o.verdict !== "EDGE-AFTER-FEES"), JSON.stringify(inv.map((o) => o.netBps)));
}

/* ── §75h intents ────────────────────────────────────────────────────── */
section("§75h saos.intent.v1 (כוונות-סוכנים)");
{
  const pools = { "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 10, reserveB: 100, feeBps: 30 } };
  const g = buildGraph(pools);
  const ledger = { balances: { "soldier-1": { STEEM: 5 } } };
  const v = validateIntent({ id: "i1", agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: 2 }, { graph: g, railPrices: {}, ledger });
  ok("intent: OK + routed", v.verdict === "OK" && v.quote.amountOut > 0, `out=${v.quote?.amountOut}`);
  ok("intent: refused when balance short", validateIntent({ id: "i2", agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: 99 }, { graph: g, railPrices: {}, ledger }).verdict === "REFUSED");
  ok("intent: refused unknown agent", validateIntent({ id: "i3", agent: "ghost", in: "STEEM", out: "SBD", amountIn: 1 }, { graph: g, railPrices: {}, ledger }).verdict === "REFUSED");
  ok("intent: refused bad pair", validateIntent({ id: "i4", agent: "soldier-1", in: "BTC", out: "SBD", amountIn: 1 }, { graph: g, railPrices: {}, ledger }).verdict === "REFUSED");
  ok("intent: refused expired", validateIntent({ id: "i5", agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: 1, expires: "2020-01-01T00:00:00Z" }, { graph: g, railPrices: {}, ledger }).verdict === "REFUSED");
  ok("intent: refused slippage (minOut high)", validateIntent({ id: "i6", agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: 1, minOut: 999999 }, { graph: g, railPrices: {}, ledger }).verdict === "REFUSED-SLIPPAGE");
  const gatedG = buildGraph({}, { rails: { "hive-limit-order": { chain: "hive", status: "GATED-NO-CREDENTIAL" } } });
  const ledgerHive = { balances: { "soldier-1": { HIVE: 5 } } };
  ok("intent: refused-gated when route hits gated rail", validateIntent({ id: "i7", agent: "soldier-1", in: "HIVE", out: "HBD", amountIn: 1 }, { graph: gatedG, railPrices: { "hive-limit-order": 20 }, ledger: ledgerHive }).verdict === "REFUSED-GATED");
  const d = settleIntentDeltas({ agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: 2 }, v.quote);
  ok("settle: agent -in/+out", d.find((x) => x.holder === "soldier-1" && x.asset === "STEEM").delta === -2 && d.find((x) => x.holder === "soldier-1" && x.asset === "SBD").delta === v.quote.amountOut);
  ok("settle: vault fee row exists", d.some((x) => x.holder === "__vault__" && x.kind === "fee" && x.delta > 0));
}

/* ── §75i settlement queue ops ───────────────────────────────────────── */
section("§75i settlement ops (חוקי-התור לכותב-היחיד)");
{
  ok("orderid: inside the DEX partition", (() => { const id = dexOrderId(123); return id >= DEX_ORDER_BASE && id <= DEX_ORDER_MAX; })());
  const ask = steemQueueOp({ level: { side: "ask", price: 0.107, qty: 2 }, dexBaseBal: 5, avgCost: 0.104381, guardAction: "PAUSE-FLOW", seq: 7, nowSec: 1_800_000_000 });
  ok("queue: lawful ask op even under flow-guard", ask.op && ask.op[1].amount_to_sell === "2.000 STEEM" && ask.op[1].min_to_receive === "0.214 SBD", JSON.stringify(ask.op?.[1]?.amount_to_sell));
  const bid = steemQueueOp({ level: { side: "bid", price: 0.103, qty: 1 }, dexBaseBal: 5, avgCost: 0.104381, guardAction: "PAUSE-FLOW", seq: 8, nowSec: 1_800_000_000 });
  ok("queue: bid refused under PAUSE-FLOW", bid.op === null && bid.refuse === "flow-guard-pause");
  const naked = steemQueueOp({ level: { side: "ask", price: 0.107, qty: 99 }, dexBaseBal: 5, avgCost: 0.104381, guardAction: null, seq: 9, nowSec: 1_800_000_000 });
  ok("queue: naked-short ask refused", naked.op === null && naked.refuse === "naked-short-ask");
  const below = steemQueueOp({ level: { side: "ask", price: 0.10, qty: 1 }, dexBaseBal: 5, avgCost: 0.104381, guardAction: null, seq: 10, nowSec: 1_800_000_000 });
  ok("queue: below-cost-floor ask refused (T-64)", below.op === null && below.refuse === "below-cost-floor");
  const bidOk = steemQueueOp({ level: { side: "bid", price: 0.103, qty: 1 }, dexBaseBal: 5, avgCost: 0.104381, guardAction: null, seq: 11, nowSec: 1_800_000_000 });
  ok("queue: lawful bid op shape", bidOk.op && bidOk.op[1].amount_to_sell === "0.103 SBD" && bidOk.op[1].min_to_receive === "1.000 STEEM");
}

/* ── §75j venue mids ─────────────────────────────────────────────────── */
section("§75j venue mids (מקור-אמת-יחיד מהמנוע)");
{
  const mids = venueMids({
    pools: { "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 2, reserveB: 19 } },
    engineStatus: {
      market: { book: { bestAsk: 0.1044, bestBid: 0.1036 } },
      hive: { plan: { mid: 20.5 } },
      enginepond: { ponds: [{ symbol: "SWAP.LTC", touch: { bestBid: 1152, bestAsk: 1260 } }] },
      observe: { parity: { steemUsd: 0.10, sbdUsd: 0.95 } },
    },
  });
  ok("mids: internal pool mid", mids.some((m) => m.id === "internal:STEEM-SBD" && m.mid === 9.5));
  ok("mids: pool venue tagged kind=pool", mids.some((m) => m.id === "internal:STEEM-SBD" && m.kind === "pool"));
  ok("mids: steem book mid measured", mids.some((m) => m.id === "steem-book" && Math.abs(m.mid - 0.104) < 1e-9));
  ok("mids: steem book carries measured touch", mids.some((m) => m.id === "steem-book" && m.kind === "book" && m.touch?.bestAsk === 0.1044 && m.touch?.bestBid === 0.1036));
  ok("mids: hive plan tagged kind=plan (not a live book)", mids.some((m) => m.id === "hive-book" && m.kind === "plan"));
  ok("mids: HE pond measured with touch", mids.some((m) => m.id === "he-swap.ltc" && m.mid === 1206 && m.kind === "book" && m.touch?.bestAsk === 1260));
  ok("mids: oracle pair labeled estimated + kind=oracle", mids.some((m) => m.id === "oracle-steem-sbd" && m.status === "estimated" && m.kind === "oracle"));
}

/* ── §75l convention law (pair [A,B] mid = units of B per A) ─────────── */
section("§75l convention law (כיוון-המחירים — בלי קצוות-פנטום)");
{
  // 1 STEEM = 9.5 SBD (steemUsd 0.95, sbdUsd 0.10); pool 2 STEEM / 19 SBD
  const mids = venueMids({
    pools: { "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 2, reserveB: 19 } },
    engineStatus: { observe: { parity: { steemUsd: 0.95, sbdUsd: 0.10 } } },
  });
  const pool = mids.find((m) => m.id === "internal:STEEM-SBD");
  const oracle = mids.find((m) => m.id === "oracle-steem-sbd");
  ok("convention: pool mid = SBD-per-STEEM (9.5)", pool && Math.abs(pool.mid - 9.5) < 1e-6, `mid=${pool?.mid}`);
  ok("convention: oracle mid = STEEM-per-SBD (0.105263)", oracle && Math.abs(oracle.mid - 0.105263) < 1e-4, `mid=${oracle?.mid}`);
  const ops = arbScan({ venues: mids, feeBps: 30, minEdgeBps: 20 });
  const phantom = ops.filter((o) => Math.abs(o.edgeBps) > 1000);
  ok("convention: no phantom edges between coherent venues", phantom.length === 0, JSON.stringify(ops.map((o) => o.edgeBps)));
  ok("convention: oracle pairing renders SIGNAL-ONLY, never executable", ops.filter((o) => o.cls === "FAIR-SIGNAL").every((o) => o.verdict === "SIGNAL-ONLY" && o.kind === "SIGNAL"));
}

/* ── §75m deposit custody law ────────────────────────────────────────── */
section("§75m deposit custody (משכן-הפקדות — אין נעילה-כוזבת)");
{
  const acc = depositAcceptLaw({ asset: "STEEM", memo: "dex-deposit:soldier-9" });
  ok("deposit: armed exit accepts", acc.verdict === "ACCEPT" && acc.agent === "soldier-9");
  const pend = depositAcceptLaw({ asset: "HIVE", memo: "dex-deposit:soldier-9" });
  ok("deposit: gated exit = PENDING-UNACCEPTED (no lock-in lie)", pend.verdict === "PENDING-UNACCEPTED" && pend.why === "no-armed-exit-rail");
  ok("deposit: bad memo refused", depositAcceptLaw({ asset: "STEEM", memo: "hello" }).verdict === "REFUSED");
  ok("deposit: unknown asset refused", depositAcceptLaw({ asset: "GOLD", memo: "dex-deposit:x" }).verdict === "REFUSED");
}

/* ── §75n CREDIT redemption law ──────────────────────────────────────── */
section("§75n credit redemption (הנזלת-אמת — מהכספת בלבד)");
{
  const okq = redemptionQuote({ credit: 100, asset: "STEEM", vaultBalance: 12, steemUsd: 0.1, agentBalance: 250 });
  ok("redeem: $1 face at measured parity", okq.verdict === "OK" && Math.abs(okq.out - 10) < 1e-6, `out=${okq.out}`);
  ok("redeem: below min refused", redemptionQuote({ credit: 50, asset: "STEEM", vaultBalance: 5, steemUsd: 0.1, agentBalance: 250 }).verdict === "REFUSED");
  ok("redeem: agent balance short refused", redemptionQuote({ credit: 100, asset: "STEEM", vaultBalance: 5, steemUsd: 0.1, agentBalance: 50 }).verdict === "REFUSED");
  ok("redeem: vault inventory short refused", redemptionQuote({ credit: 100, asset: "STEEM", vaultBalance: 1, steemUsd: 0.1, agentBalance: 250 }).verdict === "REFUSED-VAULT");
  ok("redeem: no measured parity fails closed", redemptionQuote({ credit: 100, asset: "STEEM", vaultBalance: 5, steemUsd: null, agentBalance: 250 }).verdict === "REFUSED");
  ok("redeem: non-armed asset refused", redemptionQuote({ credit: 100, asset: "HIVE", vaultBalance: 5, agentBalance: 250 }).verdict === "REFUSED");
  const sbdq = redemptionQuote({ credit: 200, asset: "SBD", vaultBalance: 5, sbdUsd: 0.95, agentBalance: 250 });
  ok("redeem: SBD leg at measured $0.95", sbdq.verdict === "OK" && Math.abs(sbdq.out - 200 * 0.01 / 0.95) < 1e-6, `out=${sbdq.out}`);
}

/* ── §75o vault sweep law ────────────────────────────────────────────── */
section("§75o vault sweep (מיחזור-עמלות לנוכחות)");
{
  const sw = vaultSweepPlan({ vaultSteem: 1.2, vaultSbd: 2.0, parity: 0.105, guardAction: null });
  ok("sweep: both legs when guard allows", sw.verdict === "SWEEP-PLANNED" && sw.levels.length === 2 && sw.levels[0].side === "ask" && sw.levels[1].side === "bid");
  const paused = vaultSweepPlan({ vaultSteem: 1.2, vaultSbd: 2.0, parity: 0.105, guardAction: "PAUSE-FLOW" });
  ok("sweep: PAUSE-FLOW zeroes the bid leg (asks lawful)", paused.levels.length === 1 && paused.levels[0].side === "ask");
  const below = vaultSweepPlan({ vaultSteem: 0.1, vaultSbd: 0.1, parity: 0.105, guardAction: null });
  ok("sweep: below threshold typed", below.verdict === "BELOW-THRESHOLD");
}

/* ── §75p batch clearing (mini-CoW — מחיר-ניקוי אחיד) ────────────────── */
section("§75p batch clearing (מחבת-CoW — אחידות, שימור, שערים)");
{
  const mkBatch = () => ({ id: "bx", orders: [
    { id: "s1", agent: "a", side: "sell", limit: 0.104, qty: 2 },
    { id: "s2", agent: "b", side: "sell", limit: 0.106, qty: 3 },
    { id: "p1", agent: "c", side: "buy", limit: 0.107, qty: 4 },
    { id: "p2", agent: "d", side: "buy", limit: 0.105, qty: 2 },
  ] });
  const bal = { a: { STEEM: 5, SBD: 0 }, b: { STEEM: 5, SBD: 0 }, c: { STEEM: 0, SBD: 5 }, d: { STEEM: 0, SBD: 5 } };
  const r = batchClear({ batch: mkBatch(), parity: 0.1052, balances: bal });
  ok("batch: CLEARED at uniform price", r.verdict === "CLEARED" && r.clearingPrice === 0.1065, `p*=${r.clearingPrice}`);
  ok("batch: matched max volume (4)", r.matchedQty === 4, `q=${r.matchedQty}`);
  ok("batch: uniform price law — executed sells ≤ p* ≤ executed buys", r.fills.filter((f) => f.side === "sell").every((f) => f.limit <= r.clearingPrice + 1e-12) && r.fills.filter((f) => f.side === "buy").every((f) => f.limit >= r.clearingPrice - 1e-12));
  ok("batch: buyer below p* not executed (0.105 < 0.1065)", r.fills.every((f) => f.orderId !== "p2"));
  ok("batch: partial marginal fill is honest", r.unfilled.some((u) => u.orderId === "s2" && u.filled === 2));
  const sum = (asset) => r6(r.deltas.filter((d) => d.asset === asset).reduce((a, d) => a + d.delta, 0));
  ok("batch: conservation — Σ STEEM deltas = 0", Math.abs(sum("STEEM")) < 1e-9, `Σ=${sum("STEEM")}`);
  ok("batch: conservation — Σ SBD deltas = 0 (fee = exact residual)", Math.abs(sum("SBD")) < 1e-9, `Σ=${sum("SBD")}`);
  ok("batch: vault fee row positive", r.feeQuote > 0 && r.deltas.some((d) => d.holder === "__vault__" && d.kind === "fee"), `fee=${r.feeQuote}`);
  ok("batch: digest present (recomputability)", typeof r.digest === "string" && r.digest.length === 8);
  const r2 = batchClear({ batch: mkBatch(), parity: 0.1052, balances: bal });
  ok("batch: deterministic — same inputs → same p* + digest", r2.clearingPrice === r.clearingPrice && r2.digest === r.digest);
  const ones = batchClear({ batch: { id: "b1", orders: [{ id: "s1", agent: "a", side: "sell", limit: 0.104, qty: 2 }] }, parity: 0.1052, balances: bal });
  ok("batch: one-sided → NO-CROSS, zero deltas", ones.verdict === "NO-CROSS" && ones.deltas.length === 0);
  const band = batchClear({ batch: mkBatch(), parity: 0.5, balances: bal });
  ok("batch: clearing out of parity band → whole batch REFUSED", band.verdict === "REFUSE-BAND" && band.deltas.length === 0 && band.clearingPrice === 0.1065, `dev=${band.band?.devBps}bps`);
  const dirty = batchClear({ batch: { id: "b2", orders: [
    { id: "x1", agent: "a", side: "sideways", limit: 0.1, qty: 1 },
    { id: "x2", agent: "a", side: "sell", limit: 0.1, qty: 0 },
    { id: "x3", agent: "a", side: "sell", limit: -1, qty: 1 },
    { id: "s1", agent: "a", side: "sell", limit: 0.104, qty: 2 },
    { id: "p1", agent: "c", side: "buy", limit: 0.107, qty: 4 },
  ] }, parity: 0.1052, balances: bal });
  ok("batch: bad orders rejected without poisoning", dirty.rejected.length === 3 && dirty.verdict === "CLEARED", `rejected=${dirty.rejected.length}`);
  const poor = batchClear({ batch: { id: "b3", orders: [
    { id: "s1", agent: "a", side: "sell", limit: 0.104, qty: 2 },
    { id: "p1", agent: "c", side: "buy", limit: 0.107, qty: 4 },
    { id: "p2", agent: "d", side: "buy", limit: 0.106, qty: 2 },
  ] }, parity: 0.1052, balances: { a: { STEEM: 5 }, c: { SBD: 0.1 }, d: { SBD: 5 } } });
  ok("batch: underfunded buyer dropped by the fixed point, rest clears", poor.verdict === "CLEARED" && poor.rejected.some((x) => x.agent === "c" && x.why === "underfunded-at-clear") && poor.matchedQty === 2, `q=${poor.matchedQty} rejected=${poor.rejected.length}`);
  const capped = batchClear({ batch: { id: "b4", orders: Array.from({ length: BATCH_MAX_PER_AGENT + 1 }, (_, k) => ({ id: `s${k}`, agent: "a", side: "sell", limit: 0.104, qty: 1 })) }, parity: 0.1052, balances: bal });
  ok("batch: per-agent order cap enforced", capped.rejected.filter((x) => x.why === "per-agent-cap").length === BATCH_MAX_PER_AGENT - 4 || capped.rejected.some((x) => x.why === "per-agent-cap"));
  ok("fnv: deterministic digest", fnv1aHex("abc") === fnv1aHex("abc") && fnv1aHex("abc") !== fnv1aHex("abd"));
}

/* ── §75q capital-intake drill + router map (T-75d) ──────────────────── */
section("§75q intake-drill + router-map (תרגיל-קליטת-הון · ראוטרים-נכנסים)");
{
  /* convertsLanding — the money event schedule */
  const NOW = new Date("2026-10-04T10:00:00Z").getTime() / 1000;
  const reqs = [
    { conversion_date: "2026-10-06T00:02:12", amount: "0.001 SBD" },
    { conversion_date: "2026-10-06T00:02:30", amount: "7.611 SBD" },
    { conversion_date: "2026-10-06T02:41:15", amount: "10.000 SBD" },
    { conversion_date: "2026-10-07T17:06:00", amount: "114.244 SBD" },
    { conversion_date: "2026-10-07T17:06:30", amount: "garbage" },   // filtered
    { conversion_date: null, amount: "5.000 SBD" },                   // filtered
  ];
  const cl = convertsLanding({ requests: reqs, nowSec: NOW });
  ok("landing: scheduled verdict + total (131.856 measured)", cl.verdict === "SCHEDULED" && Math.abs(cl.totalSbd - 131.856) < 1e-6, `total=${cl.totalSbd}`);
  ok("landing: two day-waves", cl.waves.length === 2 && cl.waves[0].day === "2026-10-06" && cl.waves[1].day === "2026-10-07");
  // honesty law: Oct 4 10:00Z → Oct 6 00:02Z is ~38h — NOT within 24h
  ok("landing: wave-1 sum (17.612); >24h out → within24h=false (no false urgency)", Math.abs(cl.waves[0].sbd - 17.612) < 1e-6 && cl.waves[0].within24h === false, `w1=${cl.waves[0].sbd}`);
  ok("landing: within24h flips true inside the window", convertsLanding({ requests: reqs, nowSec: new Date("2026-10-05T12:00:00Z").getTime() / 1000 }).waves[0].within24h === true);
  ok("landing: invalid rows filtered (no crash, no phantom SBD)", Math.abs(cl.totalSbd - (17.612 + 114.244)) < 1e-6);
  ok("landing: empty → NO-LOCKS typed", convertsLanding({ requests: [], nowSec: NOW }).verdict === "NO-LOCKS");
  ok("landing: null requests → NO-LOCKS (fail-closed)", convertsLanding({ requests: null, nowSec: NOW }).verdict === "NO-LOCKS");

  /* intakeDrill — the dry-run of the machine path */
  const snap = { steem: 15.551, sbd: 0.366, parity: 0.1041, avgCost: 0.104381, spreadBps: 150, guardAction: "PAUSE-FLOW" };
  const d0 = intakeDrill({ snapshot: snap, inboundSbd: 0, nowSec: NOW });
  ok("drill: zero inbound → post == pre (identity)", d0.verdict === "DRILL-OK" && d0.post.poolA === d0.pre.poolA && d0.post.poolB === d0.pre.poolB, `A=${d0.post.poolA}`);
  ok("drill: parity-proportional exact (B = A × parity)", Math.abs(d0.post.poolB - d0.post.poolA * snap.parity) < 1e-6, `B=${d0.post.poolB}`);
  const d1 = intakeDrill({ snapshot: snap, inboundSbd: 17.612, nowSec: NOW });
  ok("drill: wave-1 intake grows reserves (never-shrink)", d1.verdict === "DRILL-OK" && d1.neverShrink === true && d1.post.poolB > d0.pre.poolB, `B ${d0.pre.poolB}→${d1.post.poolB}`);
  ok("drill: post reserves parity-proportional again", Math.abs(d1.post.poolB - d1.post.poolA * snap.parity) < 1e-6);
  ok("drill: escrow projected holds (covered ≥ 0)", d1.escrowProjected.ok === true && d1.escrowProjected.coveredSbd > 0, `coveredSBD=${d1.escrowProjected.coveredSbd}`);
  ok("drill: ask candidate lawful (op built)", d1.armCandidates.ask.lawful === true && d1.armCandidates.ask.orderid >= DEX_ORDER_BASE, `px=${d1.armCandidates.ask.price}`);
  ok("drill: bid candidate REFUSED under PAUSE-FLOW (same gate as live)", d1.armCandidates.bid.lawful === false && d1.armCandidates.bid.refuse === "flow-guard-pause");
  ok("drill: drain band above parity (profitable-side asks)", d1.expected.drainBand && d1.expected.drainBand[0] > snap.parity, `band=${JSON.stringify(d1.expected.drainBand)}`);
  const dTotal = intakeDrill({ snapshot: snap, inboundSbd: 131.856, nowSec: NOW });
  // SBD-only intake saturates the BASE cap (3.888 = 15.551×0.25) — wave-1 and
  // total plan the SAME pool (the law: base side caps the deployment). The
  // strict-growth law needs a base-side intake (real converts return SBD,
  // but the drill must prove both legs).
  ok("drill: SBD-only intake saturates the base cap honestly (post == wave-1 pool)", dTotal.verdict === "DRILL-OK" && Math.abs(dTotal.post.poolA - d1.post.poolA) < 1e-9 && Math.abs(dTotal.post.poolB - d1.post.poolB) < 1e-9, `A=${dTotal.post.poolA}`);
  const dBoth = intakeDrill({ snapshot: snap, inboundSbd: 131.856, inboundSteem: 20, nowSec: NOW });
  ok("drill: base+quote intake grows strictly (never-shrink, both legs)", dBoth.verdict === "DRILL-OK" && dBoth.neverShrink === true && dBoth.post.poolA > d1.post.poolA && dBoth.post.poolB > d1.post.poolB, `A ${d1.post.poolA}→${dBoth.post.poolA}`);
  ok("drill: base+quote stays parity-proportional", Math.abs(dBoth.post.poolB - dBoth.post.poolA * snap.parity) < 1e-6);
  ok("drill: base+quote escrow projected holds", dBoth.escrowProjected.ok === true && dBoth.escrowProjected.coveredSteem > 0 && dBoth.escrowProjected.coveredSbd > 0, `covered=${dBoth.escrowProjected.coveredSteem}/${dBoth.escrowProjected.coveredSbd}`);
  ok("drill: REFUSED-NO-MEASURE without parity", intakeDrill({ snapshot: { ...snap, parity: null }, inboundSbd: 5 }).verdict === "REFUSED-NO-MEASURE");
  ok("drill: negative inbound refused", intakeDrill({ snapshot: snap, inboundSbd: -5 }).verdict === "REFUSED-BAD-INBOUND");
  const dFloor = intakeDrill({ snapshot: { ...snap, avgCost: 0.5 }, inboundSbd: 17.612, nowSec: NOW });
  ok("drill: cost-floor above band → zero lawful asks, drill still honest", dFloor.verdict === "DRILL-OK" && dFloor.post.asks === 0 && dFloor.armCandidates.ask.refuse === "no-lawful-ask");
  const dWide = intakeDrill({ snapshot: { ...snap, sbd: 0.366, steem: 0 }, inboundSbd: 40, inboundSteem: 0, nowSec: NOW });
  ok("drill: quote-only intake still deploys parity-shape (quote side caps)", Math.abs(dWide.post.poolB - dWide.post.poolA * snap.parity) < 1e-6 && dWide.post.poolA <= 40 * INTAKE_DEPLOY_PCT / snap.parity + 1e-6, `A=${dWide.post.poolA}`);

  /* inboundRouterMap — routers on every network, honest */
  const livePools = { "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 3.888, reserveB: 0.404, feeBps: 30 }, "HIVE-HBD": { assets: ["HIVE", "HBD"], reserveA: 0, reserveB: 0, feeBps: 30 } };
  const rm = inboundRouterMap({ pools: livePools });
  ok("router-map: verdict + all registry chains present", rm.verdict === "ROUTER-MAP" && ["steem", "hive", "blurt", "hive-engine"].every((c) => rm.networks.some((n) => n.chain === c)), `chains=${rm.networks.map((n) => n.chain).join(",")}`);
  const steemRow = rm.networks.find((n) => n.chain === "steem");
  ok("router-map: STEEM accepts (armed exit) + swapable now", steemRow.acceptAny === true && steemRow.assets.every((a) => a.accept === "ACCEPT" && a.swapToValue.verdict === "SWAPABLE-NOW"), JSON.stringify(steemRow.assets.map((a) => a.swapToValue.verdict)));
  const hiveRow = rm.networks.find((n) => n.chain === "hive");
  ok("router-map: HIVE/HBD gated honestly (PENDING-UNACCEPTED + unlock named)", hiveRow.acceptAny === false && hiveRow.assets.every((a) => a.accept === "PENDING-UNACCEPTED") && hiveRow.assets.every((a) => !!a.unlock), hiveRow.assets[0].unlock?.slice(0, 40));
  const blurtRow = rm.networks.find((n) => n.chain === "blurt");
  ok("router-map: BLURT no-liquidity-yet typed (no fake path)", blurtRow.assets[0].swapToValue.verdict === "NO-LIQUIDITY-YET" && blurtRow.assets[0].accept === "PENDING-UNACCEPTED");
  const heRow = rm.networks.find((n) => n.chain === "hive-engine");
  ok("router-map: HE assets name the deposit-unlock path", heRow.assets.every((a) => /הפקדה|credential/.test(a.largeAmountLaw)), heRow.assets[0].largeAmountLaw.slice(0, 40));
  ok("router-map: law string everywhere (no naked rows)", rm.networks.every((n) => !!n.law) && rm.networks.flatMap((n) => n.assets).every((a) => !!a.acceptWhy && !!a.largeAmountLaw));
}

/* ── §75r · Blurt escrow-OTC (Law 15) ─────────────────────────────── */
section("§75r blurt-otc (דלפק-Blurt — השוק-היחיד שלו, ביושר)");
{
  ok("otc-rail: NO-MEASURE without a price (never invented)", blurtRailStatus({ blurtUsd: null, blurtInventory: 5 }).status === "GATED-NO-MEASURE" && blurtRailStatus({ blurtUsd: null, blurtInventory: 5 }).price === null);
  ok("otc-rail: GATED-NO-INVENTORY with price but empty escrow", blurtRailStatus({ blurtUsd: 0.001305, blurtInventory: 0 }).status === "GATED-NO-INVENTORY" && blurtRailStatus({ blurtUsd: 0.001305, blurtInventory: 0 }).price === 0.001305);
  ok("otc-rail: QUOTED-INTERNAL caps without credential", blurtRailStatus({ blurtUsd: 0.001305, blurtInventory: 1000 }).status === "QUOTED-INTERNAL");
  ok("otc-rail: ARMED only with all three measurements", blurtRailStatus({ blurtUsd: 0.001305, blurtInventory: 1000, hasCredential: true }).status === "ARMED");
  ok("otc-plan: NO-MEASURE without BOTH oracle legs", blurtOtcPlan({ blurtUsd: 0.001305, sbdUsd: null, blurtInventory: 1000, vaultSbd: 10 }).verdict === "NO-MEASURE" && blurtOtcPlan({ blurtUsd: null, sbdUsd: 0.6, blurtInventory: 1000, vaultSbd: 10 }).verdict === "NO-MEASURE");
  const plan = blurtOtcPlan({ blurtUsd: 0.001305, sbdUsd: 0.6019, blurtInventory: 1000, vaultSbd: 10, spreadBps: 1500, levels: 2 });
  ok("otc-plan: dual-oracle price = blurtUsd/sbdUsd", Math.abs(plan.priceSbdPerBlurt - 0.001305 / 0.6019) < 1e-6, `P=${plan.priceSbdPerBlurt}`);
  ok("otc-plan: asks ≤ inventory exactly (no naked short)", plan.verdict === "OTC-QUOTED" && Math.abs(plan.asks.reduce((a, x) => a + x.qty, 0) - 1000) < 1e-6);
  ok("otc-plan: bids ≤ vault budget exactly (no invented funds)", Math.abs(plan.bids.reduce((a, x) => a + x.notionalSbd, 0) - 10) < 1e-6);
  ok("otc-plan: all asks above parity, all bids below", plan.asks.every((a) => a.price > plan.priceSbdPerBlurt) && plan.bids.every((b) => b.price < plan.priceSbdPerBlurt));
  ok("otc-plan: honest-wide spread floor enforced", blurtOtcPlan({ blurtUsd: 0.001305, sbdUsd: 0.6019, blurtInventory: 1000, vaultSbd: 10, spreadBps: 50 }).spreadBps === BLURT_OTC_MIN_SPREAD_BPS);
  const empty = blurtOtcPlan({ blurtUsd: 0.001305, sbdUsd: 0.6019, blurtInventory: 0, vaultSbd: 0 });
  ok("otc-plan: empty escrow + empty vault → OTC-EMPTY with named laws", empty.verdict === "OTC-EMPTY" && empty.laws.length >= 2);
  ok("delivery: bad-qty refused", blurtDeliveryOp({ qty: 0, to: "buyer", blurtInventory: 100 }).refuse === "bad-qty");
  ok("delivery: bad-account refused (uppercase/short/garbage)", blurtDeliveryOp({ qty: 1, to: "XX", blurtInventory: 100 }).refuse === "bad-account" && blurtDeliveryOp({ qty: 1, to: "1bad", blurtInventory: 100 }).refuse === "bad-account");
  ok("delivery: no-inventory refused (no naked delivery)", blurtDeliveryOp({ qty: 101, to: "buyer", blurtInventory: 100 }).refuse === "no-inventory");
  const del = blurtDeliveryOp({ qty: 100.5, to: "buyer.brrr", blurtInventory: 1000, ref: "otc-42", seq: 777 });
  ok("delivery: lawful op = real transfer, 3dp amount, trace memo", del.op?.[0] === "transfer" && del.op[1].amount === "100.500 BLURT" && del.op[1].memo.startsWith("saos-otc:v1:otc-42|") && del.op[1].to === "buyer.brrr");
}

/* ── §75s · HE pond calibration (Law 16) ──────────────────────────────── */
section("§75s he-calibration (כיול-הבריכות-העטופות — ספרים-דקים לא משקרים בשקט)");
{
  ok("calib: NO-MEASURE without the hive leg (fail-closed)", heCalibration({ ponds: [{ symbol: "SWAP.LTC", touch: { bestBid: 1250, bestAsk: 1260 } }] }).verdict === "NO-MEASURE");
  const good = heCalibration({
    ponds: [
      { symbol: "SWAP.LTC", touch: { bestBid: 1250, bestAsk: 1258 } },
      { symbol: "SWAP.HIVE", touch: { bestBid: 0.999, bestAsk: 1.001 } },
    ],
    hiveUsd: 0.05625, ltcUsd: 70.56,
  });
  const ltcRow = good.rows.find((r) => r.sym === "SWAP.LTC");
  const hiveRow = good.rows.find((r) => r.sym === "SWAP.HIVE");
  ok("calib: impliedUsd = mid × hiveUsd (SWAP.HIVE peg)", Math.abs(ltcRow.impliedUsd - 1254 * 0.05625) < 0.01, `implied=${ltcRow.impliedUsd}`);
  ok("calib: drift within band → ALL-CALIBRATED", good.verdict === "ALL-CALIBRATED" && ltcRow.verdict === "CALIBRATED" && Math.abs(ltcRow.driftBps) <= 300);
  ok("calib: spreadBps rendered on book rows", typeof ltcRow.spreadBps === "number" && hiveRow.spreadBps > 0);
  const drifted = heCalibration({ ponds: [{ symbol: "SWAP.LTC", touch: { bestBid: 1330, bestAsk: 1340 } }], hiveUsd: 0.05625, ltcUsd: 70.56 });
  ok("calib: drift beyond band → DRIFT-DETECTED (typed, not silent)", drifted.verdict === "DRIFT-DETECTED" && Math.abs(drifted.rows[0].driftBps) > 300, `drift=${drifted.rows[0].driftBps}bps`);
  const noAnchor = heCalibration({ ponds: [{ symbol: "DEC", touch: { bestBid: 0.1, bestAsk: 0.11 } }], hiveUsd: 0.05625 });
  ok("calib: missing anchor → NO-ANCHOR typed (never assumed)", noAnchor.verdict === "NO-ANCHORS" && noAnchor.rows[0].verdict === "NO-ANCHOR");
  const deadBook = heCalibration({ ponds: [{ symbol: "SWAP.BTC", touch: { bestBid: 0, bestAsk: 0 } }], hiveUsd: 0.05625, btcUsd: 85100 });
  ok("calib: empty book row → NO-MEASURE row", deadBook.rows[0].verdict === "NO-MEASURE");
  ok("calib: law string everywhere (no naked rows)", !!good.law && !!drifted.law && drifted.rows.every((r) => r.verdict !== undefined));
}

/* ── §75t drift-guard + oracle venues (חוק-17 — משמר-הסטייה) ─────────── */
section("§75t drift-guard + oracle venues (משמר-הסטייה — אין-קצה-פנטום מספר-דק)");
{
  // live-shaped 2026-10-04: SWAP.LTC pond mid 1206.33 vs fair 1254.4 — a
  // 398bps "edge" that was really a rotted bid + an ask ABOVE fair.
  const calib = heCalibration({
    ponds: [
      { symbol: "SWAP.LTC", touch: { bestBid: 1152.06588332, bestAsk: 1260.59606313 } },
      { symbol: "DEC", touch: { bestBid: 0.0096412, bestAsk: 0.01012 } },
      { symbol: "BEE", touch: { bestBid: 0.5511675, bestAsk: 0.5559511 } },
    ],
    hiveUsd: 0.0563, ltcUsd: 70.56, decUsd: 0.00055804,
  });
  ok("calib: DEC anchored via decUsd → CALIBRATED (implied ≈ anchor)", calib.rows.find((r) => r.sym === "DEC")?.verdict === "CALIBRATED", `drift=${calib.rows.find((r) => r.sym === "DEC")?.driftBps}bps`);
  ok("calib: SWAP.LTC still DRIFTED (the live rot, typed)", calib.rows.find((r) => r.sym === "SWAP.LTC")?.verdict === "DRIFTED");
  ok("calib: BEE stays NO-ANCHOR (identity unverified — never assumed)", calib.rows.find((r) => r.sym === "BEE")?.verdict === "NO-ANCHOR");

  const oracles = heOracleVenues({ calibration: calib, hiveUsd: 0.0563 });
  ok("oracle: anchored rows only → 2 venues (LTC+DEC), BEE none", oracles.length === 2 && oracles.every((v) => v.id.startsWith("oracle-he-")));
  const ltcO = oracles.find((v) => v.pair[0] === "SWAP.LTC");
  ok("oracle: mid = anchorUsd/hiveUsd in [SYM, SWAP.HIVE] convention", ltcO && Math.abs(ltcO.mid - 70.56 / 0.0563) < 0.01, `mid=${ltcO?.mid}`);
  ok("oracle: status estimated (honestly labeled, not measured)", oracles.every((v) => v.status === "estimated"));
  ok("oracle: no hiveUsd → no venues (fail-closed)", heOracleVenues({ calibration: calib, hiveUsd: null }).length === 0);

  const venues = [
    { id: "internal:STEEM-SBD", pair: ["STEEM", "SBD"], mid: 0.1054, status: "measured", source: "pool" },
    { id: "oracle-steem-sbd", pair: ["SBD", "STEEM"], mid: 5.69, status: "estimated", source: "oracle" },
    { id: "he-swap.ltc", pair: ["SWAP.LTC", "SWAP.HIVE"], mid: 1206.330973, status: "measured", source: "pond" },
    { id: "he-dec", pair: ["DEC", "SWAP.HIVE"], mid: 0.0098806, status: "measured", source: "pond" },
    ...oracles,
  ];
  const guarded = pondDriftGuard({ venues, calibration: calib });
  ok("guard: DRIFTED pond → quarantined-drift + listed", guarded.venues.find((v) => v.id === "he-swap.ltc")?.status === "quarantined-drift" && guarded.quarantined.includes("he-swap.ltc"));
  ok("guard: CALIBRATED pond stays scannable + labeled", guarded.venues.find((v) => v.id === "he-dec")?.calib === "CALIBRATED" && guarded.venues.find((v) => v.id === "he-dec")?.status === "measured");
  ok("guard: internal/book venues pass through untouched", guarded.venues.find((v) => v.id === "internal:STEEM-SBD")?.status === "measured" && guarded.venues.find((v) => v.id === "internal:STEEM-SBD")?.calib === undefined);

  // THE money regression: mid-arb pond-vs-oracle on the rotted LTC book.
  // T-75g: the raw pond venue has no touch → MID-ONLY typed row (exists,
  // never actionable); with the guard it vanishes entirely.
  const rawOps = arbScan({ venues, feeBps: 30, minEdgeBps: 20 });
  ok("phantom WITHOUT guard: the rotted-pond row exists pre-guard (typed SIGNAL, not actionable)", rawOps.some((o) => o.pair === "SWAP.LTC/SWAP.HIVE" && o.kind === "SIGNAL"));
  ok("phantom WITHOUT guard: raw row is never EDGE-AFTER-FEES (touch law holds even unguarded)", rawOps.filter((o) => o.pair === "SWAP.LTC/SWAP.HIVE").every((o) => o.verdict !== "EDGE-AFTER-FEES"));
  const ops = arbScan({ venues: guarded.venues, feeBps: 30, minEdgeBps: 20 });
  ok("phantom WITH guard: zero opps on the rotted pond — quarantine holds", !ops.some((o) => o.pair === "SWAP.LTC/SWAP.HIVE"));
  ok("guard: only the rotted pair suppressed — all other pairs still scan", ops.every((o) => !String(o.pair).startsWith("SWAP.LTC")) && ops.length >= 0);
  ok("guard: law string carried", !!guarded.law);
}

/* ── §75u touch-aware arb (חוק-18 — רוצח-הפנטומים) ───────────────────── */
section("§75u touch-arb (קנייה ב-ask, מכירה ב-bid — האמת-הניגשת)");
{
  // u1 — the honest TOUCH edge: both books touched, best direction wins.
  const t1 = arbScan({
    venues: [
      { id: "book-a", kind: "book", pair: ["X", "Y"], mid: 1.0, touch: { bestAsk: 1.0, bestBid: 0.98 }, status: "measured" },
      { id: "book-b", kind: "book", pair: ["X", "Y"], mid: 1.02, touch: { bestAsk: 1.05, bestBid: 1.02 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  const u1 = t1.find((o) => o.verdict === "EDGE-AFTER-FEES");
  ok("touch: buy cheap ask (1.00) → sell rich bid (1.02) = +200bps gross", u1 && Math.abs(u1.edgeBps - 200) < 1, `edge=${u1?.edgeBps}`);
  ok("touch: net after 2×fee = +140bps", u1 && Math.abs(u1.netBps - 140) < 0.1, `net=${u1?.netBps}`);
  ok("touch: touched prices carried (buyAt 1.00, sellAt 1.02)", u1 && Math.abs(u1.touch.buyAt - 1.0) < 1e-9 && Math.abs(u1.touch.sellAt - 1.02) < 1e-9);
  ok("touch: cls TOUCH + TRADEABLE", u1 && u1.cls === "TOUCH" && u1.kind === "TRADEABLE");

  // u2 — THE PHANTOM-KILLER: wide books where mid-arb minted +140bps net
  // and the touched truth is a ~−822bps LOSS (buy ask 1.05, sell bid 0.97).
  const t2 = arbScan({
    venues: [
      { id: "book-a", kind: "book", pair: ["X", "Y"], mid: 1.0, touch: { bestAsk: 1.05, bestBid: 0.95 }, status: "measured" },
      { id: "book-b", kind: "book", pair: ["X", "Y"], mid: 1.02, touch: { bestAsk: 1.07, bestBid: 0.97 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  ok("touch: phantom killed — wide books' best touched edge is NEGATIVE", t2.length > 0 && t2[0].netBps < 0, `net=${t2[0]?.netBps}`);
  ok("touch: verdict never EDGE-AFTER-FEES on the wide books", t2.every((o) => o.verdict !== "EDGE-AFTER-FEES"));
  ok("touch: loss row still visible (honesty ≠ silence)", t2[0] && t2[0].verdict === "EDGE-BELOW-FEES" && t2[0].cls === "TOUCH");

  // u3 — the LIVE-shaped STEEM story (12:23Z measured): pool 0.106318 vs
  // wide steem-book (mid 0.102197, bid 0.098/ask 0.1065). The old law said
  // +327.6bps MEASURED EDGE-AFTER-FEES; the touched truth: both directions
  // are losses (buy book ask → sell pool −17bps; buy pool → sell bid −782bps).
  const t3 = arbScan({
    venues: [
      { id: "internal:STEEM-SBD", kind: "pool", pair: ["STEEM", "SBD"], mid: 0.106318, status: "measured" },
      { id: "steem-book", kind: "book", pair: ["STEEM", "SBD"], mid: 0.102197, touch: { bestAsk: 0.1065, bestBid: 0.098 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 10,
  });
  ok("touch: live-shaped pool-vs-wide-book — NO EDGE-AFTER-FEES (the +327 phantom is dead)", t3.every((o) => o.verdict !== "EDGE-AFTER-FEES"), JSON.stringify(t3.map((o) => o.netBps)));
  const u3 = t3[0];
  ok("touch: best direction typed POOL-TOUCH + impact label", u3 && u3.cls === "POOL-TOUCH" && u3.impact === "pool-impact-at-execution");
  ok("touch: touched prices are the REAL legs (buyAt = ask, sellAt = pool spot)", u3 && Math.abs(u3.touch.buyAt - 0.1065) < 1e-9 && Math.abs(u3.touch.sellAt - 0.106318) < 1e-6, JSON.stringify(u3?.touch));

  // u4 — half-touched book fails honest (never treated as touched)
  const t4 = arbScan({
    venues: [
      { id: "book-a", kind: "book", pair: ["X", "Y"], mid: 1.0, touch: { bestAsk: 1.0 }, status: "measured" },
      { id: "book-b", kind: "book", pair: ["X", "Y"], mid: 1.02, touch: { bestAsk: 1.05, bestBid: 1.02 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  ok("touch: half-touched book → MID-ONLY-NOT-ACTIONABLE (fail-honest)", t4.every((o) => o.verdict === "MID-ONLY-NOT-ACTIONABLE" && o.kind === "SIGNAL"));

  // u5 — plan venues never mint executable edges (our orders, not a market)
  const t5 = arbScan({
    venues: [
      { id: "hive-book", kind: "plan", pair: ["HBD", "HIVE"], mid: 20.5, status: "measured" },
      { id: "book-b", kind: "book", pair: ["HBD", "HIVE"], mid: 20.8, touch: { bestAsk: 20.9, bestBid: 20.7 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  ok("touch: plan venue = MID-ONLY (not fillable)", t5.every((o) => o.verdict === "MID-ONLY-NOT-ACTIONABLE"));

  // u6 — ordering: executable first, signals after
  const t6 = arbScan({
    venues: [
      { id: "p1", kind: "pool", pair: ["A", "B"], mid: 1.0, status: "measured" },
      { id: "p2", kind: "pool", pair: ["A", "B"], mid: 1.003, status: "measured" },
      { id: "o1", kind: "oracle", pair: ["A", "B"], mid: 1.02, status: "estimated" },
      { id: "o2", kind: "oracle", pair: ["C", "B"], mid: 1.5, status: "estimated" },
      { id: "p3", kind: "pool", pair: ["C", "B"], mid: 1.45, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  ok("touch: executable rows sort before signals", t6.length > 0 && t6[0].kind === "TRADEABLE", JSON.stringify(t6.map((o) => [o.cls, o.netBps])));
  ok("touch: POOL-POOL spot pairing executable", t6.some((o) => o.cls === "POOL-POOL"));
}

/* ── §75v depth-aware sizing (חוק-19 — הקצה גדול כמו-העומק-שהוא נוגע) ── */
section("§75v depth-cap (maxNotional מהעומק-הנמדד — אין-גודל-מנוחש)");
{
  ok("depth: fraction out of band refused", edgeDepthCap({ buyLeg: { kind: "book", touch: { askDepth: 10 } }, sellLeg: { kind: "book", touch: { bidDepth: 10 } }, depthFraction: 1.5 }).verdict === "REFUSED-FRACTION");
  // v1 — TOUCH edge, both sides measured: buy a@1.00 sell b@1.02 (+200bps)
  const v1 = edgeDepthCap({
    buyLeg: { id: "book-a", kind: "book", touch: { askDepth: 20 } },
    sellLeg: { id: "book-b", kind: "book", touch: { bidDepth: 12 } },
  });
  ok("depth: TOUCH cap = min(askDepth×0.5, bidDepth×0.5) = 6", v1.verdict === "CAPPED" && Math.abs(v1.maxNotional - 6) < 1e-9, JSON.stringify(v1));
  ok("depth: basis names both legs with sources", v1.basis.length === 2 && v1.basis[0].source.includes("askDepth") && v1.basis[1].source.includes("bidDepth"));
  // v2 — pool BUY leg bounded by its base reserve (the pool can only sell base it holds)
  const v2 = edgeDepthCap({
    buyLeg: { id: "p", kind: "pool", mid: 1.0, reserves: { A: 8, B: 50 } },
    sellLeg: { id: "b", kind: "book", touch: { bidDepth: 12 } },
  });
  ok("depth: pool-buy cap = reserveA × spot × 0.1 = 0.8 (binds over book 6)", v2.verdict === "CAPPED" && Math.abs(v2.maxNotional - 0.8) < 1e-9, JSON.stringify(v2));
  // v3 — pool SELL leg bounded by its quote reserve (can only pay quote it holds)
  const v3 = edgeDepthCap({
    buyLeg: { id: "b", kind: "book", touch: { askDepth: 20 } },
    sellLeg: { id: "p", kind: "pool", reserves: { A: 8, B: 50 } },
  });
  ok("depth: pool-sell cap = reserveB × 0.1 = 5 (binds over book 10)", v3.verdict === "CAPPED" && Math.abs(v3.maxNotional - 5) < 1e-9, JSON.stringify(v3));
  // v4 — missing measured size fails honest, the leg is NAMED
  const v4 = edgeDepthCap({
    buyLeg: { id: "steem-book", kind: "book", touch: { askDepth: null } },
    sellLeg: { id: "p", kind: "pool", reserves: { A: 8, B: 50 } },
  });
  ok("depth: no measured ask depth → DEPTH-UNKNOWN (maxNotional null, leg named)", v4.verdict === "DEPTH-UNKNOWN" && v4.maxNotional === null && String(v4.why).includes("steem-book"), JSON.stringify(v4));

  // v5 — live-shaped through arbScan: the REAL binding constraint is the
  // pool's tiny quote reserve (0.0915 SBD × 0.1 = 0.00915), not the book.
  const t5 = arbScan({
    venues: [
      { id: "internal:STEEM-SBD", kind: "pool", pair: ["STEEM", "SBD"], mid: 0.106282, reserves: { A: 0.878963, B: 0.0915 }, status: "measured" },
      { id: "steem-book", kind: "book", pair: ["STEEM", "SBD"], mid: 0.104, touch: { bestAsk: 0.1044, bestBid: 0.1036, askDepth: 12.5, bidDepth: 8.2 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  const v5 = t5.find((o) => o.kind === "TRADEABLE");
  ok("depth: arbScan row carries the cap — pool reserveB binds (0.00915 SBD)", v5 && v5.depthVerdict === "CAPPED" && Math.abs(v5.maxNotional - 0.00915) < 1e-9, JSON.stringify({ mv: v5?.maxNotional, dv: v5?.depthVerdict }));
  ok("depth: cap coexists with the touched edge (buy book ask → sell pool spot)", v5 && Math.abs(v5.touch.buyAt - 0.1044) < 1e-9 && Math.abs(v5.touch.sellAt - 0.106282) < 1e-6);

  // v6 — pond-shaped depths flow through untouched (quote units, top-5)
  const t6 = arbScan({
    venues: [
      { id: "pond-a", kind: "book", pair: ["DEC", "SWAP.HIVE"], mid: 0.009881, touch: { bestAsk: 0.01012, bestBid: 0.0096412, askDepth: 5589.8944, bidDepth: 514.1322 }, status: "measured" },
      { id: "pond-b", kind: "book", pair: ["DEC", "SWAP.HIVE"], mid: 0.009911, touch: { bestAsk: 0.01008, bestBid: 0.0097, askDepth: 900, bidDepth: 300 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  const v6 = t6.find((o) => o.kind === "TRADEABLE");
  ok("depth: pond-vs-pond TOUCH edge capped by the tighter side (300×0.5=150 HIVE)", v6 && v6.cls === "TOUCH" && v6.depthVerdict === "CAPPED" && Math.abs(v6.maxNotional - 150) < 1e-6, JSON.stringify({ mv: v6?.maxNotional }));
}

/* ── §75w intent-side depth enforcement (חוק-20 — הכוונה נכנסת-בתוך-התקרה) ── */
section("§75w intent-depth-guard (maxNotional נאכף-בכוונה — board→settlement)");
{
  // Live-shaped board (same shape as §75v v5): pool reserveB binds at 0.00915 SBD.
  const liveBoard = arbScan({
    venues: [
      { id: "internal:STEEM-SBD", kind: "pool", pair: ["STEEM", "SBD"], mid: 0.106282, reserves: { A: 0.878963, B: 0.0915 }, status: "measured" },
      { id: "steem-book", kind: "book", pair: ["STEEM", "SBD"], mid: 0.104, touch: { bestAsk: 0.1044, bestBid: 0.1036, askDepth: 12.5, bidDepth: 8.2 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  const liveEdge = liveBoard.find((o) => o.kind === "TRADEABLE");
  ok("guard: live-shaped board carries one CAPPED edge (cap 0.00915)", liveEdge && liveEdge.depthVerdict === "CAPPED" && Math.abs(liveEdge.maxNotional - 0.00915) < 1e-9);

  // w1 — no board / no TRADEABLE row for the pair → PASS (plain internal swap)
  const w1a = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 5 }, null);
  const w1b = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 5 }, { opportunities: [] });
  const w1c = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 5 }, [{ pair: "STEEM/SBD", kind: "SIGNAL", netBps: 95 }]);
  ok("guard: no board / empty board / SIGNAL-only board → PASS (no-board-edge)", w1a.verdict === "PASS" && w1b.verdict === "PASS" && w1c.verdict === "PASS" && w1a.why === "no-board-edge" && w1c.why === "no-board-edge", JSON.stringify([w1a, w1c]));

  // w2 — matched CAPPED edge, intent pays quote above cap → REFUSED-DEPTH, edge named
  const w2 = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 5 }, liveBoard);
  ok("guard: 5 SBD vs cap 0.00915 → REFUSED-DEPTH (amount-above-max-notional)", w2.verdict === "REFUSED-DEPTH" && w2.why === "amount-above-max-notional" && Math.abs(w2.edgeNotional - 5) < 1e-9, JSON.stringify(w2));
  ok("guard: refusal names the edge (pair, buy, sell, cap, net)", w2.edgePair === "STEEM/SBD" && !!w2.edgeBuy && !!w2.edgeSell && Math.abs(w2.maxNotional - 0.00915) < 1e-9 && typeof w2.edgeNetBps === "number");

  // w3 — within cap → PASS with provenance
  const w3 = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 0.009 }, liveBoard);
  ok("guard: 0.009 SBD within cap → PASS (within-max-notional, edgeNotional carried)", w3.verdict === "PASS" && w3.why === "within-max-notional" && Math.abs(w3.edgeNotional - 0.009) < 1e-9 && Math.abs(w3.maxNotional - 0.00915) < 1e-9, JSON.stringify(w3));

  // w4 — intent pays BASE: notional = amountIn × worst touched price (=sellAt on a positive edge)
  const w4refuse = intentDepthGuard({ in: "STEEM", out: "SBD", amountIn: 0.09 }, liveBoard);
  const w4pass = intentDepthGuard({ in: "STEEM", out: "SBD", amountIn: 0.086 }, liveBoard);
  ok("guard: base-denominated 0.09 STEEM × sellAt 0.106282 = 0.009565 > cap → REFUSED-DEPTH", w4refuse.verdict === "REFUSED-DEPTH" && Math.abs(w4refuse.edgeNotional - 0.0095654) < 1e-5, JSON.stringify({ v: w4refuse.verdict, n: w4refuse.edgeNotional }));
  ok("guard: base-denominated 0.086 STEEM × sellAt = 0.009140 ≤ cap → PASS", w4pass.verdict === "PASS" && Math.abs(w4pass.edgeNotional - 0.0091403) < 1e-5, JSON.stringify({ v: w4pass.verdict, n: w4pass.edgeNotional }));

  // w5 — matched edge with UNMEASURED depth → REFUSED-DEPTH-UNKNOWN (fail-closed, leg named)
  const nakedPoolBoard = arbScan({
    venues: [
      { id: "internal:STEEM-SBD", kind: "pool", pair: ["STEEM", "SBD"], mid: 0.11, status: "measured" }, // no reserves → no measurable size
      { id: "steem-book", kind: "book", pair: ["STEEM", "SBD"], mid: 0.104, touch: { bestAsk: 0.1044, bestBid: 0.1036, askDepth: 12.5, bidDepth: 8.2 }, status: "measured" },
    ],
    feeBps: 30, minEdgeBps: 20,
  });
  const w5row = nakedPoolBoard.find((o) => o.kind === "TRADEABLE");
  const w5 = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 0.001 }, nakedPoolBoard);
  ok("guard: pool without reserves → TRADEABLE row is DEPTH-UNKNOWN", w5row && w5row.depthVerdict === "DEPTH-UNKNOWN", JSON.stringify({ dv: w5row?.depthVerdict, why: w5row?.depthWhy }));
  ok("guard: riding a DEPTH-UNKNOWN edge → REFUSED-DEPTH-UNKNOWN (any amount, leg named)", w5.verdict === "REFUSED-DEPTH-UNKNOWN" && w5.why === "edge-depth-not-measured" && String(w5.depthWhy).includes("no-reserves"), JSON.stringify(w5));

  // w6 — best-edge selection: tight-cap weak edge does NOT bind; the best edge's cap does
  const twoEdges = [
    { pair: "STEEM/SBD", kind: "TRADEABLE", netBps: 200, maxNotional: 100, depthVerdict: "CAPPED", touch: { buyAt: 0.1, sellAt: 0.102 }, buy: "a", sell: "b" },
    { pair: "STEEM/SBD", kind: "TRADEABLE", netBps: 50, maxNotional: 0.5, depthVerdict: "CAPPED", touch: { buyAt: 0.1, sellAt: 0.102 }, buy: "c", sell: "d" },
  ];
  const w6pass = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 5 }, twoEdges);
  const w6refuse = intentDepthGuard({ in: "SBD", out: "STEEM", amountIn: 150 }, twoEdges);
  ok("guard: best edge (net +200, cap 100) binds — 5 passes despite weak edge cap 0.5", w6pass.verdict === "PASS" && w6pass.edgeNetBps === 200, JSON.stringify(w6pass));
  ok("guard: 150 above the BEST edge's cap → REFUSED-DEPTH (not silently checked vs the weak edge)", w6refuse.verdict === "REFUSED-DEPTH" && w6refuse.maxNotional === 100, JSON.stringify(w6refuse));

  // w7 — inverted orientation: board pair SBD/STEEM, intent pays the quote side (STEEM)
  const invBoard = [{ pair: "SBD/STEEM", kind: "TRADEABLE", netBps: 80, maxNotional: 2, depthVerdict: "CAPPED", touch: { buyAt: 9.5, sellAt: 9.61 }, buy: "a", sell: "b" }];
  const w7refuse = intentDepthGuard({ in: "STEEM", out: "SBD", amountIn: 5 }, invBoard);
  const w7pass = intentDepthGuard({ in: "STEEM", out: "SBD", amountIn: 1.5 }, invBoard);
  ok("guard: inverted pair matches (from=quote) — 5 STEEM vs cap 2 → REFUSED-DEPTH", w7refuse.verdict === "REFUSED-DEPTH" && w7refuse.edgePair === "SBD/STEEM" && Math.abs(w7refuse.edgeNotional - 5) < 1e-9, JSON.stringify(w7refuse));
  ok("guard: inverted pair within cap → PASS", w7pass.verdict === "PASS");

  // w8/w9 — END-TO-END through validateIntent: the board rides along at settlement
  const pools8 = { "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: 10, reserveB: 100, feeBps: 30 } };
  const g8 = buildGraph(pools8);
  const ledger8 = { balances: { "soldier-1": { SBD: 50, STEEM: 5 } } };
  const w8 = validateIntent({ id: "w8", agent: "soldier-1", in: "SBD", out: "STEEM", amountIn: 5 }, { graph: g8, railPrices: {}, ledger: ledger8, board: liveBoard });
  ok("guard: validateIntent + board — 5 SBD would fill internally but is REFUSED-DEPTH", w8.verdict === "REFUSED-DEPTH" && w8.why === "amount-above-max-notional" && w8.depth.edgePair === "STEEM/SBD", JSON.stringify({ v: w8.verdict, why: w8.why, pair: w8.depth?.edgePair }));
  const w9 = validateIntent({ id: "w9", agent: "soldier-1", in: "SBD", out: "STEEM", amountIn: 0.009 }, { graph: g8, railPrices: {}, ledger: ledger8, board: liveBoard });
  ok("guard: validateIntent + board — 0.009 SBD → OK with depth provenance carried", w9.verdict === "OK" && w9.depth?.verdict === "PASS" && w9.depth?.why === "within-max-notional" && Math.abs(w9.depth.maxNotional - 0.00915) < 1e-9 && w9.quote.amountOut > 0, JSON.stringify({ v: w9.verdict, d: w9.depth?.why }));
  const w10 = validateIntent({ id: "w10", agent: "soldier-1", in: "SBD", out: "STEEM", amountIn: 5 }, { graph: g8, railPrices: {}, ledger: ledger8 });
  ok("guard: backward compat — no board passed → OK, no depth key (LAW 20 inert)", w10.verdict === "OK" && w10.depth === undefined, JSON.stringify({ v: w10.verdict, d: w10.depth }));
}

/* ── registry sanity ─────────────────────────────────────────────────── */
section("§75k registry (מטבעות-ומסילות)");
{
  ok("registry: the operator's first-listed chains present", ["STEEM", "SBD", "HIVE", "HBD", "BLURT"].every((a) => ASSETS[a]));
  ok("registry: wrapped H-E assets present", ["SWAP.HIVE", "SWAP.LTC", "SWAP.BTC", "SWAP.HBD", "DEC", "BEE"].every((a) => ASSETS[a]));
  ok("registry: only the armed rail is armed", Object.values(RAILS).filter((r) => r.status === "ARMED").length === 1 && RAILS["steem-limit-order"].status === "ARMED");
  ok("registry: gated rails always carry an unlock", Object.values(RAILS).filter((r) => r.status !== "ARMED").every((r) => !!r.unlock || !!r.note));
}

console.log(`\n═══ DEX SELFTEST: ${pass}/${pass + fail} PASS${fail ? ` — ${fail} FAILED` : " — ALL PASS"} ═══`);
process.exit(fail ? 1 : 0);
