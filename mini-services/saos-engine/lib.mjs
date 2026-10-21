/**
 * lib.mjs — the pure deterministic core of the LOCAL sovereign engine.
 * ====================================================================
 * T-9 (2026-09-29): the 16-repo estate was lost from local disk (environment
 * reset) and filebin is empty. Per operator law ("אפשר למצוא פתרון גם מהקיים")
 * the engine now lives INSIDE the cockpit project — zero dependency on
 * /home/z/audit, GitHub, or any external repo.
 *
 * Pure functions only here (no IO, no clock, no network) — injected
 * everything, so selftest vectors are deterministic offline.
 *
 * Doctrine carried over from the fleet rounds (worklog T-1..T-8):
 *   D-021 dual-mover lanes · D-022 per-side additive · D-023 convert-first
 *   r134-VF1 value-floor law (never sell below external value)
 *   A-10 honest P&L (sells without measured basis = unbased, never profit)
 *   price-truth-or-nothing (parity band 5000bps refuse)
 *
 * NEW adoptions (T-9, see docs/ADOPTIONS.md):
 *   Hummingbot inventory-skew   → ladder shape biased by inventory ratio
 *   MakerDAO PSM hysteresis     → convert gate enter/exit bands
 *   Curve dynamic concentration → dragK spread-responsive ladder tightening
 */

export const MIN_LEVEL = 0.5;          // SBD/STEEM dust-break per level (mission gate)
export const LEVELS = 5;               // per side (5 asks + 5 bids)
export const ASK_FLOOR_BPS = 20;       // r134-VF1: asks re-placed at floor+20bps
export const ASK_ANCHOR_BPS = 10;      // G41: value asks ≤ live book front + 10bps (fillable)
export const PARITY_BAND_BPS = 5000;   // price-truth-or-nothing refuse band
export const NOISE_BPS = 10;           // stale classification tolerance
export const DRAG_DIVISOR = 2000;      // dragK = clamp(1+spreadBps/2000, 1, 3)
export const CONVERT_MIN_SBD = 1;      // D-023 arm threshold (dust guard)
export const CONVERT_RESERVE_SBD = 0.5;// bid-reserve kept out of convert
export const CONVERT_PENDING_CAP = 10; // max SBD pending 3.5d window
export const BID_RESERVE_SBD = 0.5;    // SBD kept for bid side

const r6 = (v) => Math.round(v * 1e6) / 1e6;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── Curve-adoption: dynamic drag (T-3 B-3, carried) ───────────────────────
 * wider internal-vs-external spread ⇒ tighter multi-level concentration. */
export function dragK(spreadBps) {
  return clamp(1 + spreadBps / DRAG_DIVISOR, 1, 3);
}

/* ── Hummingbot-adoption: inventory skew ───────────────────────────────────
 * skew ∈ [-0.3, +0.3]; inventoryRich(steem) ⇒ bigger asks / smaller bids
 * so the book pushes inventory back toward target balance. Deterministic. */
export function inventorySkew(steemLiquid, sbdLiquid, parity) {
  if (!(parity > 0) || steemLiquid < 0 || sbdLiquid < 0) return { skew: 0, askMult: 1, bidMult: 1, reason: "invalid-inputs" };
  const target = (steemLiquid + sbdLiquid / parity) / 2; // 50/50 baseline in STEEM units
  if (target <= 1e-9) return { skew: 0, askMult: 1, bidMult: 1, reason: "no-inventory" };
  const raw = (steemLiquid - target) / target;           // relative excess STEEM
  const skew = r6(clamp(raw * 0.3, -0.3, 0.3));
  return { skew, askMult: r6(1 + skew), bidMult: r6(1 - skew), reason: "hummingbot-inventory-skew" };
}

/* ── parity gate (price-truth-or-nothing) ────────────────────────────────── */
export function parityVerdict(externalParity, internalFeed) {
  if (!(externalParity > 0)) return { ok: false, reason: "no-external-parity" };
  if (!(internalFeed > 0)) return { ok: false, reason: "no-internal-feed" };
  const bps = Math.round(((externalParity - internalFeed) / internalFeed) * 10000);
  if (Math.abs(bps) > PARITY_BAND_BPS) return { ok: false, reason: "parity-band-refuse", bps };
  return { ok: true, reason: "band-ok", bps };
}

/* ── peg ladder planner (B-1/B-3 + T-9 adoptions + T-19 dual-tranche) ───────
 * Law: every ask ≥ floor (parity*(1+ASK_FLOOR_BPS)), every bid ≤ ceiling
 * (parity−20bps); budgets assigned level-by-level clamped to remaining
 * (sum ≤ budget BY CONSTRUCTION — the T-5 rounding-blocker lesson).
 *
 * T-19 DUAL-TRANCHE (measured live 2026-09-30): the VF1 floor FLOATS with
 * its parity SOURCE — coingecko said 0.1083 while the live book traded at
 * 0.1042 (4% apart) and the witness feed said 0.1041; an hour earlier the
 * floor sat at 0.1043. A floor anchored to a GHOST external quote (SBD is
 * delisted from binance/poloniex/upbit/mexc — measured) made our asks
 * untradeable BY LAW: 43 fills in 7.35 days while 49 trades/day flowed
 * past us. The operator ordered real productivity (thousands of ops, real
 * flow capture). Fix WITHOUT touching the law's intent: the bulk (80%) keeps
 * the value floor; a bounded FLOW TRANCHE (20%) quotes AT the live book
 * front, never below the WITNESS FEED (the chain's own value anchor — the
 * only live SBD↔STEEM market that exists) and never above the bid ceiling.
 * Doctrine is operator-overridable via armed-conf as always. */
export function planLadder({
  parity, askBudgetSteem, bidBudgetSbd,
  spreadBps = 0, skew = { askMult: 1, bidMult: 1 },
  levels = LEVELS, minLevel = MIN_LEVEL, now = "1970-01-01T00:00:00Z",
  bestBid = null, bestAsk = null, feedAnchor = null,
  flowTranchePct = 0.2, flowSpacingBps = 15, flowLevels = 4,
  flowAskBudgetSteem = null, flowBidBudgetSbd = null,
  askParityBps = 0, // W27 tiered-fleet-book: THIS body's value-ask ladder starts askParityBps deeper (cap-clamped)
  bidCeilingBps = 0, // W27 tiered-fleet-book: THIS body's bid ladder sits bidCeilingBps BELOW the common ceiling (more conservative, always lawful)
}) {
  if (!(parity > 0)) return { verdict: "NO-PARITY", asks: [], bids: [], blocker: ["no-external-parity"] };
  const k = dragK(spreadBps);
  const step = 1 + 0.001 * k;                        // per-level spacing
  /* G41 · BOOK-ANCHOR LAW (measured live 2026-10-21, owner volume mandate trace
   * 1a15c3717053dcad): value asks anchored ONLY to parity parked ~2.8% above the
   * live front (bestAsk 0.1039 vs fleet asks 0.1068-0.1146) → zero ask fills
   * across the whole fleet while the bid side kept filling (master PnL: bought
   * 721.7 STEEM / sold 266.2 — a one-sided accumulator, not a grid). The value
   * ladder may NEVER quote an ask above the live book front + ASK_ANCHOR_BPS;
   * when no live book exists (bestAsk falsy/junk) the parity floor law alone
   * stands, exactly as before — zero behavior change without a live book. */
  const bookCap = Number(bestAsk) > 0 ? Number(bestAsk) * (1 + ASK_ANCHOR_BPS / 10000) : Infinity;
  /* W27-c TIERED FLEET BOOK (owner trace 1a15c67385c253b5 — "גוף אחד חכם עם הרבה
   * ידיים" · many hands, one body): the fleet is one market-maker wearing N
   * bodies. askParityBps shifts ONLY this body's value-ask FLOOR deeper into
   * the lawful band [floor…front+ASK_ANCHOR] so N bodies form a real ask WALL
   * instead of stacking on one price. The bookCap law above is UNTOUCHED (no
   * ask may ever sit above the live front + anchor) — in a book-depressed
   * market the cap binds and every tier clamps to the same lawful front (the
   * G41 fillability law wins by design); the bid-side tier below carries the
   * spread there. When askParityBps=0 the math is byte-identical to before. */
  const floorRaw = Math.min(parity * (1 + (ASK_FLOOR_BPS + Math.max(0, askParityBps)) / 10000), bookCap);
  /* W27-c bid-side tier: the body's bid ladder starts BELOW the common
   * ceiling — a lower bid is ALWAYS lawful (never pays one tick more than
   * the un-tiered law allows) and N bodies form a real descending bid WALL
   * instead of stacking on one price. askParityBps above does the mirrored
   * job for the ask ladder inside the G41 cap. Both defaults (0,0) are
   * byte-identical to the pre-W27 math. */
  const ceilRaw = parity * (1 - (ASK_FLOOR_BPS + Math.max(0, bidCeilingBps)) / 10000); // bids never above parity−20bps (tiered bodies sit lower)
  // T-9 fix (same family as the T-5 rounding blocker): 6dp rounding must
  // NEVER push an ask below floor or a bid above ceiling — round asks UP,
  // bids DOWN, and law-check with ε tolerance.
  const r6u = (v) => Math.ceil(v * 1e6) / 1e6;
  const r6d = (v) => Math.floor(v * 1e6) / 1e6;
  const floor = r6u(floorRaw);
  const ceil = r6d(ceilRaw);
  const block = [];

  /* flow tranche active only with a live book; the value tranche keeps the
   * remaining budget — every law below is self-checked with ε.
   * T-19 REQUOTE LAW (measured live 18:34): the 60% liquidity law correctly
   * zeroes NEW deployment when the book is fully spread — but the flow
   * tranche is a REQUOTE layer: it replaces its own previous levels (cancel
   * + re-create at the NEW front), so its budget is the fixed tranche the
   * operator's doctrine reserves (0.12×inventory), not the residual. When
   * an explicit flow budget arrives, the value budget is NOT shrunk. */
  const flowOk = Number(bestAsk) > 0 && Number(bestBid) > 0 && flowLevels > 0 && (flowTranchePct > 0 || flowAskBudgetSteem > 0 || flowBidBudgetSbd > 0);
  const flowHasOwnBudget = flowAskBudgetSteem != null || flowBidBudgetSbd != null;
  const valAskBudget = (flowOk && !flowHasOwnBudget) ? askBudgetSteem * (1 - flowTranchePct) : askBudgetSteem;
  const valBidBudget = (flowOk && !flowHasOwnBudget) ? bidBudgetSbd * (1 - flowTranchePct) : bidBudgetSbd;

  const asks = [];
  let remA = r6(valAskBudget);
  let lvlA = floor;
  for (let i = 0; i < levels; i++) {
    if (remA < minLevel) break;
    const want = r6(Math.max(minLevel, (valAskBudget / levels) * skew.askMult));
    const amt = r6(Math.min(remA, want));
    if (amt < minLevel) break;
    asks.push({ side: "ask", amountSteem: amt, unit: r6u(lvlA), at: now, tranche: "value" });
    remA = r6(remA - amt);
    lvlA = lvlA * step;
  }
  if (remA > 0 && asks.length === 0) block.push("ask-budget-below-min-level");

  const bids = [];
  let remB = r6(valBidBudget);
  let lvlB = ceil;
  for (let i = 0; i < levels; i++) {
    if (remB < minLevel) break;
    const want = r6(Math.max(minLevel, (valBidBudget / levels) * skew.bidMult));
    const amt = r6(Math.min(remB, want));
    if (amt < minLevel) break;
    bids.push({ side: "bid", amountSbd: amt, unit: r6d(lvlB), at: now, tranche: "value" });
    remB = r6(remB - amt);
    lvlB = lvlB / step;
  }
  if (remB > 0 && bids.length === 0) block.push("bid-budget-below-min-level");

  /* ── T-19 flow tranche: AT-the-front presence, chain-anchored honesty ── */
  const flowAsks = [], flowBids = [];
  let flow = null;
  if (flowOk) {
    const sp = Math.max(1, flowSpacingBps) / 10000;
    const faBudget = r6(Math.max(0, flowAskBudgetSteem != null ? Number(flowAskBudgetSteem) : askBudgetSteem - valAskBudget));
    const fbBudget = r6(Math.max(0, flowBidBudgetSbd != null ? Number(flowBidBudgetSbd) : bidBudgetSbd - valBidBudget));
    /* T-19 ACHIEVABLE-PRICE LAW (measured live on-chain): the chain keeps SBD
     * and STEEM amounts at 3dp — a plan unit of 0.104244 on 8.245 STEEM
     * broadcasts as 0.860/8.245 = real 0.1043065 (12bps AWAY from plan,
     * behind the level we meant to lead). Flow levels therefore carry their
     * EXACT broadcast amounts: sbdOut3 (3dp SBD out) is computed from the
     * 3dp sell amount, unit = sbdOut3/sellAmt3 — the execute step sends
     * sbdOut3 VERBATIM, so the book shows precisely what was planned.
     * Anchor/ceiling laws are enforced on the BROADCAST arithmetic: the
     * anchor-clamped level ceil3's its SBD out (≥ anchor guaranteed), bids
     * floor3 their STEEM out only above a ceil3'd ceiling guard. */
    const sellAmt3 = (amt) => Number(amt.toFixed(3));
    const floor3 = (v) => Math.floor(v * 1000) / 1000;
    const ceil3 = (v) => Math.ceil(v * 1000) / 1000;
    /* ask front: penetrate to bestAsk (or the chain anchor when the book
     * trades below it). CEIL3 law: the 3dp SBD out always rounds UP to the
     * target — the real price lands within ONE milli above bestAsk (never
     * behind it, never below the anchor, never crossing the best bid). */
    let fa = Math.max(Number(bestAsk), feedAnchor > 0 ? Number(feedAnchor) : 0);
    let faRem = faBudget;
    let lastFaUnit = 0;
    for (let i = 0; i < flowLevels * 3 && flowAsks.length < flowLevels; i++) {
      /* DEDUP LAW (measured by selftest): ceil3 can merge adjacent targets
       * into the SAME milli (3bps spacing vs 20bps granularity at 5 STEEM) —
       * duplicate-price levels waste an op; advance the target until the
       * achievable price actually moves. */
      if (faRem < minLevel) break;
      const amt = r6(Math.min(faRem, Math.max(minLevel, faBudget / flowLevels)));
      if (amt < minLevel) break;
      const sell = sellAmt3(amt);
      const sbdOut3 = Math.max(ceil3(sell * fa), feedAnchor > 0 ? ceil3(sell * Number(feedAnchor)) : 0);
      const unit = sbdOut3 > 0 ? sbdOut3 / sell : fa;
      if (unit <= lastFaUnit) { fa = fa * (1 + sp); continue; }
      flowAsks.push({ side: "ask", amountSteem: amt, unit: r6u(unit), sbdOut3, at: now, tranche: "flow" });
      lastFaUnit = unit;
      faRem = r6(faRem - amt);
      fa = fa * (1 + sp);
    }
    /* bid front: join the best bid, step DOWN (never pay above the ceiling);
     * STEEM out = floor3 at the target (the honest join), with a ceil3'd
     * ceiling guard so the broadcast price can never breach the ceiling */
    let fb = Math.min(Number(bestBid), ceil);
    let fbRem = fbBudget;
    let lastFbUnit = Infinity;
    for (let i = 0; i < flowLevels * 3 && flowBids.length < flowLevels; i++) {
      if (fbRem < minLevel) break;
      const amt = r6(Math.min(fbRem, Math.max(minLevel, fbBudget / flowLevels)));
      if (amt < minLevel) break;
      const sell = sellAmt3(amt);
      const steemOut3 = Math.max(floor3(sell / fb), ceil3(sell / ceil));
      const unit = steemOut3 > 0 ? sell / steemOut3 : fb;
      if (unit >= lastFbUnit) { fb = fb / (1 + sp); continue; }
      flowBids.push({ side: "bid", amountSbd: amt, unit: r6d(unit), steemOut3, at: now, tranche: "flow" });
      lastFbUnit = unit;
      fbRem = r6(fbRem - amt);
      fb = fb / (1 + sp);
    }
    /* flow laws: never below the chain anchor, never above the ceiling,
     * and the two flow sides must never cross each other */
    if (feedAnchor > 0) for (const a of flowAsks) if (a.unit < feedAnchor - 1e-9) block.push("FLOW-ask-below-feed-anchor");
    for (const b of flowBids) if (b.unit > ceil + 1e-9) block.push("FLOW-bid-above-ceiling");
    if (flowAsks.length && flowBids.length && flowAsks[0].unit <= flowBids[0].unit) block.push("FLOW-self-cross");
    flow = { bestAsk: r6(Number(bestAsk)), bestBid: r6(Number(bestBid)), spacingBps: Math.max(1, flowSpacingBps), levels: flowLevels, askBudgetSteem: faBudget, bidBudgetSbd: fbBudget, feedAnchor: feedAnchor > 0 ? r6(Number(feedAnchor)) : null, flowAsks: flowAsks.length, flowBids: flowBids.length };
  }

  // law self-check: never violate floor/ceiling regardless of inputs (ε=1e-9)
  for (const a of asks) if (a.unit < floor - 1e-9) block.push("VF1-ask-below-floor");
  for (const b of bids) if (b.unit > ceil + 1e-9) block.push("VF1-bid-above-ceiling");

  const verdict = asks.length + bids.length + flowAsks.length + flowBids.length === 0
    ? "OFFER-EMPTY"
    : block.length ? "OFFER-BLOCKED" : "OFFER-READY";
  return { verdict, asks, bids, flowAsks, flowBids, flow, blocker: block.length ? block : null, dragK: k, floor, ceiling: ceil };
}

