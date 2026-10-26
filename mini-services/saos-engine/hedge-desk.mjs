/**
 * hedge-desk.mjs — W28-b · THE HEDGE DESK (AutoHedge-adopted advisory layer)
 * Owner trace 1a15cc9fb5220725: "בחן... github.com/The-Swarm-Corporation/AutoHedge
 * ...נצל מה שניתן בהתאמה לריבונות האוטונומית שלנו".
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT (measured from the upstream repo, shallow-clone /home/z/repos/AutoHedge):
 * AutoHedge = Python/swarm multi-agent hedge fund (Director → Quant → Risk
 * Manager → Execution, solana venue). SAME VERDICT CLASS AS Vibe-Trading
 * (W27-d): no Python runtime adoption inside the reaper-hostile sandbox —
 * the DESK is the PATTERN PORT, native to this organ, zero new dependencies:
 *   - Director  → the desk reads only MEASURED state (fills.json +
 *                 hyper-grid.json + externalQuotesState()) — every "thesis"
 *                 is a typed reason, never an invented narrative.
 *   - Quant     → book statistics (24h buy/sell flow, bid/ask edge bps,
 *                 internal-vs-external cross gap).
 *   - Risk Mgr  → the ADOPTED gates (autohedge/experimental/market_making.py
 *                 MarketMakingConfig, mapped to our doctrine units):
 *       max_inventory_exposure 0.20 → 24h flow imbalance ceiling (one-sided
 *                                     pressure = TRIM advisory)
 *       rebalance_threshold    0.10 → anchor-gap re-tier trigger (RETIER)
 *       min_profit_threshold   0.002 → minimum book edge (20 bps) → WIDEN
 *       (drawdown guard)            → realized-per-day SBD floor → HALT
 *       (doctrine RC floor 25)      → capacity floor breach → HALT
 *   - Execution → ADVISORY ONLY. The desk has ZERO signing authority;
 *     verdicts feed the operator/doctrine layer that already owns every cap
 *     (T2, G41, VF1, RC floors). "Risk-first design" without duplicated
 *     execution power — the honest adoption line.
 *
 * VERDICT MACHINE: GO | TRIM | WIDEN | RETIER | HALT | ABSTAIN.
 * Priority: HALT > TRIM > WIDEN/RETIER > GO. ABSTAIN (honest absence —
 * no anchor, stale/missing fills) is a first-class verdict, never a guess.
 *
 * LAWS: read-only inputs; atomic writes (tmp+rename); verdict CHANGES
 * journaled to receipts/hedge-desk.jsonl (+ 60min heartbeat); HALT/entry
 * changes hit events.jsonl; advisoryOnly:true is part of the persisted
 * shape FOREVER (a future reader must never mistake this for an executor).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { externalQuotesState } from "./external-quotes.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const HD_FILE = path.join(STATE, "hedge-desk.json");
const RECEIPTS = path.join(DIR, "receipts", "hedge-desk.jsonl");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

export const HD_LAW =
  "advisory-only · zero signing authority · verdicts feed the doctrine layer that owns every cap (T2/G41/VF1/RC-floors) — AutoHedge risk-first design without duplicated execution power";

export const HD_DEFAULTS = {
  cadenceSec: 300,          // one desk cycle per 5 minutes (gentle, local reads only)
  maxImbalance: 0.6,        // AutoHedge max_inventory_exposure analog: |buys-sells|/(buys+sells)
  minEdgeBps: 20,           // AutoHedge min_profit_threshold 0.002 → 20 bps book-edge floor
  anchorGapReTierBps: 300,  // AutoHedge rebalance_threshold analog: internal book vs external cross
  maxDayDrawdownSbd: 1.0,   // realizedPerDaySbd below this = HALT advisory
  rcFloorPct: 25,           // the standing doctrine RC floor — breach = HALT advisory
  staleFillsMs: 26 * 3600_000, // fills older than the 24h window + slack = ABSTAIN
  minFlowForSkew: 6,        // below this 24h flow the imbalance gate stays silent (noise floor)
};

const RANK = { GO: 0, WIDEN: 1, RETIER: 1, TRIM: 2, HALT: 3 };

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/* W28-b PURE VERDICT MACHINE (selftest section 60): deterministic, no I/O. */
export function computeDeskVerdict(inputs, cfg) {
  const c = { ...HD_DEFAULTS, ...(cfg ?? {}) };
  const reasons = [];
  const gates = {};

  const anchor = inputs?.anchor ?? null;
  const fills = inputs?.fills ?? null;
  const hyper = inputs?.hyper ?? null;

  const implied = num(anchor?.impliedUnitSbdPerSteem);
  const anchorOk = implied > 0;
  /* fills validity = ANY measured flow field present (fills24h counter OR the
   * buys/sells pair) — resilient to summary-field schema drift; true absence
   * (null/empty object) still ABSTAINs honestly. */
  const fillsOk = !!fills && [fills.fills24h, fills.buys24h, fills.sells24h].some((v) => Number.isFinite(Number(v)));
  const fillsFresh = fillsOk && Date.now() - (Date.parse(fills?.at) || 0) <= c.staleFillsMs;

  gates.anchor = anchorOk ? "OK" : "ABSENT";
  gates.fills = fillsFresh ? "OK" : fillsOk ? "STALE" : "ABSENT";
  if (!anchorOk) reasons.push({ type: "ABSTAIN", gate: "anchor", why: "no real-money implied unit (external quotes absent or zero)" });
  if (!fillsFresh) reasons.push({ type: "ABSTAIN", gate: "fills", why: fillsOk ? "fills stale beyond the 24h window + slack" : "fills state absent" });
  if (!anchorOk || !fillsFresh) {
    return { verdict: "ABSTAIN", reasons, gates, advisoryOnly: true, law: HD_LAW };
  }

  const buys = num(fills.buys24h);
  const sells = num(fills.sells24h);
  const flow = buys + sells;
  const imbalance = flow > 0 ? Math.abs(buys - sells) / flow : 0;
  gates.flow24h = flow;
  gates.imbalance = Math.round(imbalance * 1000) / 1000;
  if (flow >= c.minFlowForSkew && imbalance > c.maxImbalance) {
    reasons.push({
      type: "TRIM", gate: "inventory-skew",
      why: `24h flow one-sided (${buys}B/${sells}S, imbalance ${gates.imbalance} > ${c.maxImbalance}) — AutoHedge max_inventory_exposure analog`,
    });
  }

  const edges = [num(fills.bidEdgeBps), num(fills.askEdgeBps)].filter((v) => v > 0);
  if (edges.length) {
    const minEdge = Math.min(...edges);
    gates.minEdgeBps = minEdge;
    if (minEdge < c.minEdgeBps) {
      reasons.push({
        type: "WIDEN", gate: "book-edge",
        why: `book edge ${minEdge}bps < ${c.minEdgeBps}bps floor — AutoHedge min_profit_threshold analog (maker profit at risk)`,
      });
    }
  }

  const avgBid = num(fills.avgBidUnit);
  const avgAsk = num(fills.avgAskUnit);
  if (avgBid > 0 && avgAsk > 0) {
    const mid = (avgBid + avgAsk) / 2;
    const gapBps = Math.abs(mid - implied) / implied * 10000;
    gates.anchorGapBps = Math.round(gapBps);
    if (gapBps > c.anchorGapReTierBps) {
      reasons.push({
        type: "RETIER", gate: "anchor-gap",
        why: `internal book mid drifts ${gates.anchorGapBps}bps off the external cross (${implied} SBD/STEEM) > ${c.anchorGapReTierBps}bps — AutoHedge rebalance_threshold analog`,
      });
    }
  }

  const realizedPerDay = num(fills.realizedPerDaySbd);
  gates.realizedPerDaySbd = r6(realizedPerDay);
  if (realizedPerDay < -c.maxDayDrawdownSbd) {
    reasons.push({
      type: "HALT", gate: "day-drawdown",
      why: `realized per day ${realizedPerDay} SBD < -${c.maxDayDrawdownSbd} — drawdown guard`,
    });
  }

  const rcPct = num(hyper?.rcPct);
  gates.rcPct = rcPct || null;
  if (rcPct > 0 && rcPct < c.rcFloorPct) {
    reasons.push({
      type: "HALT", gate: "rc-floor",
      why: `rcPct ${rcPct}% below the doctrine floor ${c.rcFloorPct}% — capacity breach outranks every other gate`,
    });
  }

  const verdict = reasons.length ? reasons.reduce((best, r) => (RANK[r.type] > RANK[best] ? r.type : best), "GO") : "GO";
  return {
    verdict, reasons, gates,
    measured: { buys24h: buys, sells24h: sells, minEdgeBps: gates.minEdgeBps ?? null, anchorGapBps: gates.anchorGapBps ?? null, realizedPerDaySbd: gates.realizedPerDaySbd, rcPct: gates.rcPct ?? null },
    advisoryOnly: true, law: HD_LAW,
  };
}

