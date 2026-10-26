/**
 * grid.mjs — deterministic trigger-grid: דבר-גורר-דבר (thing drags thing).
 * 4 micro-grids as economic executors + JSONL event bus + loop guards.
 * Pure core here (injected market/inventory/clock); runner in daily.mjs.
 */
import { guardDepth, dragK } from "./lib.mjs";

export const STRATEGIES = ["mm-grid", "micro-arb", "sweep", "anchor-quote"];

/* one deterministic tick. Injected: refPrice (external parity), internalFeed,
 * inventory {steem,sbd}, runCount, now. Emits events; never mutates chain. */
export function tick({ refPrice, internalFeed, inventory, runCount = 0, now, depth = 0, fires = 0 }) {
  const ev = [];
  const push = (type, payload) => ev.push({ type, at: now, ...payload });
  const guard = guardDepth(depth, fires);
  if (!guard.ok) { push("grid.halted", { reason: guard.reason, runCount }); return { events: ev, fills: [], feesMu: 0 }; }
  if (!(refPrice > 0)) { push("grid.no-market", { reason: "no-ref-price", runCount }); return { events: ev, fills: [], feesMu: 0 }; }

  const k = dragK(internalFeed > 0 ? Math.abs(refPrice - internalFeed) / internalFeed * 10000 : 0);
  push("grid.tick", { runCount, refPrice, internalFeed, dragK: k, inv: inventory });

  const fills = [];
  let feesMu = 0;

  // mm-grid: two-sided ladder around ref; sim-fills when internal feed crosses levels
  const mmLevel = refPrice * (1 - 0.001 * k);
  if (internalFeed > 0 && internalFeed <= mmLevel && inventory.sbd > 0.5) {
    const amt = Math.min(0.5, inventory.sbd);
    fills.push({ grid: "mm-grid", side: "bid", steem: amt / mmLevel, sbd: amt, unit: mmLevel });
    feesMu += Math.round(amt * 1e6 * 0.001);
    push("grid.fill", { grid: "mm-grid", side: "bid", unit: mmLevel, real: false });
  }
  const askLevel = refPrice * (1 + 0.001 * k);
  if (internalFeed > 0 && internalFeed >= askLevel && inventory.steem > 0.5) {
    const amt = Math.min(0.5, inventory.steem);
    fills.push({ grid: "mm-grid", side: "ask", steem: amt, sbd: amt * askLevel, unit: askLevel });
    feesMu += Math.round(amt * 1e6 * 0.001);
    push("grid.fill", { grid: "mm-grid", side: "ask", unit: askLevel, real: false });
  }

  // micro-arb: internal feed vs external parity gap
  if (internalFeed > 0) {
    const gapBps = Math.abs(refPrice - internalFeed) / internalFeed * 10000;
    if (gapBps >= 100) push("arb.signal", { grid: "micro-arb", gapBps: Math.round(gapBps), dir: refPrice > internalFeed ? "sell-external" : "buy-external" });
  }

  // sweep: dust harvest signal (micro-amounts parked at bounds)
  push("sweep.scan", { grid: "sweep", dustSteem: Math.max(0, inventory.steem - Math.floor(inventory.steem)) });

  // anchor-quote: steady two-sided quote for the weave anchor (cp#813 lineage)
  push("anchor.quote", { grid: "anchor-quote", bid: refPrice * (1 - 0.002 * k), ask: refPrice * (1 + 0.002 * k) });

  // fee meter spawn → funds the next spawn (thing-dragging-thing)
  if (feesMu > 0) push("fee.spawn", { mu: feesMu, to: "R-FEE-SPAWN" });

  return { events: ev, fills, feesMu, dragK: k };
}

/* apply events to state (pure fold) */
export function fold(state, tickRes) {
  const s = {
    ...state,
    runCount: (state.runCount ?? 0) + 1,
    simFills: (state.simFills ?? 0) + (tickRes.fills?.length ?? 0),
    simFeesMu: (state.simFeesMu ?? 0) + (tickRes.feesMu ?? 0),
    asof: tickRes.events[0]?.at ?? state.asof,
    /* R269 · the fleet reader (fleet.mjs) judges grid-tick liveness by `at` —
     * the field rename to `asof` alone measured the agent DEAD while it was
     * alive (runCount kept rising). Both names stamped: contract kept. */
    at: tickRes.events[0]?.at ?? state.at,
    market: { refPrice: tickRes.events[0]?.refPrice ?? null, source: "engine", stale: false },
  };
  return s;
}

export const activeGrids = () => STRATEGIES.map((id) => ({ id, strategy: id, active: true, inventoryMu: 0, pnlSimMu: 0 }));