/* ── D-023 convert planner — R245-b REPAIR (measured, get_feed_history + internal book)
 * OLD (WRONG): "converting 1 SBD yields face-$1 of STEEM" — that is HIVE's HBD
 * stabilization model, mis-ported to SBD. Steem SBD conversion pays at the
 * WITNESS FEED RATE: 1 SBD → 1/feed STEEM after the 3.5d window (measured:
 * current_median 58,296,320.145 SBD / 560,026,239.516 STEEM = 0.104096 SBD/STEEM
 * ⇒ 9.6064 STEEM per SBD ≈ $0.564 at market — NOT $1). True realized edge =
 * marketSbdPerSteem/feedSbdPerSteem − 1. When the feed equals the market
 * parity the convert is edge-neutral ⇒ HOLD is the honest verdict.
 * Enter when the feed is ≥ enterBps BELOW the market parity (prints more STEEM
 * than market parity); stay armed (hysteresis) until edge < exitBps. */
export function planConvert({
  liquidSbd, feedSbdPerSteem, marketSbdPerSteem = null,
  enterBps = 150, exitBps = 100, previouslyArmed = false,
  pendingSbd = 0, minSbd = CONVERT_MIN_SBD,
  reserveSbd = CONVERT_RESERVE_SBD, pendingCap = CONVERT_PENDING_CAP,
}) {
  if (!(feedSbdPerSteem > 0)) return { verdict: "CONVERT-HOLD", reason: "no-feed-price", amountSbd: 0 };
  if (!(marketSbdPerSteem > 0)) return { verdict: "CONVERT-HOLD", reason: "no-market-parity", amountSbd: 0 };
  const edgeBps = Math.round(((marketSbdPerSteem / feedSbdPerSteem) - 1) * 10000);
  const armed = previouslyArmed ? edgeBps >= exitBps : edgeBps >= enterBps;
  if (!armed) return { verdict: "CONVERT-HOLD", reason: previouslyArmed ? "hysteresis-exit" : "below-enter-band", edgeBps, amountSbd: 0 };
  const budget = r6(Math.min(
    Math.max(0, liquidSbd - reserveSbd),
    Math.max(0, pendingCap - pendingSbd)
  ));
  if (budget < minSbd) return { verdict: "CONVERT-HOLD", reason: "dust-or-capped", edgeBps, amountSbd: 0 };
  const expectedSteem = r6(budget * 1 / feedSbdPerSteem); // feed-rate payout (measured: get_feed_history)
  return { verdict: "CONVERT-PLAN", reason: "feed-vs-parity-armed", edgeBps, amountSbd: budget, expectedSteem, windowDays: 3.5 };
}

/* ── T-91 redeployment doctrine (round-3 operator order, 2026-10-06) ───────
 * THE LAW: cashing out NEVER stops the autonomy. Realized value flows back
 * into the machine by FIXED RATIOS — buy-book (bid-rail fuel), power-up
 * (STEEM→SP: SP grows RC, RC grows ops/day — the X-2 ladder made physical),
 * reserve (never deployed). The floors ARE the reserve made executable:
 * at-or-below them the machine holds, always protecting operations.
 * Ratio mapping (honest): the buy-book share is ALREADY executable — the peg
 * step's BID rail spends SBD into STEEM under the 60% deploy law; the
 * power-up share vests the EXCESS STEEM above the liquid floor (which
 * includes what the bids acquire). No op is invented for the reserve —
 * its absence of action is the action.
 * R233 adversarial-review hardening (measured, battery-driven):
 * (a) ratio-sum validity is a ±0.001 BAND around 1 (float-safe), stated here
 *     so the law text and the code can never diverge again;
 * (b) every numeric input is STRICTLY normalized — only finite JS numbers
 *     pass; strings/NaN/Infinity/Symbols fail CLOSED (→ HOLD/BLOCKED/0),
 *     never crash, never leak NaN into plans;
 * (c) PLAN is only issued for an amount the machine would actually broadcast
 *     (>= max(minPowerUpSteem, 0.001)) — a PLAN with amount 0 was a lie the
 *     battery caught;
 * (d) liquidBasis is stamped on every plan: the liquid input is FREE BALANCE
 *     (open-order locks excluded) and jitters by ±open-asks between reads —
 *     the execute step re-reads the chain, which is the binding clamp. */
const numStrict = (x, d = 0, max = 1e12) => (typeof x === "number" && isFinite(x) && x >= -max && x <= max ? x : d); /* max: chain decimals are ≤3dp on supplies < 1e9 — anything beyond is hostile and overflows the 3dp pipeline (battery-caught: 1e308 → Infinity PLAN) */
export function planRedeploy({
  now = new Date().toISOString(),
  liquidSteem = 0, liquidSbd = 0,
  buyBookPct = 0.5, powerUpPct = 0.3, reservePct = 0.2,
  liquidSteemFloor = 5, liquidSbdFloor = 0.5,
  minPowerUpSteem = 5,
} = {}) {
  /* strict normalization FIRST (R233): hostile config inputs fail closed */
  buyBookPct = numStrict(buyBookPct); powerUpPct = numStrict(powerUpPct); reservePct = numStrict(reservePct);
  liquidSteem = numStrict(liquidSteem); liquidSbd = numStrict(liquidSbd);
  liquidSteemFloor = numStrict(liquidSteemFloor); liquidSbdFloor = numStrict(liquidSbdFloor);
  minPowerUpSteem = numStrict(minPowerUpSteem);
  const sum = buyBookPct + powerUpPct + reservePct;
  const ratiosValid = sum > 0.999 && sum < 1.001
    && buyBookPct >= 0 && powerUpPct >= 0 && reservePct >= 0;
  if (!ratiosValid) {
    return { verdict: "REDEPLOY-BLOCKED", reason: "ratios-invalid", ratios: { buyBookPct, powerUpPct, reservePct }, at: now };
  }
  const excessSteem = r6(Math.max(0, liquidSteem - liquidSteemFloor));
  /* chain asset precision = 3dp; +1e-9 absorbs the float dust of x*0.3 */
  const powerUpSteem = r6(Math.floor((excessSteem * powerUpPct + 1e-9) * 1000) / 1000);
  /* PLAN must mean a broadcastable amount (R233: 0 >= min==0 was a lying PLAN) */
  const planThreshold = Math.max(minPowerUpSteem, 0.001);
  const verdict = powerUpSteem >= planThreshold ? "REDEPLOY-PLAN" : "REDEPLOY-HOLD";
  return {
    verdict,
    reason: verdict === "REDEPLOY-PLAN" ? "doctrine-ratios"
      : (excessSteem <= 0 ? "at-or-below-floor" : "below-min-powerup"),
    ratios: { buyBookPct, powerUpPct, reservePct },
    floors: { liquidSteemFloor, liquidSbdFloor },
    liquidSteem: r6(liquidSteem), liquidSbd: r6(liquidSbd),
    excessSteem, powerUpSteem, minPowerUpSteem,
    liquidBasis: "free-balance — open-order locks excluded; jitters by ±open-asks between reads, execute re-reads the chain (binding clamp)",
    buyBookNote: "the BID rail is the buy-book share made real — capped by buyBookPct of SBD above the floor (R231: enforced, not documented), under peg's 60% deploy law",
    reserveNote: "the floors ARE the reserve — never deployed, always protecting ops",
    law: "מימוש אף-פעם לא עוצר את האוטונומיה — הערך שממומש זורם חזרה למכונה לפי היחסים, מעל רצפות-ההפעלה בלבד",
    at: now,
  };
}

/* ── T-91 buy-book enforcement (R231 review): the doctrine's buyBookPct is
 * LAW, not documentation — the peg step's bid budget may never exceed this
 * share of SBD above the reserve floor. Pure helper so the cap is testable. */
export function redeployBidCapSbd(sbdLiquid = 0, floorSbd = 0.5, buyBookPct = 0.5) {
  /* R233 hardening: strict finite-number gate on ALL three inputs — the old
   * guard checked only pct/floor, so NaN/Infinity/{}/Symbol in sbdLiquid
   * leaked NaN/Infinity caps downstream (battery-caught, fail closed now) */
  if (!(typeof sbdLiquid === "number" && isFinite(sbdLiquid) && sbdLiquid >= 0 && sbdLiquid <= 1e12)) return 0;
  if (!(typeof floorSbd === "number" && isFinite(floorSbd) && floorSbd >= 0 && floorSbd <= 1e12)) return 0;
  if (!(typeof buyBookPct === "number" && isFinite(buyBookPct) && buyBookPct >= 0 && buyBookPct <= 1e12)) return 0;
  return r6(Math.max(0, sbdLiquid - floorSbd) * buyBookPct);
}