/* the desk loop — reads ONLY measured local state + the exported anchor state */
function readInputs() {
  return {
    fills: readJson(path.join(STATE, "fills.json")),
    hyper: readJson(path.join(STATE, "hyper-grid.json")),
    anchor: externalQuotesState(),
  };
}

export async function tickDesk() {
  try {
    const prev = readJson(HD_FILE);
    const out = { ...computeDeskVerdict(readInputs()), at: new Date().toISOString(), cadenceSec: HD_DEFAULTS.cadenceSec };
    const changed = !prev || prev.verdict !== out.verdict;
    if (changed) {
      out.since = out.at;
      appendLine(RECEIPTS, out);
      appendLine(EVENTS_FILE, { type: "hedge-desk.verdict", at: out.at, verdict: out.verdict, reasons: out.reasons.map((r) => `${r.type}:${r.gate}`) });
    } else {
      out.since = prev.since ?? prev.at ?? out.at;
      const hbAge = Date.now() - (Date.parse(prev.lastHeartbeatAt ?? 0) || 0);
      if (hbAge >= 60 * 60_000) {
        out.lastHeartbeatAt = out.at;
        appendLine(RECEIPTS, { verdict: out.verdict, at: out.at, heartbeat: true, gates: out.gates });
      } else out.lastHeartbeatAt = prev.lastHeartbeatAt ?? null;
    }
    writeJson(HD_FILE, out);
    return out;
  } catch (e) {
    writeJson(HD_FILE, { ...(readJson(HD_FILE) ?? {}), lastError: String(e?.message ?? e).slice(0, 140), lastErrorAt: new Date().toISOString() });
    return null;
  }
}

export function hedgeDeskState() {
  const st = readJson(HD_FILE);
  if (!st) return { advisoryOnly: true, verdict: "NO-READ-YET", law: HD_LAW };
  const ageSec = Math.round((Date.now() - (Date.parse(st.at) || 0)) / 1000);
  return { ...st, ageSec, status: ageSec <= (st.cadenceSec ?? 300) * 4 ? "LIVE" : "STALE" };
}

let timer = null;
const G = globalThis;

export function startHedgeDesk() {
  if (G.__saosHedgeDeskTimer) clearInterval(G.__saosHedgeDeskTimer);
  timer = setInterval(() => { void tickDesk(); }, HD_DEFAULTS.cadenceSec * 1000);
  G.__saosHedgeDeskTimer = timer;
  void tickDesk();
  return { started: true, cadenceSec: HD_DEFAULTS.cadenceSec };
}
