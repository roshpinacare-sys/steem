/**
 * soak.mjs — T-75b · THE INVARIANT SOAK (בולען-האינווריאנטות).
 * 30 deterministic stress-cycles of the full pure pipeline under adversarial
 * perturbations (inventory shrink, price swings, agent spam, oversized
 * intents). After EVERY cycle the laws must hold:
 *   I1 escrow: internal ≤ covered, zero violations
 *   I2 parity: pool mid tracks parity within the refuse band
 *   I3 grids: no naked-short asks, asks ≥ cost floor, bids ≤ quote budget
 *   I4 queue: caps + dedupe respected, bid never queued under PAUSE-FLOW
 *   I5 redemption: never pays beyond vault inventory
 *   I6 no phantom arb edges between coherent venues
 * Run: bun soak.mjs → prints the invariant ledger, exits 1 on any breach.
 */
import {
  escrowCheck, gridPlan, buildGraph, routeQuote, arbScan, venueMids,
  steemQueueOp, redemptionQuote, parityVerdict, validateIntent,
  settleIntentDeltas, batchClear, intakeDrill, r6, fnum,
} from "./lib.mjs";

/* deterministic PRNG (mulberry32) — no Math.random flakiness */
let seed = 0x757575;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const CYCLES = 30;
let breaches = 0, checks = 0;
const breach = (cycle, id, detail) => { breaches++; console.error(`  ✗ [c${cycle}] ${id} — ${detail}`); };
const passInvar = (cycle, id) => { checks++; if (cycle === CYCLES - 1 || checks % 10 === 0) console.log(`  ✓ c${cycle} ${id}`); };

/* evolving synthetic world (chain-truth stand-in): liquid inventory,
 * parity, avg cost, guard state, books */
const world = {
  steem: 14.9, sbd: 0.37, parity: 0.1054, avgCost: 0.1044,
  guard: "PAUSE-FLOW",
  book: { bestBid: 0.1044, bestAsk: 0.1044 },
  hiveMid: 20.5, heMid: 1206,
};

/* the network state under stress */
const ledger = { balances: { __vault__: { STEEM: 0, SBD: 0 } }, backing: {} };
const pool = { reserveA: 0, reserveB: 0 };
const agents = { "soldier-1": { STEEM: 0, SBD: 0, CREDIT: 0 } };

function syncWorld() {
  // parity-proportional deployment (the law from the live catch)
  const wantA = Math.min(world.steem * 0.25, (world.sbd * 0.25) / world.parity);
  pool.reserveA = r6(wantA);
  pool.reserveB = r6(wantA * world.parity);
  ledger.backing.STEEM = { internal: pool.reserveA, covered: r6(Math.max(0, world.steem - pool.reserveA)), backing: [{ source: "engine", amount: r6(world.steem) }] };
  ledger.backing.SBD = { internal: pool.reserveB, covered: r6(Math.max(0, world.sbd - pool.reserveB)), backing: [{ source: "engine", amount: r6(world.sbd) }] };
}