/* ── T-91 pacing law as a PURE function (R233: extracted from daily.mjs so
 * the rate-limit is unit-testable — the battery proved corruption classes
 * (NaN/negative/future timestamps) behaved by accident, not by design).
 * Semantics preserved: exactly-at-interval is allowed, exactly-at-day-cap
 * is blocked, interval checked before day-cap; a corrupted sinceLastSec
 * (NaN/negative/future) is treated as absent — the day-cap still guards. */
export function redeployPacing({ verdict, sinceLastSec, powerUpsToday = 0, minIntervalSec = 3600, maxPerDay = 12 }) {
  if (verdict !== "REDEPLOY-PLAN") return { verdict: null, sinceLastSec: numStrict(sinceLastSec, null) ?? null };
  const since = typeof sinceLastSec === "number" && isFinite(sinceLastSec) && sinceLastSec > 0 ? sinceLastSec : null;
  if (since != null && since < minIntervalSec) {
    return { verdict: "interval", reason: `powerup-pacing (${since}s < ${minIntervalSec}s since last)`, sinceLastSec: since };
  }
  if (powerUpsToday >= maxPerDay) {
    return { verdict: "day-cap", reason: `powerup-day-cap (${powerUpsToday} >= ${maxPerDay} today)`, sinceLastSec: since };
  }
  return { verdict: null, sinceLastSec: since };
}

/* ── R235: pacing state = CACHE; the append-only events journal = TRUTH ────
 * A torn redeploy-state.json (pre-atomic-write era, disk-full, SIGKILL mid-
 * write) silently RESET the pacing law: readJson → default → lastPowerUpAt
 * null → interval check skipped → immediate re-power-up. Now the state is
 * REBUILT from the journal: count today's powerup-op events + newest at.
 * Pure + testable; junk lines/objects are skipped, order-independent. */
export function rebuildPacingFromEvents(events, today) {
  if (!Array.isArray(events)) return { day: today, powerUpsToday: 0, lastPowerUpAt: null, rebuilt: "fail-closed" };
  let count = 0, lastAt = null;
  for (const e of events) {
    if (!e || typeof e !== "object" || e.type !== "redeploy.powerup-op") continue;
    const at = typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? e.at : null;
    if (!at || at.slice(0, 10) !== today) continue;
    count += 1;
    if (lastAt === null || at > lastAt) lastAt = at;
  }
  return { day: today, powerUpsToday: count, lastPowerUpAt: lastAt, rebuilt: "journal" };
}

/* ── stale classification (T-8b, lane-scoped per D-021) ────────────────────
 * An open order is stale when its unit drifted beyond NOISE_BPS from the
 * lawful bound for its side (asks below floor / bids above ceiling). */
export function classifyStale(orders, parity) {
  if (!(parity > 0)) return { stale: [], healthy: [], reason: "no-parity" };
  const floor = parity * (1 + ASK_FLOOR_BPS / 10000);
  const ceil = parity * (1 - ASK_FLOOR_BPS / 10000);
  const tol = NOISE_BPS / 10000;
  const stale = [], healthy = [];
  for (const o of orders) {
    const bad = o.side === "ask" ? o.unit < floor * (1 - tol) : o.unit > ceil * (1 + tol);
    (bad ? stale : healthy).push(o);
  }
  return { stale, healthy, floor: r6(floor), ceiling: r6(ceil) };
}

/* ── A-10 honest P&L (avg-cost on real fills; unbased ≠ profit) ────────────
 * Ported semantically from the cockpit route — the single truth. */
export function pnlFromFills(fills) {
  let position = 0, cost = 0, realized = 0, unbased = 0, unbasedSbd = 0;
  let bought = 0, spent = 0, sold = 0, proceeds = 0, buys = 0, sells = 0;
  for (const f of fills) {
    if (f.side === "bid") {
      buys++; bought = r6(bought + f.steem); spent = r6(spent + f.sbd);
      position = r6(position + f.steem); cost = r6(cost + f.sbd);
    } else {
      sells++; sold = r6(sold + f.steem); proceeds = r6(proceeds + f.sbd);
      if (position > 1e-9) {
        const based = Math.min(f.steem, position);
        const avg = cost / position;
        realized = r6(realized + f.sbd * (based / f.steem) - avg * based);
        const rest = r6(f.steem - based);
        cost = r6(cost - avg * based); position = r6(position - based);
        if (rest > 1e-9) { unbased = r6(unbased + rest); unbasedSbd = r6(unbasedSbd + f.sbd * (rest / f.steem)); }
      } else {
        unbased = r6(unbased + f.steem); unbasedSbd = r6(unbasedSbd + f.sbd);
      }
    }
  }
  return {
    fills: fills.length, buys, sells,
    boughtSteem: bought, spentSbd: spent, soldSteem: sold, proceedsSbd: proceeds,
    realizedSbd: realized,
    unbasedSteem: unbased, unbasedSbd: unbasedSbd,
    positionSteem: position, positionCostSbd: cost,
    positionAvgCost: position > 1e-9 ? Math.round((cost / position) * 1e6) / 1e6 : null,
  };
}

/* ── trigger-DAG loop guards (T-2d doctrine) ─────────────────────────────── */
export function guardDepth(depth, fires) {
  const MAX_DEPTH = 8, MAX_FIRES = 64;
  if (depth > MAX_DEPTH) return { ok: false, reason: "depth-cap" };
  if (fires > MAX_FIRES) return { ok: false, reason: "fires-cap" };
  return { ok: true, reason: "within-guards" };
}

/* ── T-16 · cycle truth taxonomy ────────────────────────────────────────────
 * The measured rot (2026-09-30): 11/35 cycles counted as "fail" while EVERY
 * real step was green — the only failures were steps lawfully blocked on the
 * missing credential. One number that conflates "machine sick" with "machine
 * lawfully waiting for its operator" is a LIE by composition. Three classes:
 *   ok      — every step succeeded
 *   blocked — the ONLY failures are typed CREDENTIAL-MISSING (lawful gate)
 *   fail    — any other failure (real malfunction)
 */
export const CRED_BLOCKED_RE = /CREDENTIAL-MISSING/i;

/** steps map (stepWrap outputs) → "ok" | "blocked" | "fail" */
export function cycleHealth(steps) {
  const list = Object.values(steps ?? {}).filter((s) => s && typeof s === "object");
  const failed = list.filter((s) => s.ok === false);
  if (failed.length === 0) return "ok";
  const nonCred = failed.filter((s) => !CRED_BLOCKED_RE.test(String(s.error ?? "")));
  return nonCred.length === 0 ? "blocked" : "fail";
}

/** the failed-step names + the cred-blocked subset (for the report + events) */
export function cycleFailureBreakdown(steps) {
  const failedSteps = [];
  const blockedSteps = [];
  for (const [name, s] of Object.entries(steps ?? {})) {
    if (s && typeof s === "object" && s.ok === false) {
      failedSteps.push(name);
      if (CRED_BLOCKED_RE.test(String(s.error ?? ""))) blockedSteps.push(name);
    }
  }
  return { failedSteps, blockedSteps };
}

/* ── T-16 · VP-spoilage meter (the visible price of a blocked signing rail) ─
 * While the credential is missing, VP regenerates to the 100% cap and every
 * drop above it is burned: the fleet's vote quota (maxPerDay) goes unspent.
 * This makes the blocked cost MEASURED-visible (days/votes) + ESTIMATED ($
 * from discovery's public reward-fund math — never claimed as measured). */
export function vpSpoilage({ firstDownAt, now, maxPerDay, estSteemPerDay }) {
  const nowMs = Date.parse(now ?? new Date().toISOString());
  const downMs = firstDownAt ? Date.parse(firstDownAt) : NaN;
  if (!Number.isFinite(nowMs) || !Number.isFinite(downMs) || nowMs <= downMs) {
    return { daysBlocked: 0, votesForegone: 0, estSteemForegone: 0, class: "measured" };
  }
  const daysBlocked = Math.max(0, (nowMs - downMs) / 86_400_000);
  const votesForegone = Math.max(0, Math.floor(daysBlocked * Math.max(0, maxPerDay ?? 0)));
  const estSteemForegone = estSteemPerDay != null && estSteemPerDay > 0
    ? Math.round(daysBlocked * estSteemPerDay * 100) / 100
    : 0;
  return {
    daysBlocked: Math.round(daysBlocked * 100) / 100,
    votesForegone,
    estSteemForegone,
    class: estSteemForegone > 0 ? "estimated" : "measured",
  };
}

/* ── T-16 · credential paste-revival (pure validation half) ─────────────────
 * The file-drop revival waited on an operator action that never came. The
 * cockpit gains a paste field → engine adopts (0600) + verifies against the
 * chain's own authorities. Pure half below; the IO half lives in signer.mjs.
 * Format: "<account> <master-password|P-key...>" — ≥2 fields, sane size.
 * NEVER logs/returns the secret — only its fingerprint. */
export function validateCredentialText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (raw.length > 4096) return { ok: false, reason: "oversize" };
  const fields = raw.split(/[\s:=]+/).filter(Boolean);
  if (fields.length < 2) return { ok: false, reason: "credential-format" };
  const account = fields[0];
  if (!/^[a-z0-9\-.]{3,16}$/i.test(account)) return { ok: false, reason: "bad-account" };
  // the secret NEVER leaves this function's caller in the return value —
  // adoptCredentialText re-derives it from the same normalized split
  return { ok: true, account };
}

/* ── T-17 · signing-era throughput & concurrency truth ──────────────────────
 * Measured 2026-09-30 (first credential-revived cycle): a real multi-vote
 * curate ran minutes per vote (dead-first-node broadcasts ×15s + per-vote
 * RC/DGPO re-reads) while the sovereign's HTTP wait died at exactly 90s —
 * two real cycles counted "fail" while their votes were landing on-chain,
 * and the busy-flag release let a second cycle overlap the first (a real
 * double-vote window). Fixes: sticky node order, per-vote guard hoisting,
 * per-vote incremental state writes, cycle-run marker + start-ack polling.
 * All pure halves live here; IO halves live in signer/curator/daily/sovereign. */

/* sticky RPC node order: last-good node first. Measured: a dead first node
 * burned up to 15s of EVERY broadcast (~60s/vote, ~18min/curate run). Pure. */
export function stickyNodeOrder(lastGood, nodes) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  if (!lastGood || !list.includes(lastGood)) return [...list];
  return [lastGood, ...list.filter((n) => n !== lastGood)];
}

/* incremental curator state merge — called after EACH landed vote.
 * Crash-safe: votesToday can never be lost mid-run again (the pre-T-17 write
 * only happened after the WHOLE loop — a killed mid-loop run lost every vote
 * it had cast, reopening dedup windows and day-cap drift). Pure.
 * verdict labels the HOW for history honesty: "VOTED" (our broadcast) vs
 * "ALREADY-VOTED" (the second signer covered it — counted for the account's
 * VP budget, journaled as what it truly was). */
export function mergeVoteState(prev, day, vote, verdict = "VOTED") {
  const sameDay = prev && prev.day === day;
  const base = sameDay
    ? prev
    : { votesToday: [], authorsToday: {}, totalVotes: prev?.totalVotes ?? 0, history: prev?.history ?? [] };
  return {
    day,
    votesToday: [
      ...base.votesToday,
      { author: vote.author, permlink: vote.permlink, weight: vote.weight, at: vote.at, txid: vote.txid ?? null },
    ],
    authorsToday: { ...base.authorsToday, [vote.author]: (base.authorsToday?.[vote.author] ?? 0) + 1 },
    totalVotes: (base.totalVotes ?? 0) + 1,
    history: [...(base.history ?? []), { at: vote.at, day, verdict, n: 1, txid: vote.txid ?? null }].slice(-30),
  };
}

/* ── T-18 CHAIN-TRUTH DAY BUDGET (the split-brain killer, measured live
 * 2026-09-30): the state file counted 18/18 while the CHAIN held 22 day votes
 * (13 engine + 9 second-signer: 6×2% + 3×20% at 14:51 that no seed window
 * ever saw) — a state-file-only cap gate UNDERCOUNTS the account's real VP
 * budget by every signer it never saw. The cap is a LAW; laws get enforced
 * on chain truth, not on a file that only knows what this process wrote.
 * Counts vote ops cast BY `voter` ON `day` from condenser account-history
 * rows ([[idx, {op:[type,value], timestamp}], …]). Pure. */
export function countDayVotesFromHistory(rows, voter, day) {
  if (!Array.isArray(rows)) return null;
  const d = String(day ?? "").slice(0, 10);
  if (!voter || d.length !== 10) return null;
  let n = 0;
  for (const row of rows) {
    const e = Array.isArray(row) ? row[1] : row;
    if (!e || typeof e !== "object") continue;
    const ts = typeof e.timestamp === "string" ? e.timestamp : null;
    if (!ts || !ts.startsWith(d)) continue;
    const op = Array.isArray(e.op) ? e.op : null;
    const type = op ? op[0] : e.type;
    const val = op ? op[1] : e.value;
    if (type !== "vote" || !val || typeof val !== "object") continue;
    if (val.voter === voter) n++;
  }
  return n;
}

