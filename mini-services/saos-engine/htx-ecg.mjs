/**
 * htx-ecg.mjs — W13 · THE EXCHANGE ECONOMICS GUARD (משמר-הכלכלה-על-הבורסה).
 *
 * OPERATOR ORDER 2026-10-19 (verbatim distilled): "בחן היטב ... כמה עמלות
 * וזה שלא נפסיד שנרוויח ונקבל יתרון שוק".
 *
 * THE LAW: a trade may broadcast ONLY when the measured edge clears the
 * measured (or conservatively defaulted) cost of trading, with an explicit
 * profit floor. Fees that eat the edge are a REFUSE, never an EXEC —
 * the default state is refusal, exactly like the chain rails.
 *
 * COST MODEL (honest, conservative):
 *  - round-trip fees = taker on BOTH legs by default (0.2%+0.2% = 40bps —
 *    the HTX regular-user tier; VIP rebates are NOT assumed until measured).
 *  - slippage default 10bps (thin books cost more; this is a floor, not a cap).
 *  - minProfitBps default 5 — the explicit "we PROFIT" floor above break-even.
 *  - every verdict carries breakEvenBps + marginBps so the ledger can be
 *    judged after the fact.
 *
 * PURE MODULE — zero network, zero secrets, fully selftest-pinned.
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Break-even edge (bps) for a round trip.
 * @param {object} p
 * @param {number|null} p.takerBps   taker fee per leg (bps)
 * @param {number|null} p.makerBps   maker fee per leg (bps; informational —
 *        the guard bills BOTH legs as taker, the conservative worst case)
 * @param {number}      p.slippageBps
 * @returns {{roundTripFeesBps:number, slippageBps:number, breakEvenCoreBps:number}}
 */
export function breakEvenBps({ takerBps, slippageBps }) {
  const t = num(takerBps) ?? 20; /* HTX regular tier 0.2% per leg — conservative default, never a rebate guess */
  const s = num(slippageBps) ?? 10;
  const roundTripFeesBps = t * 2; /* enter + exit, both billed as taker */
  return { roundTripFeesBps, slippageBps: s, breakEvenCoreBps: roundTripFeesBps + s };
}

/**
 * The verdict.
 * @param {object} p
 * @param {number|null} p.edgeBps        expected edge of the round trip (bps)
 * @param {number}      [p.takerBps]
 * @param {number}      [p.makerBps]     informational only (see breakEvenBps)
 * @param {number}      [p.slippageBps]
 * @param {number}      [p.minProfitBps] explicit profit floor above break-even (default 5)
 * @returns {{verdict:"EXEC"|"REFUSE", why:string, breakEvenBps:number, marginBps:number,
 *            costModel:{roundTripFeesBps:number, slippageBps:number, minProfitBps:number}}}
 */
export function ecgVerdict({ edgeBps, takerBps, makerBps, slippageBps, minProfitBps = 5 }) {
  const floor = num(minProfitBps) ?? 5;
  const be = breakEvenBps({ takerBps, slippageBps });
  const totalBreakEvenBps = be.breakEvenCoreBps + floor;
  const costModel = {
    roundTripFeesBps: be.roundTripFeesBps,
    slippageBps: be.slippageBps,
    minProfitBps: floor,
  };
  if (num(edgeBps) == null) {
    return { verdict: "REFUSE", why: "edge-not-measured", breakEvenBps: totalBreakEvenBps, marginBps: null, costModel };
  }
  const marginBps = +(edgeBps - totalBreakEvenBps).toFixed(4);
  if (edgeBps <= 0) {
    return { verdict: "REFUSE", why: "edge-not-positive", breakEvenBps: totalBreakEvenBps, marginBps, costModel };
  }
  if (marginBps <= 0) {
    return { verdict: "REFUSE", why: "fees-eat-edge", breakEvenBps: totalBreakEvenBps, marginBps, costModel };
  }
  return { verdict: "EXEC", why: "edge-clears-fees", breakEvenBps: totalBreakEvenBps, marginBps, costModel };
}

/**
 * Pair-level census verdict: is a symbol tradeable at all under the guard?
 * Requires ONLINE state + a positive, finite edge input path. This is the
 * per-pair gate the future executor must pass BEFORE any order shape exists.
 */
export function pairGate({ symbol, state, edgeBps, takerBps, makerBps, slippageBps, minProfitBps }) {
  if (!symbol || typeof symbol !== "string") {
    return { verdict: "REFUSE", why: "no-symbol" };
  }
  if (state !== "online") {
    return { verdict: "REFUSE", why: `state-${state ?? "unknown"}` };
  }
  const v = ecgVerdict({ edgeBps, takerBps, makerBps, slippageBps, minProfitBps });
  return { ...v, symbol };
}