console.log(`■ SOAK: ${CYCLES} adversarial cycles, 7 invariants each`);
for (let c = 0; c < CYCLES; c++) {
  /* adversarial perturbations: the world MOVES against us */
  if (c % 5 === 3) world.steem = Math.max(1, r6(world.steem * (0.7 + rnd() * 0.2)));   // real fills shrink liquid
  if (c % 4 === 2) world.sbd = r6(world.sbd + (rnd() - 0.3) * 1.5);                     // SBD swings
  if (c % 3 === 1) world.parity = r6(0.1054 * (0.97 + rnd() * 0.06));                   // parity moves
  if (c === 10) world.guard = "OK";                                                     // guard lifts mid-soak
  if (c === 20) world.guard = "PAUSE-FLOW";                                             // and returns
  world.book.bestBid = r6(world.parity * 0.995);
  world.book.bestAsk = r6(world.parity * 1.005);
  syncWorld();

  /* I1 escrow after every sync — INCLUDING when agents hold floats */
  if (c % 7 === 3) agents["soldier-1"].STEEM = r6(Math.min(agents["soldier-1"].STEEM + 0.2, ledger.backing.STEEM.covered));
  const esc = escrowCheck({ ...ledger, balances: { __vault__: ledger.balances.__vault__, "soldier-1": agents["soldier-1"] } });
  checks++;
  if (!esc.ok) breach(c, "I1-escrow", JSON.stringify(esc.violations));
  else passInvar(c, "I1-escrow");

  /* I2 pool mid tracks parity within band */
  const mid = pool.reserveB / pool.reserveA;
  const band = parityVerdict({ mid, fair: world.parity, bandBps: 5000 });
  checks++;
  if (band.verdict === "REFUSE-BAND") breach(c, "I2-parity", `mid=${r6(mid)} fair=${world.parity} dev=${band.devBps}bps`);
  else passInvar(c, "I2-parity");

  /* I3 grid laws under the moving world */
  const g = gridPlan({ parity: world.parity, spreadBps: 70 + Math.round(rnd() * 200), baseBal: pool.reserveA, quoteBal: pool.reserveB, levels: 3, spacingBps: 150, avgCost: world.avgCost });
  checks++;
  const askSum = g.asks.reduce((a, x) => a + x.qty, 0);
  if (askSum > pool.reserveA + 1e-9 || !g.asks.every((x) => x.price >= world.avgCost)) breach(c, "I3-grids", `askSum=${r6(askSum)} pool=${r6(pool.reserveA)}`);
  else passInvar(c, "I3-grids");

  /* I4 queue laws: bids refused under PAUSE-FLOW, ask op always chain-shaped.
   * The ask is built LAWFUL by construction (above the T-64 cost floor) —
   * refusing a genuinely lawful ask is the breach; refusing a below-cost
   * ask is the law working. */
  const askPx = Math.max(world.parity * 1.015, world.avgCost * 1.002);
  const askQty = Math.min(0.1, pool.reserveA);
  const bidOp = steemQueueOp({ level: { side: "bid", price: world.parity * 0.985, qty: 0.1 }, dexBaseBal: pool.reserveA, avgCost: world.avgCost, guardAction: world.guard, seq: c, nowSec: 1_800_000_000 });
  const askOp = steemQueueOp({ level: { side: "ask", price: askPx, qty: askQty }, dexBaseBal: pool.reserveA, avgCost: world.avgCost, guardAction: world.guard, seq: c + 1000, nowSec: 1_800_000_000 });
  checks++;
  if (world.guard === "PAUSE-FLOW" && bidOp.op !== null) breach(c, "I4-queue", "bid queued under PAUSE-FLOW");
  else if (askOp.op === null && pool.reserveA > 0.05 && askQty > 0.001) breach(c, "I4-queue", "lawful ask refused");
  else passInvar(c, "I4-queue");

  /* I5 redemption never exceeds vault */
  const vaultS = ledger.balances.__vault__.STEEM;
  const rq = redemptionQuote({ credit: 100 + Math.round(rnd() * 500), asset: "STEEM", vaultBalance: vaultS, steemUsd: 0.10, agentBalance: agents["soldier-1"].CREDIT + 1000 });
  checks++;
  if (rq.verdict === "OK" && rq.out > vaultS + 1e-9) breach(c, "I5-redeem", `out=${rq.out} vault=${vaultS}`);
  else passInvar(c, "I5-redeem");
  /* fees flow into the vault (fills pay us) */
  if (c % 6 === 5) { ledger.balances.__vault__.STEEM = r6(vaultS + 0.15); agents["soldier-1"].CREDIT = r6(agents["soldier-1"].CREDIT + 30); }

  /* I6 no phantom edges between coherent venues */
  const mids = venueMids({ pools: { "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: pool.reserveA, reserveB: pool.reserveB } }, engineStatus: { market: { book: world.book }, hive: { plan: { mid: world.hiveMid } }, enginepond: { ponds: [{ symbol: "SWAP.LTC", touch: { bestBid: world.heMid * 0.99, bestAsk: world.heMid * 1.01 } }] }, observe: { parity: { steemUsd: world.parity * 0.95, sbdUsd: 0.95 } } } });
  const ops = arbScan({ venues: mids, feeBps: 30, minEdgeBps: 20 });
  checks++;
  if (ops.some((o) => Math.abs(o.edgeBps) > 5000)) breach(c, "I6-arb", `phantom edge ${JSON.stringify(ops[0]?.edgeBps)}`);
  else passInvar(c, "I6-arb");

  /* bonus: a full intent cycle must fail-closed cleanly against escrow */
  if (c % 10 === 4) {
    const graph = buildGraph({ "STEEM-SBD": { assets: ["STEEM", "SBD"], reserveA: pool.reserveA, reserveB: pool.reserveB } });
    const v = validateIntent({ id: `s${c}`, agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: Math.min(agents["soldier-1"].STEEM, 0.1) }, { graph, railPrices: {}, ledger: { balances: { "soldier-1": agents["soldier-1"] } } });
    checks++;
    if (v.verdict !== "OK" && v.verdict !== "REFUSED") breach(c, "I7-intent", `odd verdict ${v.verdict}`);
    else if (v.verdict === "OK") {
      const d = settleIntentDeltas({ agent: "soldier-1", in: "STEEM", out: "SBD", amountIn: Math.min(agents["soldier-1"].STEEM, 0.1) }, v.quote);
      agents["soldier-1"].STEEM = r6(agents["soldier-1"].STEEM + d.find((x) => x.holder === "soldier-1" && x.asset === "STEEM").delta);
      agents["soldier-1"].SBD = r6(agents["soldier-1"].SBD + d.find((x) => x.holder === "soldier-1" && x.asset === "SBD").delta);
      ledger.balances.__vault__.SBD = r6((ledger.balances.__vault__.SBD ?? 0) + (d.find((x) => x.holder === "__vault__" && x.asset === "STEEM")?.delta ?? 0));
      passInvar(c, "I7-intent-filled");
    } else passInvar(c, "I7-intent-refused");
  }

  /* I8 batch laws: uniform price + conservation + no negative balances
   * (adversarial orders: crossing, one-sided, band-breaking, underfunded) */
  if (c % 2 === 1) {
    const mk = (ag, bal2) => ({ STEEM: r6(bal2), SBD: r6(bal2 * 8) });
    const a1 = mk("a1", 0.5 + rnd()), a2 = mk("a2", 0.5 + rnd()), a3 = mk("a3", 0.5 + rnd());
    const balances = { a1, a2, a3, __vault__: ledger.balances.__vault__ };
    const spread = world.parity * (0.96 + rnd() * 0.08);
    const orders = [
      { id: "s1", agent: "a1", side: rnd() > 0.15 ? "sell" : "buy", limit: r6(world.parity * (0.98 + rnd() * 0.05)), qty: r6(0.05 + rnd() * 0.3) },
      { id: "s2", agent: "a2", side: rnd() > 0.2 ? "buy" : "sell", limit: r6(world.parity * (0.97 + rnd() * 0.06)), qty: r6(0.05 + rnd() * 0.3) },
      { id: "s3", agent: "a3", side: rnd() > 0.5 ? "buy" : "sell", limit: r6(spread), qty: r6(0.05 + rnd() * 0.4) },
    ];
    const br = batchClear({ batch: { id: `soak-${c}`, orders }, parity: world.parity, balances, base: "STEEM", quote: "SBD" });
    checks++;
    const sumA = (asset) => br.deltas.filter((d) => d.asset === asset).reduce((a, d) => a + d.delta, 0);
    if (br.verdict === "CLEARED") {
      const uniformOk = br.fills.every((f) => (f.side === "sell" ? f.limit <= br.clearingPrice + 1e-9 : f.limit >= br.clearingPrice - 1e-9));
      const conserveOk = Math.abs(sumA("STEEM")) < 1e-4 && Math.abs(sumA("SBD")) < 1e-4;
      // apply and check no negative balances (nobody pays what they lack)
      const sim = JSON.parse(JSON.stringify(balances));
      for (const d of br.deltas) { (sim[d.holder] ??= {})[d.asset] = r6((sim[d.holder][d.asset] ?? 0) + d.delta); }
      const negOk = Object.values(sim).every((b2) => Object.values(b2).every((v) => v >= -1e-6));
      if (!uniformOk) breach(c, "I8-batch-uniform", `p*=${br.clearingPrice} fills=${JSON.stringify(br.fills.map((f) => [f.side, f.limit]))}`);
      else if (!conserveOk) breach(c, "I8-batch-conserve", `ΣSTEEM=${sumA("STEEM")} ΣSBD=${sumA("SBD")}`);
      else if (!negOk) breach(c, "I8-batch-negative", "a balance went negative after deltas");
      else passInvar(c, "I8-batch-cleared");
    } else if (["NO-CROSS", "REFUSE-BAND", "EMPTY"].includes(br.verdict) && br.deltas.length === 0) {
      passInvar(c, `I8-batch-${br.verdict.toLowerCase()}`);
    } else breach(c, "I8-batch-verdict", `odd verdict ${br.verdict} with deltas ${br.deltas.length}`);
  }
  /* I9 intake-drill escrow under adversarial inbound (the money-event
   * law: whatever lands, the projected deployment stays parity-shaped,
   * never-shrink, and escrow-true — spikes included) */
  {
    const inSbd = rnd() < 0.25 ? r6(rnd() * 250) : r6(rnd() * 20);
    const inSteem = rnd() < 0.2 ? r6(rnd() * 60) : 0;
    const drill = intakeDrill({
      snapshot: { steem: world.steem, sbd: world.sbd, parity: world.parity, avgCost: world.avgCost, spreadBps: 150, guardAction: world.guard },
      inboundSbd: inSbd, inboundSteem: inSteem, nowSec: 1_800_000_000 + c,
    });
    checks++;
    if (drill.verdict !== "DRILL-OK") breach(c, "I9-drill", `verdict ${drill.verdict} in=${inSbd}/${inSteem}`);
    else if (Math.abs(drill.post.poolB - drill.post.poolA * world.parity) > 1e-6) breach(c, "I9-drill-parity", `A=${drill.post.poolA} B=${drill.post.poolB} P=${world.parity}`);
    else if (!drill.neverShrink || !drill.escrowProjected.ok) breach(c, "I9-drill-escrow", `shrink=${!drill.neverShrink} esc=${drill.escrowProjected.ok}`);
    else passInvar(c, "I9-drill");
  }
}

console.log(`\n═══ SOAK COMPLETE: ${checks} invariant checks, ${breaches} breaches ${breaches ? "— FAIL" : "— ALL LAWS HELD"} ═══`);
process.exit(breaches ? 1 : 0);