/* T-553 RESTORED: countPostsFromHistory vanished from lib.mjs during the
 * 016a7311c alive-wins soft-union (GEN-3 re-seal) while income.mjs AND
 * publish.mjs kept importing it — every runIncome call would throw
 * "Export named 'countPostsFromHistory' not found", and with ZERO callers
 * nobody noticed for 18 days (income.json frozen at 2026-10-02). Rebuilt
 * from the T-29 contract ("account-level publish truth: non-reply comment
 * ops") and the row idiom of the sibling count* functions. */
export function countPostsFromHistory(rows, day) {
  if (!Array.isArray(rows)) return null;
  const d = String(day ?? "").slice(0, 10);
  if (d.length !== 10) return null;
  let n = 0;
  for (const row of rows) {
    const e = Array.isArray(row) ? row[1] : row;
    if (!e || typeof e !== "object") continue;
    const ts = typeof e.timestamp === "string" ? e.timestamp : null;
    if (!ts || !ts.startsWith(d)) continue;
    const op = Array.isArray(e.op) ? e.op : null;
    const type = op ? op[0] : e.type;
    const val = op ? op[1] : e.value;
    if (type !== "comment" || !val || typeof val !== "object") continue;
    if (!val.parent_author) n++; /* root post — replies carry a parent author */
  }
  return n;
}

/* T-553 RESTORED: incomeRollup — vanished from lib.mjs in the same
 * alive-wins soft-union as countPostsFromHistory. Rebuilt from its single
 * call site (income.mjs runIncome) and the 2026-10-02 income.json instance
 * it last produced. Laws carried verbatim from the T-29 contract:
 *  · income classes NEVER merge: claims measured / trading realized /
 *    pending-author FACE value / estimates — every number wears its class
 *  · usdPerDay is computed only over FULL days of all sources (T-25
 *    full-day law) — a partial window is never divided, it returns null
 *  · zero is zero — a measured 0 is MEASURED, not waiting */
export function incomeRollup({
  claims = null, trading = null, pendingAuthorSbd = null,
  unclaimed = null, steemUsd = null, sbdUsd = null, vestsPerSteem = null,
} = {}) {
  const r6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);
  const usdFromVests = (vests) =>
    vestsPerSteem && vestsPerSteem > 0 && steemUsd != null ? (vests / vestsPerSteem) * steemUsd : null;

  /* claims class — measured from chain reward-claim ops */
  const cl = claims ?? { steem: 0, sbd: 0, vests: 0, windowDays: null };
  const clSteem = Number(cl.steem) || 0;
  const clSbd = Number(cl.sbd) || 0;
  const clVests = Number(cl.vests) || 0;
  const claimsUsdParts = [clSteem * (steemUsd ?? 0), clSbd * (sbdUsd ?? 0), usdFromVests(clVests)];
  const claimsUsd = claimsUsdParts.every((p) => p != null) ? r6(claimsUsdParts.reduce((a, b) => a + b, 0)) : (clSteem + clSbd + clVests === 0 ? 0 : null);
  const claimsHasActivity = clSteem + clSbd + clVests > 0;
  const claimsWindow = claimsHasActivity ? (cl.windowDays ?? null) : 7; /* zero claims → the 7d scan window is trivially full */

  /* trading class — realized only (proceeds stay in the observe step) */
  const tr = trading ?? { realizedSbd: 0, proceedsSbd: 0, windowDays: null };
  const realizedSbd = Number(tr.realizedSbd) || 0;
  const proceedsSbd = Number(tr.proceedsSbd) || 0;
  const tradingUsd = sbdUsd != null ? r6(realizedSbd * sbdUsd) : (realizedSbd === 0 ? 0 : null);
  const tradingHasActivity = realizedSbd !== 0 || proceedsSbd !== 0;
  const tradingWindow = tradingHasActivity ? (tr.windowDays ?? null) : 7;

  /* pending-author class — FACE value until cashout, never counted as realized */
  const paSbd = pendingAuthorSbd != null ? Number(pendingAuthorSbd) : null;
  const paUsdFace = paSbd != null && sbdUsd != null ? r6(paSbd * sbdUsd) : null;

  /* the full-day law: every ACTIVE source must carry a full day window */
  const windows = [claimsWindow, tradingWindow].filter((w) => w != null);
  const windowDaysFull = windows.length ? Math.min(...windows) : null;
  const totalRealizedUsd = claimsUsd != null && tradingUsd != null ? r6(claimsUsd + tradingUsd) : null;
  const usdPerDay7d = windowDaysFull != null && windowDaysFull >= 1 && totalRealizedUsd != null ? r6(totalRealizedUsd / windowDaysFull) : null;

  return {
    usdPerDay7d,
    windowDaysFull: windowDaysFull != null ? Math.round(windowDaysFull * 100) / 100 : null,
    claims: { steem: clSteem, sbd: clSbd, vests: clVests, windowDays: cl.windowDays ?? null, usd: claimsUsd },
    trading: { realizedSbd, proceedsSbd, windowDays: tr.windowDays ?? null, usd: tradingUsd },
    pendingAuthor: { sbd: paSbd, usdFace: paUsdFace, note: "face-value עד ה-cashout — לא מזומן" },
    unclaimed: unclaimed ?? { vests: 0, sbd: 0, steem: 0 },
    totalRealizedUsd,
  };
}

/* cycle-run marker classification — the sovereign polls the ENGINE's own
 * marker instead of holding an HTTP wait that any slow-but-healthy cycle
 * outlives. Pure. */
export function classifyMarker(marker) {
  if (!marker || typeof marker !== "object") return { state: "absent", health: "fail" };
  if (marker.running === true) return { state: "running", health: null };
  const h = marker.health;
  if (h === "ok" || h === "blocked" || h === "fail") return { state: "done", health: h };
  return { state: "done", health: "fail" };
}

/* ════════════════════════════════════════════════════════════════════════
 * T-19b · HYPER-GRID — the volume layer (operator order: thousands of
 * transactions per day, think 100,000×, prove production).
 * ════════════════════════════════════════════════════════════════════════
 * THE MEASURED ECONOMICS (rc-probe.mjs, live chain 2026-09-30 ~19:06 UTC):
 *   limit_order_create ≈ 42,235,658 RC/op · limit_order_cancel ≈ 34,292,271
 *   RC/op (4-op txs, manabar delta with exact regen correction — the probe
 *   txs were assert-rejected for dust-balance and STILL metered: the chain
 *   charges RC for processing, the measurement is real either way).
 *   max_rc(headcorner) = 6,138,717,856,759 → regen = 20%/day = 1,227,743,571,351
 *   ⇒ EQUILIBRIUM ≈ 29k creates/day ≈ 32k mixed ops/day at the CURRENT 4034 SP.
 * The old 1500/day cap held the machine at ~5% of its measured lung capacity.
 */

/** measured chain prices (rc-probe.mjs — re-measurable any time, live rail) */
export const RC_COSTS = { create: 42_235_658, cancel: 34_292_271 };

/** RC economics of the account: what the tank regenerates per day, and the
 * sustainable op rate at equilibrium (burn/day = regen/day). Pure. */
export function rcEconomics({ maxRc, createCost = RC_COSTS.create, cancelCost = RC_COSTS.cancel }) {
  if (!(maxRc > 0)) return { regenPerDay: 0, pairCost: null, pairsPerDay: 0, opsPerDay: 0, reason: "no-max-rc" };
  if (!(createCost > 0) || !(cancelCost > 0)) return { regenPerDay: Math.floor(maxRc * 0.2), pairCost: null, pairsPerDay: 0, opsPerDay: 0, reason: "no-costs" };
  const regenPerDay = Math.floor(maxRc * 0.2);
  const pairCost = createCost + cancelCost;       // one requote pair (cancel+create)
  const pairsPerDay = Math.floor(regenPerDay / pairCost);
  return { regenPerDay, pairCost, pairsPerDay, opsPerDay: pairsPerDay * 2, reason: "measured-equilibrium" };
}

/** the equilibrium governor: how many requote PAIRS this tick may burn.
 * Law: burn/day ≤ regen/day × headroom, headroom = (rc% − floor)/(setpoint − floor)
 * clamped [0, burst]; at rc≤floor → 0 (the votes' RC is never starved); no RC
 * evidence → 0 (no evidence, no burn — T-18 lineage). Doctrine cap binds the
 * remainder too. FRACTION-CARRY LAW (the starvation bug, found by math before
 * it killed the layer): at equilibrium the per-tick budget is 0.55 pairs —
 * integer floor would burn ZERO forever exactly at the setpoint. The caller
 * passes back the returned carry; pairs = floor(raw + carry). Pure. */
export function rcGovernor({ rcPct, floorPct = 25, setpointPct = 50, burst = 3, tickMs = 3000, maxRc, createCost, cancelCost, maxOpsPerTick = 24, opsDayCap = 32000, opsToday = 0, carry = 0 }) {
  const DAY_MS = 86_400_000;
  if (rcPct == null || !(rcPct >= 0)) return { pairs: 0, ops: 0, carry, reason: "no-rc-evidence" };
  if (rcPct <= floorPct) return { pairs: 0, ops: 0, carry, reason: "rc-floor", rcPct };
  const econ = rcEconomics({ maxRc, createCost, cancelCost });
  if (!(econ.pairCost > 0)) return { pairs: 0, ops: 0, carry, reason: "no-economics" };
  const headroom = Math.max(0, Math.min(burst, (rcPct - floorPct) / Math.max(1e-9, setpointPct - floorPct)));
  const burnPerDay = Math.floor(econ.regenPerDay * headroom);
  const byRegen = (burnPerDay * tickMs) / DAY_MS / econ.pairCost;
  const capRemaining = Math.max(0, opsDayCap - opsToday);
  const byCap = capRemaining / 2;
  const byOpCap = Math.floor(maxOpsPerTick / 2);
  const raw = Math.min(byRegen, byCap, byOpCap);
  const pairs = Math.max(0, Math.floor(raw + carry));
  const nextCarry = Math.max(0, Math.min(4, raw + carry - pairs)); // bounded: a governor credit is never hoarded beyond 4 pairs
  return {
    pairs, ops: pairs * 2, carry: nextCarry,
    reason: pairs === 0 ? (capRemaining < 2 ? "ops-day-cap" : "accumulating") : "governor-ok",
    headroom: Math.round(headroom * 1000) / 1000, burnPerDay, rcPct,
  };
}

/** chain-truth day counter for ORDER ops (T-18 law applied to the volume
 * layer): counts limit_order_create + limit_order_cancel cast BY `owner` ON
 * `day` from condenser account-history rows. Same shape tolerance as
 * countDayVotesFromHistory (op-array + nested, junk-tolerant, day-exact). */
export function countDayOrderOpsFromHistory(rows, owner, day) {
  if (!Array.isArray(rows)) return null;
  const d = String(day ?? "").slice(0, 10);
  if (!owner || d.length !== 10) return null;
  let creates = 0, cancels = 0;
  for (const row of rows) {
    const e = Array.isArray(row) ? row[1] : row;
    if (!e || typeof e !== "object") continue;
    const ts = typeof e.timestamp === "string" ? e.timestamp : null;
    if (!ts || !ts.startsWith(d)) continue;
    const op = Array.isArray(e.op) ? e.op : null;
    const type = op ? op[0] : e.type;
    const val = op ? op[1] : e.value;
    if (!val || typeof val !== "object") continue;
    if (val.owner !== owner) continue;
    if (type === "limit_order_create") creates++;
    else if (type === "limit_order_cancel") cancels++;
  }
  return { creates, cancels, total: creates + cancels };
}

const parseAsset3 = (s) => {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^([\d.]+)\s+(SBD|STEEM|VESTS)$/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? { v, sym: m[2] } : null;
};

/** chain-truth day counter for REAL fills: fill_order ops where the account
 * is either side, ON `day`. Amounts parsed from "X SYM" assets — the honest
 * trade journal (ops measure presence; fills measure trades). Pure. */
export function countDayFillsFromHistory(rows, account, day) {
  if (!Array.isArray(rows)) return null;
  const d = String(day ?? "").slice(0, 10);
  if (!account || d.length !== 10) return null;
  let fills = 0, steemIn = 0, steemOut = 0, sbdIn = 0, sbdOut = 0;
  for (const row of rows) {
    const e = Array.isArray(row) ? row[1] : row;
    if (!e || typeof e !== "object") continue;
    const ts = typeof e.timestamp === "string" ? e.timestamp : null;
    if (!ts || !ts.startsWith(d)) continue;
    const op = Array.isArray(e.op) ? e.op : null;
    const type = op ? op[0] : e.type;
    const val = op ? op[1] : e.value;
    if ((type !== "fill_order" && type !== "fill_order_operation") || !val || typeof val !== "object") continue;
    const isCur = val.current_owner === account, isOpn = val.open_owner === account;
    if (!isCur && !isOpn) continue;
    const cur = parseAsset3(val.current_pays), opn = parseAsset3(val.open_pays);
    if (!cur || !opn) continue;
    fills++;
    const mine = isCur ? cur : opn, theirs = isCur ? opn : cur;
    if (mine.sym === "STEEM") { steemOut += mine.v; sbdIn += theirs.v; }
    else { sbdOut += mine.v; steemIn += theirs.v; }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { fills, steemIn: r3(steemIn), steemOut: r3(steemOut), sbdIn: r3(sbdIn), sbdOut: r3(sbdOut) };
}

/** the hyper tick diff (dedup law generalized): given the PLANNED levels and
 * the LIVE hyper orders (with ages), decide the minimal honest action set —
 * cancel only what drifted beyond ε or aged past TTL; create only what has
 * no live match. Zero-drift young book ⇒ zero ops (no churn for churn). Pure. */
export function diffHyperTick({ planned, live, epsBps = 2, ttlMs = 60_000, nowMs = 0 }) {
  if (!Array.isArray(planned)) planned = [];
  if (!Array.isArray(live)) live = [];
  const eps = Math.max(0, epsBps) / 10000;
  const agedOf = (o) => ttlMs > 0 && nowMs - (o.createdAtMs ?? 0) > ttlMs;
  const matchedLive = new Set();
  const creates = [];
  for (const p of planned) {
    if (!p || !(p.unit > 0)) continue;
    /* an aged order is never a match: it is cancelled this tick and must be
     * REPLACED, not orphaned (the level would vanish from the book) */
    const hit = live.find((o) => o && !matchedLive.has(o.orderid) && o.side === p.side && !agedOf(o) && Math.abs(o.unit - p.unit) <= Math.max(1e-9, p.unit * eps));
    if (hit) { matchedLive.add(hit.orderid); continue; }
    creates.push(p);
  }
  const cancelIds = [];
  for (const o of live) {
    if (!o || o.orderid == null) continue;
    if (!matchedLive.has(o.orderid) || agedOf(o)) cancelIds.push(o.orderid);
  }
  return { cancelIds, creates, unchanged: cancelIds.length === 0 && creates.length === 0 };
}

/* ═══════════════════════════ T-21 · IDENTITY-INTEGRITY LAW ═══════════════════════════
 * Proven live 2026-10-01 21:00: ONE unverified paste ("testuser …") flipped
 * masterAccount() → every measurement rail (RC, book ownership, cancels,
 * governor economics) silently measured a FOREIGN account for hours — the
 * hyper layer's burn collapsed 500× and the machine went quiet with an
 * honest-looking GOVERNOR-ACCUMULATING verdict. LAW: the account of record
 * is the DOCTRINE account (env > default). A credential file can kill
 * SIGNING (typed CREDENTIAL-MISSING / FOREIGN-CREDENTIAL) — it can never
 * steal MEASUREMENT. Pure. */
export function doctrineAccount(envAcct, fileAcct = undefined) {
  const d = String(envAcct ?? "").trim() || "headcorner";
  return d;
}

/** the adopt gate: a paste may install a credential ONLY for the doctrine
 * account. Anything else is refused at the door (nothing written, nothing
 * cached), journaled honestly by the caller. Pure. */
export function credentialGate(fileAcct, doctrine) {
  const f = String(fileAcct ?? "").trim();
  const d = String(doctrine ?? "").trim();
  if (!f) return { allow: false, reason: "credential-format: account field missing" };
  if (!d) return { allow: false, reason: "no-doctrine-account" };
  if (f !== d) {
    return {
      allow: false,
      reason: `ACCOUNT-MISMATCH-DOCTRINE: pasted "${f}" but this engine's account of record is "${d}" — measurement rails stay untouched; paste the ${d} credential`,
    };
  }
  return { allow: true, reason: null };
}

/** RC-anomaly guard (defense-in-depth for the same class of bug): the RC
 * tank of the doctrine account is stable on human timescales — a >10× drop
 * between consecutive reads means the identity flipped or the RPC lied.
 * No burn on anomaly; the next honest read heals it. Pure. */
export function rcAnomaly(lastMaxRc, maxRc, ratio = 0.1) {
  const l = Number(lastMaxRc), m = Number(maxRc);
  if (!(m > 0)) return true;                    // no evidence → no burn (T-18 lineage)
  if (!(l > 0)) return false;                   // first read — nothing to compare
  return m < l * ratio;
}

/* ═══════════════════════════ T-21 · THE RECRUITER (הצבא מפתח את עצמו) ═══════════════════════════
 * Operator order: "לברר איך האוטונומיה והריבונות מפתחת את הצבא ומגייסת עוד
 * תפקידים לבד". The recruiter is the doctrine that turns EXISTING running
 * capabilities into NAMED stations with truth-contracts — a role is
 * recruited only when its enabling evidence exists in the engine's state
 * (measured, not promised), and demoted to planned/blocked when the evidence
 * goes stale. Every row carries the exact state file that proves it. Pure. */
export function recruitRoles({ evidence = {}, now = null, prior = {} } = {}) {
  const at = now ?? null;
  // each candidate: id, role, lane, capability (what it DOES), evidence-key
  // (must be truthy-ish to recruit), cadence, truthContract
  const CANDIDATES = [
    { id: "market-analyst", role: "אנליסט-שוק", lane: "measurement", capability: "marketPulse 24h — fills/volume/spread/depth of the whole venue", key: "marketPulse", cadence: "cycle", truthContract: "numbers only from market_history_api reads, labeled measured" },
    { id: "rc-economist", role: "כלכלן-RC", lane: "resource", capability: "RC tank economics + equilibrium governor — the volume ceiling law", key: "rcEconomics", cadence: "3s tick", truthContract: "costs measured by live manabar deltas (rc-probe), never invented" },
    { id: "fill-auditor", role: "מבקר-עסקאות", lane: "truth", capability: "chain-truth fill/op counters over account history (max(state, chain-truth))", key: "fillAudit", cadence: "cycle+tail", truthContract: "countDayFillsFromHistory / countDayOrderOpsFromHistory on real rows" },
    { id: "treasury-sentinel", role: "שומר-אוצר", lane: "arbitrage", capability: "convert-arb edge monitor — SBD print path held honest (dust-or-capped)", key: "convert", cadence: "cycle", truthContract: "edge in bps from measured market vs implied, HOLD verdict honest" },
    { id: "content-strategist", role: "אסטרטג-תוכן", lane: "growth", capability: "daily SEO-smart promo report — network presence without exposure", key: "promo", cadence: "daily", truthContract: "posted txid journaled; claims never exceed the measured state" },
    { id: "curation-steward", role: "מושל-קיורציה", lane: "fuel", capability: "doctrine vote rail — day-cap enforced on max(state, chain-truth)", key: "curation", cadence: "cycle", truthContract: "budgetCounted basis journaled on every verdict" },
    { id: "integrity-auditor", role: "מבקר-שלמות", lane: "truth", capability: "offline deterministic selftest core (the honesty contract itself, run daily by the machine)", key: "selftest", cadence: "daily (T-22 standing)", truthContract: "PASS required before any deploy; failures block" },
    { id: "fleet-recruiter", role: "מגייס-הצבא", lane: "doctrine", capability: "this very ladder — turns running capabilities into accountable stations", key: "recruiter", cadence: "cycle", truthContract: "a role exists only with named evidence in state" },
    { id: "web-intel", role: "מודיעין-רשת", lane: "growth", capability: "external eyes — rotating web scans of the STEEM/SBD ecosystem, competitors and market news, feeding the strategist and the analyst", key: "webIntel", cadence: "6h", truthContract: "findings carry url+date from real search results; no finding without a source" },
    { id: "payout-auditor", role: "מבקר-פאייאוטים", lane: "truth", capability: "the payout CLOCK + pending rewards + settled reward rollup — the instrument that flips the curation rail from estimated to measured (T-18c/T-23)", key: "payouts", cadence: "daily", truthContract: "pending balances and history rows from chain reads only; the clock, never a guess, gates the estimated→measured flip" },
    { id: "weave-ambassador", role: "שגריר-ה-weave", lane: "doctrine", capability: "the one-body contract with the external second signer — shared day-cap, vote/order lanes, collision + weight laws, published machine-readably (T-19f/T-23)", key: "weave", cadence: "daily", truthContract: "their votes counted from chain history minus our journal, never from our own logs" },
  ];
  const priorById = {};
  for (const r of (Array.isArray(prior?.roster) ? prior.roster : [])) {
    if (r && r.id) priorById[r.id] = r;
  }
  const roster = [];
  for (const c of CANDIDATES) {
    const has = !!(evidence?.[c.key]);
    const prev = priorById[c.id];
    const status = has ? "active" : "planned";
    roster.push({
      id: c.id, role: c.role, lane: c.lane, capability: c.capability,
      status, cadence: c.cadence, truthContract: c.truthContract,
      /* recruitedAt survives demotion: a station's history is not amnesiac —
       * the roster shows WHEN it first became real, even if evidence died */
      recruitedAt: has ? (prev?.recruitedAt ?? at) : (prev?.recruitedAt ?? null),
      evidence: has ? (typeof evidence[c.key] === "string" ? evidence[c.key] : c.key) : null,
      priorStatus: prev?.status ?? null,
    });
  }
  const active = roster.filter((r) => r.status === "active").length;
  return {
    verdict: active >= roster.length ? "FULL-STRENGTH" : active > 0 ? "RECRUITED" : "DRAFT",
    active, total: roster.length,
    ladderNote: "תפקיד נרשם רק כשהראיה שלו קיימת במדינת-המנוע — מדוד, לא מובטח; תפקיד-מת מתדרג ל-planned בכל מחזור",
    roster,
    at,
  };
}

/* ═══════════════════════════ T-21 · MULTI-RAIL ECONOMICS (המערך-הכלכלי → ערך אמיתי) ═══════════════════════════
 * One honest rollup of EVERY value rail the machine runs, each labeled
 * measured | estimated | blocked with its own note. Never sums across
 * confidence classes into one lie — totals are per-class. Pure. */
export function aggregateRails({ realizedSbdTotal = null, realizedWindowDays = null, sbdUsd = null, curationEstSteemPerDay = null, curationMeasuredUsdPerDay = null, steemUsd = null, convertEdgeBps = null, convertAmountSbd = null, convertVerdict = null, promoPostsPerDay = null, promoEstUsdPerPost = null, fuelUsdPerDay = null, hyperOpsPerDay = null, parity = null, fillsToday = null, marketFillsPerDay = null } = {}) {
  /* null/empty → null (Number(null)===0 is the classic lie: missing evidence
   * must never classify as a measured ZERO) */
  const r6 = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const usd = (sbd) => (sbd != null && r6(sbdUsd) != null ? Math.round(sbd * sbdUsd * 1e6) / 1e6 : null);
  const rails = [];

  // 1 · realized trading (MEASURED from chain fills when a window exists)
  const realizedSbd = r6(realizedSbdTotal);
  const perDaySbd = realizedSbd != null && r6(realizedWindowDays) > 0 ? realizedSbd / realizedWindowDays : null;
  rails.push({
    id: "market-making", label: "מעשה-שוק · ספר-STEEM/SBD",
    measuredUsdPerDay: usd(perDaySbd), estUsdPerDay: null,
    confidence: perDaySbd != null ? "measured" : "blocked",
    note: perDaySbd != null
      ? `realized ${Math.round(realizedSbd * 1000) / 1000} SBD over ${realizedWindowDays}d (chain fills) — היסטורי, אינו תחזית`
      : "no fill window yet — measured once real fills accumulate",
    meta: { realizedSbdTotal: realizedSbd, fillsToday: r6(fillsToday) ?? 0 },
  });

  // 2 · curation fuel (ESTIMATED from public reward-fund math; MEASURED the
  // moment the chain pays — the T-23 payouts instrument supplies it)
  const curSteem = r6(curationEstSteemPerDay);
  const curUsd = curSteem != null && r6(steemUsd) != null ? Math.round(curSteem * steemUsd * 1e6) / 1e6 : null;
  const curMeasured = r6(curationMeasuredUsdPerDay);
  rails.push({
    id: "curation", label: "קיורציה · מסילת-דלק",
    measuredUsdPerDay: curMeasured, estUsdPerDay: curMeasured != null ? null : curUsd,
    confidence: curMeasured != null ? "measured" : curUsd != null ? "estimated" : "blocked",
    note: curMeasured != null
      ? `MEASURED ${curMeasured}$/יום from settled chain rewards — התווית התהפכה מ-estimated, שעון-הפאייאוט צדק`
      : curUsd != null ? `~${Math.round(curSteem * 100) / 100} STEEM/יום — ESTIMATED (payout clock ~7d, first verification T-18c)` : "no discovery estimate yet",
  });

  // 3 · fuel rollup from observe (author+curation ops est)
  const fuel = r6(fuelUsdPerDay);
  rails.push({
    id: "fuel", label: "דלק-רשת · author+curation ops",
    measuredUsdPerDay: null, estUsdPerDay: fuel,
    confidence: fuel != null ? "estimated" : "blocked",
    note: fuel != null ? "observe fuel meter (estimated — window-labeled)" : "no fuel window",
  });

  // 4 · convert-arb potential (BLOCKED-honest unless armed)
  const edge = r6(convertEdgeBps);
  const amt = r6(convertAmountSbd);
  const convSbdPerDay = amt != null && edge != null && edge > 0 ? amt * (edge / 10000) : null;
  rails.push({
    id: "convert-arb", label: "ארביטרז'-המרה · SBD print path",
    measuredUsdPerDay: null, estUsdPerDay: usd(convSbdPerDay),
    confidence: convertVerdict === "CONVERT-HOLD" ? "blocked" : convSbdPerDay != null ? "estimated" : "blocked",
    note: convertVerdict === "CONVERT-HOLD"
      ? `HOLD honest (${edge != null ? `${Math.round(edge)}bps edge` : "no edge"}, dust-or-capped) — the rail is armed-in-doctrine, not burning`
      : convSbdPerDay != null ? `edge ${Math.round(edge)}bps on ${amt} SBD` : "no edge evidence",
  });

  // 5 · promo (ESTIMATED)
  const posts = r6(promoPostsPerDay), perPost = r6(promoEstUsdPerPost);
  rails.push({
    id: "promo", label: "קידום-רשת · תוכן SEO-חכם",
    measuredUsdPerDay: null, estUsdPerDay: posts != null && perPost != null ? Math.round(posts * perPost * 1e6) / 1e6 : null,
    confidence: posts != null && perPost != null ? "estimated" : "blocked",
    note: "payouts estimated from account reward history; post txids journaled",
  });

  // 6 · hyper presence (NOT dollars — presence ops, the volume layer)
  rails.push({
    id: "hyper-presence", label: "היפר-גריד · נוכחות-ספר",
    measuredUsdPerDay: null, estUsdPerDay: null,
    confidence: r6(hyperOpsPerDay) != null ? "measured" : "blocked",
    note: r6(hyperOpsPerDay) != null
      ? `${Math.round(hyperOpsPerDay)} ops/day measured — presence + optionality, deliberately NOT priced as profit`
      : "no ops evidence",
    meta: { opsPerDay: r6(hyperOpsPerDay) },
  });

  const sum = (k) => rails.reduce((a, r) => a + (r[k] ?? 0), 0);
  const round6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    rails,
    totalMeasuredUsdPerDay: round6(sum("measuredUsdPerDay")),
    totalEstUsdPerDay: round6(sum("estUsdPerDay")),
    measuredCount: rails.filter((r) => r.confidence === "measured").length,
    estimatedCount: rails.filter((r) => r.confidence === "estimated").length,
    blockedCount: rails.filter((r) => r.confidence === "blocked").length,
    law: "סכום-מדוד וסכום-מוערך לעולם לא מתמזגים — שתי שורות-אמת נפרדות",
    parity: r6(parity),
  };
}

/* ═══════════════════════════ T-22 · WEB-INTEL NORMALIZER (עיניים-חיצוניות) ═══════════════════════════
 * The machine's own external-intelligence team: raw search results are
 * normalized into dated, sourced findings — a finding without url+source is
 * not a finding (the truth contract of the web-intel station). Pure.
 * Junk-tolerant: bad rows drop, never poison the file. */
export function normalizeWebIntel({ results = [], query = "", fetchedAt = null } = {}) {
  const cut = (s, n) => String(s ?? "").slice(0, n);
  const findings = [];
  for (const r of (Array.isArray(results) ? results : [])) {
    if (!r || typeof r !== "object") continue;
    const url = typeof r.url === "string" && r.url.startsWith("http") ? r.url : null;
    const title = typeof r.name === "string" && r.name.trim().length > 3 ? r.name.trim() : null;
    if (!url || !title) continue; // no-source findings are not findings
    findings.push({
      url, title: cut(title, 200),
      snippet: cut(r.snippet ?? "", 400) || null,
      host: cut(r.host_name ?? "", 100) || null,
      date: cut(r.date ?? "", 40) || null,
      query: cut(query, 120) || null,
      fetchedAt,
    });
  }
  return { findings, count: findings.length, dropped: (Array.isArray(results) ? results.length : 0) - findings.length };
}

/* T-22 · WEB-INTEL STALENESS: fresh = fetched within `maxAgeMs`. Freshness is
 * the recruiter's evidence gate — stale intel demotes the station honestly.
 * Shape-tolerant: the file may hold a flat findings array OR the run doc's
 * scans[].findings layout — both count, junk rows never count. */
export function webIntelFresh(file, nowMs = Date.now(), maxAgeMs = 26 * 3600_000) {
  if (!file || typeof file !== "object") return null;
  const at = file.fetchedAt ? Date.parse(file.fetchedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const ageMs = nowMs - at;
  const flat = Array.isArray(file.findings) ? file.findings : [];
  const inScans = Array.isArray(file.scans)
    ? file.scans.flatMap((s) => (s && Array.isArray(s.findings) ? s.findings : []))
    : [];
  const findings = [...flat, ...inScans].filter((f) => f && f.url && f.title);
  if (ageMs < 0 || ageMs > maxAgeMs || findings.length === 0) return null;
  return { ageMs, findings: findings.length };
}

/* ═══════════════════════════ T-23 · המדידה-הכלכלית-האמיתית ═══════════════════════════
 * The operator's directive: "מערך-כלכלי מדומה → להפוך לערך אמיתי צעד-צעד".
 * These pure cores are the conversion instruments: the payout CLOCK (T-18c),
 * the reward-history rollup (estimated → measured the moment the chain
 * pays), the VP equilibrium probe (T-18e), the X-2 capital spectrum (T-18f)
 * and the weave arbitration (T-19f — the one-body contract with the second
 * signer). All pure, all vector-tested, all honest. */

/* T-23 · PAYOUT CLOCK: curation rewards settle ~7d after vote. The machine's
 * first doctrine votes were 2026-09-30 — the clock below is the countdown to
 * the FIRST REAL measurement of the curation rail (until then the rail
 * stays ESTIMATED, and the clock is the honest reason why). Pure. */
export function payoutWindow({ firstVoteDay, now, payoutDays = 7 } = {}) {
  if (!firstVoteDay || !now) return null;
  const first = Date.parse(`${String(firstVoteDay).slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(now);
  if (!Number.isFinite(first) || !Number.isFinite(t)) return null;
  const payoutMs = first + payoutDays * 86400_000;
  const msRemaining = payoutMs - t;
  return {
    payoutDay: new Date(payoutMs).toISOString().slice(0, 10),
    msRemaining: Math.max(0, msRemaining),
    hoursRemaining: Math.max(0, Math.round((msRemaining / 3600_000) * 10) / 10),
    daysRemaining: Math.max(0, Math.ceil(msRemaining / 86400_000)),
    phase: msRemaining > 0 ? "pre-payout" : "paid-window",
    law: "פאייאוט-קיורציה מתיישב ~7 ימים אחרי-ההצבעה — השעון מדוד, לא מונח",
  };
}

/* T-23 · REWARD-HISTORY ROLLUP: get_account_history reward ops → the
 * measured historical rewards. While opsCount = 0 the rollup honestly says
 * nothing-paid-yet (blocked) — the moment the chain pays, this flips to
 * measured $/day with the window labeled. Junk-tolerant, never invents.
 * rows = [[idx, {op, timestamp}]] as returned by the history API. */
export function rewardHistoryRollup({ rows = [], steemUsd = null, sbdUsd = null, vestsToSteem = null } = {}) {
  const num = (s) => { const n = Number(String(s ?? "").split(" ")[0]); return Number.isFinite(n) ? n : 0; };
  let curationVests = 0, authorSbd = 0, authorSteem = 0, authorVests = 0, claims = 0, opsCount = 0;
  let oldestTs = null, newestTs = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const e = Array.isArray(row) ? row[1] : null;
    const op = e?.op;
    if (!op) continue;
    const type = opTypeName(op);
    const v = (Array.isArray(op) ? op[1] : op?.value) ?? {};
    if (type === "curation_reward") { curationVests += num(v.reward); opsCount++; }
    else if (type === "author_reward") { authorSbd += num(v.sbd_payout); authorSteem += num(v.steem_payout); authorVests += num(v.vesting_payout); opsCount++; }
    else if (type === "claim_reward_balance") { claims++; opsCount++; }
    if (e?.timestamp) {
      const ts = Date.parse(String(e.timestamp).includes("T") ? e.timestamp : `${e.timestamp}Z`);
      if (Number.isFinite(ts)) { oldestTs = oldestTs == null ? ts : Math.min(oldestTs, ts); newestTs = newestTs == null ? ts : Math.max(newestTs, ts); }
    }
  }
  const windowDays = oldestTs != null && newestTs != null && newestTs >= oldestTs
    ? Math.max(1, Math.ceil((newestTs - oldestTs) / 86400_000)) : null;
  const curationSteem = vestsToSteem != null && vestsToSteem > 0 ? curationVests * vestsToSteem : null;
  const curationUsd = curationSteem != null && num(steemUsd) > 0 ? curationSteem * Number(steemUsd) : null;
  const curationUsdPerDay = curationUsd != null && windowDays != null ? Math.round((curationUsd / windowDays) * 1e6) / 1e6 : null;
  const authorSbdUsd = num(sbdUsd) > 0 ? Math.round(authorSbd * Number(sbdUsd) * 1e6) / 1e6 : null;
  const authorUsdPerDay = authorSbdUsd != null && windowDays != null ? Math.round((authorSbdUsd / windowDays) * 1e6) / 1e6 : null;
  /* R282 · UNIT-MEASURED per-day (raw units, UNPRICED — the single-pricer
   * law: this rollup measures, the economics rollup prices with ITS pricer).
   * The measured/estimated flip now keys on real settled UNITS, not on a
   * pricer being present — the old gate conflated "measured" with "priced"
   * and held the rail estimated forever while the chain paid. A literal
   * zero stream is NOT a measured stream (absence ≠ measurement): a lane
   * counts only when its settled total is > 0. */
  const curationSteemPerDay = curationSteem != null && curationVests > 0 && windowDays != null ? Math.round((curationSteem / windowDays) * 1e6) / 1e6 : null;
  const authorSbdPerDay = authorSbd > 0 && windowDays != null ? Math.round((authorSbd / windowDays) * 1e6) / 1e6 : null;
  const unitMeasured = curationSteemPerDay != null || authorSbdPerDay != null;
  return {
    opsCount, claims,
    curationVests: Math.round(curationVests * 1e6) / 1e6,
    authorSbd: Math.round(authorSbd * 1e6) / 1e6,
    authorSteem: Math.round(authorSteem * 1e6) / 1e6,
    authorVests: Math.round(authorVests * 1e6) / 1e6,
    windowDays, oldestTs: oldestTs != null ? new Date(oldestTs).toISOString() : null,
    newestTs: newestTs != null ? new Date(newestTs).toISOString() : null,
    curationSteemPerDay, authorSbdPerDay,
    curationUsdPerDay, authorUsdPerDay,
    confidence: opsCount === 0 ? "blocked" : unitMeasured ? "measured" : "estimated",
    note: opsCount === 0
      ? "no settled reward ops in the scanned window yet — the payout clock decides when this flips to measured"
      : unitMeasured
        ? `settled chain rewards MEASURED (${curationSteemPerDay != null ? `${curationSteemPerDay} STEEM/day` : ""}${authorSbdPerDay != null ? ` · ${authorSbdPerDay} SBD/day` : ""}) — unpriced here, economics prices`
        : "settled reward ops present — units need a vests→steem ratio to measure per-day",
  };
}

/* ═══ R282 · THE HONEST SCAN (anti-false-zero instrument) ═══
 * THE MEASURED ROOT-CAUSE (2026-10-08): the payout scanner demanded
 * limit=10000 in one call; the live node fleet now caps ah_api at
 * limit≤100 ("upper limit is 100" on api.justyy) and one node is 502 —
 * so the big call failed on EVERY node, the fallback treated the failure
 * as "empty rows", and the rollup reported a CONFIDENT ZERO. Chain truth
 * (chunked walk, same day): 13 votes, 3 settled curation rewards, 3
 * claims — the income rail was never zero, it was UNMEASURED. These pure
 * cores make the walk plannable and its coverage honest: a scan that
 * reads nothing must say SCAN-FAILED, never zero. Pure. Vector-tested. */

/* R282 · SCAN WALK PLAN: the bounded backward-walk plan for history scans.
 * The walk starts at -1 (head) and steps windows of `windowSize` (≤ the
 * node cap) until `maxWindows` is exhausted or the account's genesis row
 * (idx 2) is reached. `windowsFor(ops)` answers "is my budget enough for
 * the ops I want?" — the honest pre-flight, before any network read. */
export function scanWalkPlan({ maxWindows = 150, windowSize = 100 } = {}) {
  const mw = Number(maxWindows), ws = Number(windowSize);
  if (!Number.isFinite(mw) || mw < 1 || !Number.isFinite(ws) || ws < 1 || ws > 1000) {
    return { ok: false, reason: "invalid-plan-params" };
  }
  return {
    ok: true, maxWindows: mw, windowSize: ws,
    maxRows: mw * ws,
    genesisIdx: 2, // steem account history is 1-based; 2 = first op row
    law: "חלונות-קטנים מהראש אחורה — תקציב-מקסימלי ממסגר; הכיסוי מדווח בכנות, הכישלון מעיד על עצמו",
  };
}

/* R282 · COVERAGE VERDICT: the honest label of a scan outcome.
 * - readFailed=true (zero windows read)  → SCAN-FAILED (never a zero)
 * - budgetReached (stopped at maxWindows with more history ahead)
 *                                        → SCAN-PARTIAL (REAL rows, bounded)
 * - walk finished (genesis/head reached) → SCAN-COMPLETE
 * - zero windows read but no failure    → SCAN-FAILED (same law)
 * partial windows (a window shorter than windowSize with genesis NOT
 * reached) still count the rows but the coverage stays partial-honest. */
export function coverageVerdict({ windowsRead = 0, rowsFound = 0, budgetReached = false, genesisReached = false } = {}) {
  const w = Number(windowsRead), r = Number(rowsFound);
  if (!Number.isFinite(w) || w < 0 || !Number.isFinite(r) || r < 0) {
    return { verdict: "SCAN-FAILED", reason: "invalid-inputs", rows: 0 };
  }
  if (w === 0) return { verdict: "SCAN-FAILED", reason: "no-window-read", rows: 0 };
  if (budgetReached && !genesisReached) {
    return { verdict: "SCAN-PARTIAL", reason: "budget-bound", rows: r, windows: w };
  }
  return { verdict: "SCAN-COMPLETE", reason: genesisReached ? "genesis-reached" : "head-exhausted", rows: r, windows: w };
}

/* R282 · WINDOW MERGE: dedupe + order the collected history rows across
 * windows. The backward walk can overlap (a re-read window) — the merge is
 * idempotent by row index, junk rows drop, and the output is ascending by
 * idx (the rollup expects chronological order for its window math). Pure. */
export function mergeHistoryWindows(windows = []) {
  const seen = new Set();
  const out = [];
  for (const win of (Array.isArray(windows) ? windows : [])) {
    for (const row of (Array.isArray(win) ? win : [])) {
      const idx = Array.isArray(row) ? row[0] : null;
      if (!Number.isFinite(Number(idx)) || !row?.[1]?.op) continue;
      const key = Number(idx);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  out.sort((a, b) => Number(a[0]) - Number(b[0]));
  return out;
}

/* T-23 · VP EQUILIBRIUM (T-18e): current voting power from the manabar.
 * VP regenerates at a known curve; the honest question is whether the
 * doctrine's day-cap leaves VP rotting (spoilage) or riding the curve.
 * Pure math over the manabar snapshot. */
export function vpNow({ currentMana, maxMana, vests, now, regenSecs = 5 * 86400 }) {
  const cm = Number(currentMana), mm = Number(maxMana), v = Number(String(vests ?? "").split(" ")[0]);
  if (!Number.isFinite(cm) || !Number.isFinite(mm) || mm <= 0) return null;
  const pct = Math.round((cm / mm) * 1e3) / 10;
  const regenPerSec = mm / regenSecs;
  const hrsToFull = Math.max(0, Math.round(((mm - cm) / regenPerSec / 3600) * 10) / 10);
  return { pct, hrsToFull, regenPerSec: Math.round(regenPerSec), vests: Number.isFinite(v) ? v : null, basis: `voting_manabar at ${now ?? "?"}` };
}

/* T-23 · X-2 CAPITAL SPECTRUM (T-18f): the honest scaling table from
 * today's MEASURED economics to the $1000/day target. The machine's law is
 * known (curation ∝ SP share, ops/day ∝ RC ∝ SP) — the card shows what
 * capital buys, not a promise. Pure. */
export function x2Spectrum({ currentUsdPerDay = null, targetUsdPerDay = 1000, currentSp = null } = {}) {
  const base = Number(currentUsdPerDay);
  const sp = Number(currentSp);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(sp) || sp <= 0) return null;
  const factor = Math.ceil((targetUsdPerDay / base) * 10) / 10;
  const mults = [1, 10, 40, 100, Math.ceil(factor)];
  const rows = mults.map((m) => ({
    mult: m,
    sp: Math.round(sp * m),
    usdPerDay: Math.round(base * m * 100) / 100,
    reachesTarget: base * m >= targetUsdPerDay,
  }));
  return {
    currentUsdPerDay: Math.round(base * 1e4) / 1e4,
    targetUsdPerDay, currentSp: Math.round(sp), factor,
    rows,
    law: "הקיורציה גדלה ∝ חלק-ה-SP מבריכת-התגמולים; תקרת-העסקאות ∝ RC ∝ SP — ההון מכפיל את המדידה, הקוד נשאר",
  };
}

/* T-23 · WEAVE ARBITRATION (T-19f v1): the one-body contract with the
 * external second signer ("saos.weave.core.v1"). Both writers act on the
 * SAME account; the chain truth is the shared ledger, so the day-cap counts
 * BOTH writers (the T-18 max(state, chain-truth) law). The handshake makes
 * the lanes explicit: votes share the cap, orders are partitioned by
 * order-id ranges, and the second signer is REQUESTED to publish its own
 * partition. Pure. */
export function weaveArbitration({ ourVotesToday = 0, theirVotesToday = 0, sharedDayCap = 18, ourOrderCount = 0, theirOrderCount = 0 } = {}) {
  const ours = Number(ourVotesToday) || 0;
  const theirs = Number(theirVotesToday) || 0;
  const cap = Number(sharedDayCap) || 0;
  const combined = ours + theirs;
  return {
    combined, sharedDayCap: cap,
    capRemaining: Math.max(0, cap - combined),
    capBasis: "chain-truth-shared — התקרה סופרת את שני-הכותבים יחד (max(state, chain-truth))",
    voteLanes: { ours, theirs },
    orderLanes: { ours: Number(ourOrderCount) || 0, theirs: Number(theirOrderCount) || 0 },
    partitionLaw: "order-id partition: מחזור ∈ [0, 2.1e9) · היפר ∈ [2.1e9, 4.29e9) · החותם-השני מתבקש לפרסם את הטווח שלו (handshake v1)",
    collisionLaw: "already-voted = dedup תקציבי-כן (T-17) — הצבעה אף-פעם לא חוזרת, רק נספרת פעם-אחת",
    weightLaw: "משקלים משתנים לפי-הדוקטרינה (spoilage) — שני-כותבים באותו-משקל היו מכפילים חלק-בריכה אחד פעמיים",
  };
}

/* T-23 · WEAVE FRESHNESS: the handshake is alive when its observation doc
 * is fresh (<maxAgeMs) AND carries a protocol id. Shape-tolerant, junk → null. */
export function weaveFresh(file, nowMs = Date.now(), maxAgeMs = 26 * 3600_000) {
  if (!file || typeof file !== "object") return null;
  if (file.protocol !== "saos.weave.core.v1") return null;
  const at = file.observedAt ? Date.parse(file.observedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const ageMs = nowMs - at;
  if (ageMs < 0 || ageMs > maxAgeMs) return null;
  return { ageMs, theirVotesToday: file.theirs?.votesToday ?? null };
}

/* T-23 · OP-TYPE NAME (chain shape law, measured live): history APIs disagree
 * — account_history_api returns "vote_operation" while condenser returns
 * bare "vote". Every consumer of history rows normalizes through HERE, or
 * the two shapes silently produce false zeros (the exact bug class T-22
 * caught in webIntelFresh). Pure. */
export function opTypeName(op) {
  const t = Array.isArray(op) ? op[0] : (op?.type ?? op ?? "");
  return String(t).replace(/_operation$/, "");
}

/* ════════════════════════════════════════════════════════════════════
 * R237 · ARCHITECTURE ROUND — the operator's verdict: "simulations instead
 * of real runs, no communication between agents, no intelligence in the
 * automatic actions, blockages" are architecture failures. This section is
 * the calculated response. All functions PURE (selftest-covered).
 * ════════════════════════════════════════════════════════════════════ */

/* R237-A · SIGNAL DIGEST: the live cycle keeps the deterministic trigger-grid
 * ONLY as a signal generator. Simulated fills (`grid.fill`, `fee.spawn`) are
 * RETIRED from the live bus — real fills are measured from the chain
 * (measure.mjs), never invented locally. Pure. */
export function signalDigest(events = []) {
  const list = Array.isArray(events) ? events : [];
  const signals = list.filter((e) => e && e.type !== "grid.fill" && e.type !== "fee.spawn");
  const retiredFills = list.length - signals.length;
  const kinds = {};
  for (const e of signals) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
  const arb = signals.find((e) => e.type === "arb.signal") ?? null;
  return { signals, retiredFills, kinds, arbSignal: arb ? { gapBps: arb.gapBps ?? null, dir: arb.dir ?? null } : null };
}

/* R237-A · MEASURED LAYERS: the cockpit must never again be told "4/4 grids
 * active" by a constant. Presence is counted from REAL artifacts: our order
 * tranches (our-orders.json), the hyper layer's own state, and custody-
 * verified soldier grids. A layer with zero evidence is INACTIVE — measured,
 * not promised. Pure. */
export function measuredLayers(opts = {}) {
  const orders = Array.isArray(opts?.ourOrders) ? opts.ourOrders : [];
  const hyper = opts?.hyper ?? null;
  const soldiersVerified = opts?.soldiersVerified ?? null;
  const norm = orders.map((o) => (typeof o === "object" && o !== null ? o : { id: o, tranche: "value" }));
  const value = norm.filter((o) => (o.tranche ?? "value") === "value").length;
  const flow = norm.filter((o) => o.tranche === "flow").length;
  const hyperOps = hyper && typeof hyper === "object" ? (hyper.opsToday ?? hyper.ops?.today ?? null) : null;
  const hyperOn = hyper?.enabled === true || (typeof hyperOps === "number" && hyperOps > 0);
  const soldiers = typeof soldiersVerified === "number" && soldiersVerified > 0 ? soldiersVerified : 0;
  return [
    { id: "value-ladder", real: true, active: value > 0, levels: value, evidence: "our-orders.json tranches" },
    { id: "flow-tranche", real: true, active: flow > 0, levels: flow, evidence: "our-orders.json tranches" },
    { id: "hyper-tranche", real: true, active: !!hyperOn, levels: hyperOps, evidence: "hyper-grid.json ops" },
    { id: "soldier-grids", real: true, active: soldiers > 0, levels: soldiers, evidence: "custody-verified accounts" },
  ];
}

/* R237-C · POWER-UP INTELLIGENCE — calculated, deterministic, doctrine-capped.
 * The doctrine share (planRedeploy) is NEVER exceeded: intelligence (a)
 * EXPLAINS the decision with measured factors and (b) scales DOWN only to
 * protect the grid's ask-side liquidity (a power-up must never starve the
 * ladder that feeds the machine). rcPct is documentation only — pacing law
 * owns the timing, this layer never rushes it. Pure. */
export function redeployIntel({ planned = 0, liquidSteem = 0, floorSteem = 5, askNeed = 0, rcPct = null } = {}) {
  planned = numStrict(planned); liquidSteem = numStrict(liquidSteem);
  floorSteem = numStrict(floorSteem); askNeed = numStrict(askNeed);
  const rc = typeof rcPct === "number" && Number.isFinite(rcPct) ? Math.round(rcPct * 10) / 10 : null;
  const factors = { planned, liquidSteem, floorSteem, askNeed, rcPct: rc };
  if (!(planned > 0)) {
    return { scale: 0, verdict: "NOTHING-TO-SCALE", factors, reason: "no planned power-up this cycle", urgency: null };
  }
  /* RC note: low RC = power-up is EXTRA valuable (SP raises the RC ceiling) —
   * documented urgency, the pacing law still owns every timing decision. */
  const urgency = rc != null && rc < 30 ? "high (rc low — vesting raises the RC ceiling)" : null;
  if (!(askNeed > 0)) {
    return { scale: 1, verdict: "FULL-DOCTRINE", factors, reason: "no ask-side ladder need measured — nothing to starve", urgency };
  }
  const maxAllowed = Math.max(0, liquidSteem - floorSteem - askNeed);
  if (maxAllowed >= planned) {
    return { scale: 1, verdict: "FULL-DOCTRINE", factors, reason: "grid not starved: liquid after power-up covers the ladder's ask need", urgency };
  }
  /* protect the ladder: shrink to what the grid can spare (floor3dp — every
   * executed amount must stay broadcastable); may reach 0 = honest defer */
  const raw = planned > 0 ? maxAllowed / planned : 0;
  const scale = Math.max(0, Math.min(1, Math.floor(raw * 1000 + 1e-9) / 1000));
  return {
    scale,
    verdict: scale > 0 ? "GRID-PROTECT-SCALED" : "GRID-PROTECT-DEFER",
    factors,
    reason: scale > 0
      ? `scaled ×${scale.toFixed(3)} — protecting ${askNeed} STEEM of ladder ask-need above the floor`
      : `deferred — ladder ask-need (${askNeed} STEEM) consumes everything above the floor`,
    urgency,
  };
}

/* R237-D · BLOCKAGE LEDGER: every non-execution is named, owned and classified
 * LAWFUL (operator stop-orders, doctrine floors, pacing, structural authority
 * mixes) — a blockage without an owner is the only kind this machine no
 * longer tolerates. Pure. */
export function blockageLedger({ steps = {}, conf = {} } = {}) {
  const s = steps && typeof steps === "object" ? steps : {};
  const items = [];
  const add = (source, owner, reason) => items.push({ source, owner, lawful: true, reason: String(reason).slice(0, 160) });
  if (s.soldiers?.verdict === "DISABLED-T80-OPERATOR-STOP") add("soldiers", "operator", "T-80 stop-order (2026-10-04) — soldiers frozen until re-authorization");
  if (s.execute?.verdict === "OPERATOR-PAUSED") add("execute", "operator", "kill-switch exec-pause.json is set");
  if (s.execute?.verdict === "DISARMED") add("execute", "operator", "standing-order-off (armed=false)");
  if (s.execute?.verdict === "OPS-DAY-CAP") add("execute", "law T-19", `ops day-cap ${s.execute?.opsDayCap ?? "?"} — RC is a shared budget`);
  if (s.redeploy?.verdict === "REDEPLOY-COOLDOWN") add("redeploy", "law R231", s.redeploy?.reason ?? "pacing minInterval/maxPerDay");
  if (s.redeploy?.verdict === "REDEPLOY-HOLD") add("redeploy", "doctrine floor", s.redeploy?.reason ?? "excess below the minimum power-up");
  if (s.redeploy?.verdict === "REDEPLOY-BLOCKED") add("redeploy", "law R233", s.redeploy?.reason ?? "ratios-invalid fail-closed");
  if (s.redeployDeferredForClaim) add("redeploy", "structural", "claim in batch → posting/active authority mix is un-signable — deferred one cycle");
  if (s.convertDeferredForClaim) add("convert", "structural", "claim in batch → convert deferred one cycle (R210 authority-mix law)");
  if (s.redeploySkippedForFunds) add("redeploy", "batch-funds guard", "chain liquid above floor could not fund plan + ladder locks");
  if (conf?.soldiers?.enabled !== true && s.soldiers && s.soldiers.verdict !== "DISABLED-T80-OPERATOR-STOP" && s.soldiers.ok === true) {
    add("soldiers", "config", "soldiers.enabled=false in doctrine config");
  }
  return items;
}

/* R237-B · COUNCIL CLASSIFICATION: how the engine reads its fellow organs.
 * ok=true + fresh → ALIVE, ok=true but old → STALE, else DOWN. Pure. */
export function organVerdict({ ok, ageMs, staleMs = 30 * 60_000 } = {}) {
  if (ok !== true) return "DOWN";
  const age = typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : null;
  if (age == null) return "ALIVE";
  return age <= staleMs ? "ALIVE" : "STALE";
}

/* R237-B · MESH VERDICT: the one-word truth of the organ council. Pure. */
export function meshVerdict(organs = []) {
  const list = Array.isArray(organs) ? organs : [];
  if (!list.length) return "MESH-DARK";
  const downs = list.filter((o) => o?.verdict === "DOWN").length;
  const stales = list.filter((o) => o?.verdict === "STALE").length;
  if (downs === list.length) return "MESH-DARK";
  if (downs > 0 || stales > 0) return "MESH-PARTIAL";
  return "MESH-ALIVE";
}

/* ── R245 · DEX-TAKEOVER GATE (pure, the sandbox-distrust law in code) ─────
 * Operator order 2026-10-07 (verbatim intent): "ששום פעולה לא תוגדר ריבונית
 * על הסנדבוקס כי יש לו חיים קצרים" — the sandbox engine is a CONVENIENCE
 * CACHE, never the sovereign home. Trading duty fails over to GitHub CI when
 * the sandbox's custodian anchor goes stale (engine dead) and never races a
 * live engine (fresh anchor = STANDBY). A takeover-gap keeps the failover
 * from hammering a dying host every 30 minutes. Pure + deterministic. */
export function dexTakeoverDue({ anchorAt = null, now, staleMs = 90 * 60_000, lastAt = null, gapMs = 3 * 60 * 60_000 } = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return { due: false, reason: "bad-now" };
  if (anchorAt == null) return { due: true, reason: "no-anchor" };
  const anchorMs = typeof anchorAt === "number" ? anchorAt : Date.parse(anchorAt);
  if (!Number.isFinite(anchorMs)) return { due: true, reason: "anchor-unreadable" };
  if (nowMs - anchorMs > staleMs) {
    if (lastAt == null) return { due: true, reason: "anchor-stale" };
    const lastMs = typeof lastAt === "number" ? lastAt : Date.parse(lastAt);
    if (!Number.isFinite(lastMs) || nowMs - lastMs >= gapMs) return { due: true, reason: "anchor-stale" };
    return { due: false, reason: "takeover-gap" };
  }
  return { due: false, reason: "engine-alive" };
}

/* ── P0-FAILCLOSE · THE MONEY GATE (pure, operator-approved Phase-0) ───────
 * Measured fail-open (2026-10-17T00:25:30Z beat): dex=TAKEOVER-EXECUTED and
 * delegation=DELEGATED in the SAME cycle whose selftestLease verdict was
 * SELFTEST-RAN-RED — the red signal was recorded honestly and ignored, and
 * the money lanes ran BEFORE the selftest step even executed.
 * Law now: GREEN is the ONLY verdict that opens a money lane (dex-takeover,
 * delegation-rail). RED / RUN-TIMEOUT / SKIPPED-CONTENTION / UNREGISTERED /
 * STEP-FAIL / absent — every failed or INCONCLUSIVE state BLOCKS. The
 * observe/selftest lanes keep R339 SKIP-NOT-FAIL semantics; money does not.
 * Pure + deterministic — vector-tested in selftest-moneygate.mjs. */
export function moneyGateOpen({ selftestVerdict = null } = {}) {
  if (selftestVerdict === "SELFTEST-RAN-GREEN") return { open: true, reason: "selftest-green" };
  return { open: false, reason: `selftest-not-green:${selftestVerdict ?? "absent"}` };
}

/* ── T-25 · FILL WINDOW (W12-D: the instrument that was born missing) ──────
 * fills.mjs imported this since birth but it never existed in any commit —
 * the module could not even load, so the fill-capture ledger stayed frozen
 * (measured 2026-10-19: ledger stale since 10-02 while 125 fills/day ran).
 * The honest window math over RAW chain fills (recompute-from-raw law):
 *   - windowDays = span newest→oldest fill (a 24h floor keeps a burst from
 *     reading as an infinite rate; perDayReady only at ≥1 full day);
 *   - realized P&L = pnlFromFills over the full ledger (estate one-body);
 *   - perDay normalization ONLY when perDayReady — never annualize noise;
 *   - edge vs parity in bps (ask = we sold STEEM, bid = we bought STEEM);
 *   - venue share: estate fills/day ÷ venue fills/day (null when venue unknown).
 * Pure, zero network, fully vector-tested (selftest section 54). */
const FILL_DAY_MS = 86_400_000;

export function fillWindow({ fills = [], nowMs = Date.now(), venueVolSteem24h = null, marketFillsPerDay = null, parity = null, sbdUsd = null } = {}) {
  const rows = (Array.isArray(fills) ? fills : [])
    .filter((f) => f && Number.isFinite(Number(f.at)) && Number.isFinite(Number(f.steem)) && Number.isFinite(Number(f.sbd)))
    .map((f) => ({ seq: f.seq, at: Number(f.at), side: String(f.side ?? ""), steem: Number(f.steem), sbd: Number(f.sbd) }))
    .sort((a, b) => a.at - b.at);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const law = "נתח-מילויים מדוד מול-כל-השוק — החלון נבנה מאמת-השרשרת שרשרת-fill_order, realized מחושב-מחדש מה-raw";

  if (!rows.length) {
    return { fillsTotal: 0, windowDays: null, lastFillAt: null, fills24h: 0, volSteem24h: 0, volSbd24h: 0,
      buys24h: 0, sells24h: 0, avgAskUnit: null, avgBidUnit: null, parity: parity ?? null,
      askEdgeBps: null, bidEdgeBps: null, realizedSbd: 0, realizedUsd: null, realizedPerDaySbd: null,
      perDayReady: false, positionSteem: 0, positionAvgCost: null, unbasedSteem: 0,
      fillSharePct: null, venueFillsPerDay: marketFillsPerDay ?? null, venueVolSteem24h: venueVolSteem24h ?? null, law };
  }

  const newestTs = rows[rows.length - 1].at;
  const oldestTs = rows[0].at;
  const windowDays = Math.max((nowMs - oldestTs) / FILL_DAY_MS, (newestTs - oldestTs) / FILL_DAY_MS, 0);

  const dayAgo = nowMs - FILL_DAY_MS;
  const rows24h = rows.filter((f) => f.at >= dayAgo);
  const buys24h = rows24h.filter((f) => f.side === "bid");
  const sells24h = rows24h.filter((f) => f.side === "ask");
  const volSteem24h = r6(rows24h.reduce((s, f) => s + f.steem, 0));
  const volSbd24h = r6(rows24h.reduce((s, f) => s + f.sbd, 0));

  const unit = (fs, pick) => { const w = fs.filter((f) => f[pick] > 0); return w.length ? r6(w.reduce((s, f) => s + f.sbd / f[pick], 0) / w.length) : null; };
  const avgBidUnit = unit(buys24h, "steem");   /* SBD per STEEM paid on buys  */
  const avgAskUnit = unit(sells24h, "steem");  /* SBD per STEEM taken on sells */
  const par = Number(parity) > 0 ? Number(parity) : null;
  const bps = (u) => (u != null && par != null ? Math.round(((u - par) / par) * 1e4) : null);

  const pnl = pnlFromFills(rows);
  const perDayReady = windowDays >= 1 && pnl.realizedSbd != null;
  const realizedPerDaySbd = perDayReady ? r6(pnl.realizedSbd / windowDays) : null;
  const realizedUsd = pnl.realizedSbd != null && Number(sbdUsd) > 0 ? r6(pnl.realizedSbd * Number(sbdUsd)) : null;

  /* venue share: estate fills/day estimate ÷ venue fills/day (capped, honest
   * null when the venue meter is absent) */
  const ourPerDay = windowDays > 0 ? rows.length / windowDays : null;
  const fillSharePct = ourPerDay != null && Number(marketFillsPerDay) > 0
    ? Math.min(100, Math.round((ourPerDay / (Number(marketFillsPerDay) + ourPerDay)) * 1e4) / 100)
    : null;

  return {
    fillsTotal: rows.length,
    windowDays: Math.round(windowDays * 1e6) / 1e6,
    lastFillAt: new Date(newestTs).toISOString(),
    fills24h: rows24h.length, volSteem24h, volSbd24h,
    buys24h: buys24h.length, sells24h: sells24h.length,
    avgAskUnit, avgBidUnit, parity: par,
    askEdgeBps: bps(avgAskUnit), bidEdgeBps: bps(avgBidUnit),
    realizedSbd: pnl.realizedSbd, realizedUsd, realizedPerDaySbd,
    perDayReady,
    positionSteem: pnl.positionSteem, positionAvgCost: pnl.positionAvgCost,
    unbasedSteem: pnl.unbasedSteem,
    fillSharePct, venueFillsPerDay: marketFillsPerDay ?? null, venueVolSteem24h: venueVolSteem24h ?? null,
    law,
  };
}

/* W12-c/D · sweep gate for the fleet fill capture: a full estate sweep (N ×
 * get_account_history) is cadence-bounded — true only when the last sweep is
 * absent or older than minGapMs (default 30min). Pure. */
export function shouldFleetSweep(lastSweepAt, nowMs = Date.now(), minGapMs = 30 * 60_000) {
  if (lastSweepAt == null) return true;
  const t = Date.parse(String(lastSweepAt));
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= minGapMs;
}

/* ═══ W17 · BACKING-FLOOR LAW (חוק-רצפת-הגיבוי · owner-approved, T29 spec) ═══
 * The T27-measured root: the exchange arm sold custody anchor assets above the
 * float WITHOUT crediting the credit (CSTEEM custody-deficit). The owner
 * approved the prevention law ("כן תתקין") and transferred implementation to
 * the W14 lane. THE LAW (per-asset 1:1): a custody sale of an anchor asset
 * (STEEM→SBD · SBD→STEEM · market sale) may broadcast ONLY when
 *   measured[asset] − sale_amount ≥ outstanding[credit]
 * with the refusal verdict carrying the detail (steem_after=X < csteem=Y) —
 * never a guess, never a crash (the MONEYGATE fail-closed family). The single
 * override lane: an explicit owner order ref (recorded in the verdict).
 * PURE — zero IO, zero deps (the lib's law); the custody-credit state reader
 * + the refusal journal live in custody-credit.mjs (the wrapper). */
export function backingFloorLaw(asset, saleAmount, measuredAvailable, outstanding, overrideRef = null) {
  const isSteem = asset === "STEEM";
  const isSbd = asset === "SBD";
  if (!isSteem && !isSbd) return { allow: false, verdict: "UNKNOWN-ASSET", detail: { asset: asset ?? null } };
  const sale = Number(saleAmount);
  const measured = Number(measuredAvailable);
  const floor = Number(outstanding);
  if (!Number.isFinite(sale) || !Number.isFinite(measured) || !Number.isFinite(floor)) {
    return { allow: false, verdict: "MEASUREMENT-GAP", detail: { asset: isSteem ? "STEEM" : "SBD", sale, measured, floor } };
  }
  const after = Math.round((measured - sale) * 1e6) / 1e6;
  const detail = isSteem
    ? { asset: "STEEM", steem_after: after, csteem: floor }
    : { asset: "SBD", sbd_after: after, csbd: floor };
  if (overrideRef) return { allow: true, verdict: "OVERRIDE-RECORDED", detail: { ...detail, overrideRef: String(overrideRef).slice(0, 80) } };
  if (after >= floor) return { allow: true, verdict: "BACKING-FLOOR-OK", detail };
  return { allow: false, verdict: "BACKING-FLOOR-REFUSED", detail };
}
