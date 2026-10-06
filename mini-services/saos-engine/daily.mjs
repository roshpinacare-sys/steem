/**
 * daily.mjs — one-command autonomous cycle (A-8 lineage, T-9 local rebuild,
 * T-12 LIVE EXECUTION: the operator handed the master credential and ordered
 * full autonomous, sovereign operation without operator intervention.
 * T-14 CONTINUOUS LEARNING: the machine reads its own recorded history every
 * cycle, derives evidence-backed lessons, and applies hard-clamped tunings —
 * plus a cadence-gated network scan for growth options (discovery).
 *
 * observe → intel → tick → peg(intel-fed) → convert → execute(SIGN) → soldiers → learn(T-14) → report
 *
 * Fail-isolated steps; every signing op doctrine-capped (signer.mjs);
 * pause button = operator kill-switch (state/exec-pause.json); everything
 * journaled: events.jsonl + exec-log.jsonl (txids, never keys).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  planLadder, planConvert, inventorySkew, parityVerdict, pnlFromFills, classifyStale,
  cycleHealth, cycleFailureBreakdown,
} from "./lib.mjs";
import {
  externalParity, internalFeed, accountState, openOrders, measureAll, fuelToUsdPerDay, marketPulse, rpcCall,
} from "./measure.mjs";
import { tick as gridTick, fold, activeGrids } from "./grid.mjs";
import { runIntel } from "./intel.mjs";
import { executeOps, executeAs, armedConf, execPaused, masterAccount, loadCredential, custodyOf } from "./signer.mjs";
import { writePrediction, evaluateAndJournal, updateBelief, triggerWatch, resolveClaimRole, journalClaimRefusal, claimChainTruth, reconcileOrphans } from "./adaptation.mjs";
import { deploySoldiers, runSoldierGrids, soldiersState, verifySoldierCustody } from "./soldiers.mjs";
import { postDailyReport } from "./promo.mjs";
import { runCurator } from "./curator.mjs";
import { runLearning } from "./learning.mjs";
import { runDiscovery } from "./discovery.mjs";
import { runRecruiter } from "./recruiter.mjs";
import { runEconomics } from "./economics.mjs";
import { runWebIntel } from "./webintel.mjs";
import { runContent } from "./content.mjs";
import { runSocial } from "./army-social.mjs";
import { runRcTank, rcTankState } from "./rctank.mjs";
import { runPayouts, payoutsState } from "./payouts.mjs";
import { runWeave, weaveState } from "./weave.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

const stepWrap = async (name, fn) => {
  const t0 = Date.now();
  try {
    const out = await fn();
    return { name, ok: true, ms: Date.now() - t0, ...out };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) };
  }
};

/* ── T-17 · ENGINE-SIDE SINGLE-FLIGHT + CYCLE-RUN MARKER ────────────────
 * Measured 2026-09-30: the sovereign's 90s HTTP wait died while the engine
 * was still mid-cycle (real multi-vote curate ≈ minutes) — and its busy-flag
 * release let the NEXT cycle overlap the first ON THE SAME ENGINE (a real
 * double-vote window). The engine now owns the truth: a module-level mutex
 * makes concurrent runCycle calls impossible, and a cycle-run.json marker
 * (start + end, try/finally — a killed cycle still closes it) lets the
 * sovereign POLL for completion instead of holding an HTTP wait that any
 * healthy signing cycle outlives. */
let cycleInFlight = false;
let cycleInFlightSince = null;
export function cycleRunning() { return cycleInFlight; }
export function cycleMarker() { return readJson(path.join(STATE, "cycle-run.json"), null); }

export async function runCycle({ now = new Date().toISOString(), persist = true } = {}) {
  if (cycleInFlight) {
    /* typed, pollable, and honest — the sovereign journals this as a skip,
     * never as a fail: nothing malfunctioned, a cycle is already running. */
    return { ok: false, health: "fail", error: "cycle-in-flight", inFlightSince: cycleInFlightSince, startedAt: now, account: ACCOUNT, steps: {} };
  }
  cycleInFlight = true;
  cycleInFlightSince = now;
  const cycleT0 = Date.now();
  const markerFile = path.join(STATE, "cycle-run.json");
  writeJson(markerFile, { running: true, startedAt: now, pid: process.pid });
  const report = { startedAt: now, account: ACCOUNT, steps: {} };
  try {
  let intelOut = null;

  /* 5b · curate (T-13, T-16 PARALLEL): the measured fuel rail is INDEPENDENT
   * of the front chain (own policy + chain reads + own state) — it starts
   * NOW and is joined after convert. Measured 2026-09-30: active voting days
   * burned ~12s of serial candidate-scan per cycle (≈29min/day of
   * sovereignty time) that this parallelism gives back. Fail-isolated. */
  const curateP = stepWrap("curate", async () => {
    const out = await runCurator({ now });
    return { verdict: out.verdict, votes: out.voted?.length ?? 0, txid: out.txid ?? null, vpEff: out.vpEff ?? null, votesToday: out.votesTodayCount ?? 0, error: out.error ?? null };
  });

  /* 1 · observe: parity + inventory + fills + rails fuel */
  report.steps.observe = await stepWrap("observe", async () => {
    const [par, feed, acc, oo, meas] = await Promise.all([
      externalParity(), internalFeed(), accountState(ACCOUNT), openOrders(ACCOUNT), measureAll(ACCOUNT),
    ]);
    const fillsPnl = pnlFromFills(meas.fills);
    const fuelUsd = acc.ok && acc.totalVestingShares && par.steemUsd > 0
      ? fuelToUsdPerDay(meas.fuel.curationVestsPerDay, acc.totalVestingShares, acc.totalVestingFund, par.steemUsd)
      : null;
    const authorUsdPerDay = par.sbdUsd > 0 ? Math.round(meas.fuel.authorSbdPerDay * par.sbdUsd * 1e4) / 1e4 : null;
    const band = parityVerdict(par.parity, feed.median);
    const data = {
      account: ACCOUNT,
      parity: par, feed: feed.median, band,
      steemUsd: par.steemUsd ?? null, sbdUsd: par.sbdUsd ?? null,
      inventory: acc.ok ? { steem: acc.steem, sbd: acc.sbd, spOwn: acc.spOwn, rcPct: acc.rcPct } : null,
      ordersOk: oo.ok, orders: oo.orders,
      fills: meas.fills.length, lastFillAt: meas.lastFillAt,
      pnl: fillsPnl,
      fuel: { ...meas.fuel, fuelUsdPerDay: fuelUsd, authorUsdPerDay, histLen: meas.histLen, node: meas.node },
    };
    if (data.fuel.curationOps === 0 && data.fuel.authorOps === 0) {
      data.fuel.windowNote = "no reward ops inside the measured window — rails dormant, not a parse failure (deep-scan documented separately)";
    }
    if (persist) {
      writeJson(path.join(STATE, "observe.json"), { ...data, at: now });
      appendLine(path.join(STATE, "events.jsonl"), { type: "observe.done", at: now, fills: meas.fills.length, parity: par.parity });
    }
    return { ...data, summary: `parity ${par.parity || "?"} (${par.source}) · fills ${meas.fills.length} · fuel ${fuelUsd ?? "?"}$` };
  });

  const obs = report.steps.observe;

  /* 2 · intel: self-activating decisions (feeds peg + execute + soldiers) */
  report.steps.intel = await stepWrap("intel", async () => {
    intelOut = await runIntel({
      obs: { account: ACCOUNT, band: obs.ok ? obs.band : null, fuel: obs.ok ? obs.fuel : null, inventory: obs.ok ? obs.inventory : null },
      offer: null, convert: null, now,
    });
    return {
      verdict: `DECISIONS:${intelOut.decisions.length}`,
      decisions: intelOut.decisions.map((d) => `${d.kind}:${d.decision}`),
      spreadBpsRec: intelOut.spreadBpsRec,
      book: intelOut.book,
    };
  });

  /* 3 · tick: deterministic trigger-grid sim */
  report.steps.tick = await stepWrap("tick", async () => {
    const prev = readJson(path.join(STATE, "state.json"), { runCount: 0, simFills: 0, simFeesMu: 0 });
    const inv = obs.ok && !obs.error ? { steem: obs.inventory?.steem ?? 0, sbd: obs.inventory?.sbd ?? 0 } : { steem: 0, sbd: 0 };
    const res = gridTick({
      refPrice: obs.ok ? obs.parity.parity : 0,
      internalFeed: obs.ok ? obs.feed : 0,
      inventory: inv, runCount: prev.runCount, now,
    });
    const st = fold(prev, res);
    if (persist) {
      // T-15: the tick's recorded output must carry its own timestamp —
      // the fleet registry reads state.json.at as the liveness evidence
      writeJson(path.join(STATE, "state.json"), { ...st, at: now, grids: activeGrids() });
      for (const e of res.events) appendLine(path.join(STATE, "events.jsonl"), e);
    }
    return { runCount: st.runCount, simFills: st.simFills, simFeesMu: st.simFeesMu, events: res.events.length };
  });

  /* 4 · peg: parity-anchored offer plan (skew + floor law), intel-fed spread */
  report.steps.peg = await stepWrap("peg", async () => {
    if (!obs.ok || !(obs.parity.parity > 0)) {
      const blocked = { verdict: "NO-PARITY", blocker: ["observe-failed"], at: now };
      if (persist) writeJson(path.join(STATE, "offer.json"), { ...blocked, publishedAt: now });
      return { verdict: "NO-PARITY", blocker: ["observe-failed"] };
    }
    const inv = obs.inventory ?? { steem: 0, sbd: 0 };
    const skew = inventorySkew(inv.steem, inv.sbd, obs.parity.parity);
    const live = obs.orders ?? [];
    const staleCls = classifyStale(live, obs.parity.parity);
    const spreadBps = intelOut?.spreadBpsRec ?? Math.abs(obs.band?.bps ?? 0);
    // T-12 liquidity law: deploy ≤ 60% of tradable capital — never starve the
    // fleet (soldier top-ups, fees, reserves). Deployed counts only OUR live
    // orders; fills free budget automatically (thing-drags-thing).
    const deployedAsks = live.filter((o) => o.side === "ask").reduce((s, o) => s + Number(String(o.base).split(" ")[0] || 0), 0);
    const deployedBids = live.filter((o) => o.side === "bid").reduce((s, o) => s + Number(String(o.base).split(" ")[0] || 0), 0);
    const maxDeploySteem = 0.6 * (inv.steem + deployedAsks);
    const maxDeploySbd = 0.6 * (inv.sbd + deployedBids);
    const askBudget = Math.max(0, Math.min(inv.steem, maxDeploySteem - deployedAsks));
    const bidBudget = Math.max(0, Math.min(inv.sbd - 0.5, maxDeploySbd - deployedBids));
    /* T-19: LIVE BOOK + CHAIN ANCHOR — the ladder must see the market it
     * quotes into. One bounded book read (50 levels); the witness feed is
     * the flow tranche's honest floor (the only live SBD↔STEEM anchor). */
    let book = null;
    try {
      const ob = await rpcCall("condenser_api.get_order_book", [50]);
      if (ob.ok && ob.result) {
        const bestAsk = ob.result.asks?.[0]?.real_price ? Number(ob.result.asks[0].real_price) : null;
        const bestBid = ob.result.bids?.[0]?.real_price ? Number(ob.result.bids[0].real_price) : null;
        book = { bestAsk, bestBid, askDepthSteem: Math.round(ob.result.asks?.reduce((s, a) => s + (a.steem || 0), 0) / 1000 * 1e3) / 1e3 || null, bidDepthSbd: Math.round(ob.result.bids?.reduce((s, b) => s + (b.sbd || 0), 0) / 1000 * 1e3) / 1e3 || null, at: now };
      }
    } catch { /* book read failed → flow tranche simply inactive this run */ }
    const confPeg = armedConf();
    const flowCfg = confPeg.flow ?? {};
    const plan = planLadder({
      parity: obs.parity.parity,
      askBudgetSteem: askBudget,
      bidBudgetSbd: bidBudget,
      spreadBps, skew, now,
      bestBid: book?.bestBid ?? null, bestAsk: book?.bestAsk ?? null,
      feedAnchor: obs.feed > 0 ? obs.feed : null,
      flowTranchePct: flowCfg.tranchePct ?? 0.2,
      flowSpacingBps: flowCfg.spacingBps ?? 15,
      flowLevels: flowCfg.levels ?? 4,
      /* T-19 REQUOTE LAW: the flow layer re-places its OWN reserved tranche
       * every cycle (its previous levels get cancelled in the same execute) —
       * fixed 12% of inventory, independent of the 60% residual law. */
      flowAskBudgetSteem: (flowCfg.fixedSteemPct ?? 0.12) * Math.max(0, inv.steem ?? 0),
      flowBidBudgetSbd: (flowCfg.fixedSbdPct ?? 0.12) * Math.max(0, (inv.sbd ?? 0) - 0.5),
    });
    /* T-19 MARKET PULSE — the network measured, 30-min cadence, fail-isolated.
     * The whole market does ~49 fills/24h (measured): this number is the
     * honest ceiling of any capture strategy on this venue, and the cockpit
     * must show it instead of a promise. */
    let pulse = null;
    const pulsePrev = readJson(path.join(STATE, "market.json"), null);
    const pulseAge = pulsePrev?.at ? Date.now() - Date.parse(pulsePrev.at) : Infinity;
    if (pulseAge > 30 * 60_000) {
      try { pulse = await marketPulse({}); writeJson(path.join(STATE, "market.json"), pulse); }
      catch { pulse = pulsePrev; }
    } else pulse = pulsePrev;
    const offer = {
      verdict: plan.verdict, parityBps: obs.band?.bps ?? null,
      blocker: plan.blocker, plan: { asks: plan.asks, bids: plan.bids, flowAsks: plan.flowAsks ?? [], flowBids: plan.flowBids ?? [] },
      flow: plan.flow ?? null,
      book,
      market: pulse,
      marks: { paritySbdPerSteem: Math.round(obs.parity.parity * 1e6) / 1e6, source: obs.parity.source, lowConfidence: !!obs.parity.lowConfidence, internalFeed: Math.round(obs.feed * 1e6) / 1e6, dragK: plan.dragK, floor: plan.floor, ceiling: plan.ceiling, spreadBpsFed: spreadBps },
      skew, stale: { count: staleCls.stale.length, orderids: staleCls.stale.map((o) => o.orderid) },
      liquidity: { deployedAsks: Math.round(deployedAsks * 1e3) / 1e3, deployedBids: Math.round(deployedBids * 1e3) / 1e3, askBudget: Math.round(askBudget * 1e3) / 1e3, bidBudget: Math.round(bidBudget * 1e3) / 1e3, deployCap: 0.6 },
      publishedAt: now,
    };
    if (persist) {
      writeJson(path.join(STATE, "offer.json"), offer);
      appendLine(path.join(STATE, "events.jsonl"), { type: "offer.published", at: now, verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length, flowAsks: plan.flowAsks?.length ?? 0, flowBids: plan.flowBids?.length ?? 0, bestAsk: book?.bestAsk ?? null, bestBid: book?.bestBid ?? null });
    }
    return { verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length, flowAsks: plan.flowAsks?.length ?? 0, flowBids: plan.flowBids?.length ?? 0, staleCount: staleCls.stale.length, skew: skew.skew, book, market: pulse ? { tradesPerDay: pulse.tradesPerDay, spreadBps: pulse.book?.spreadBps ?? null } : null, liquidity: offer.liquidity };
  });

  /* 5 · convert-plan: D-023 PSM hysteresis (SBD face-$1 edge) */
  report.steps.convert = await stepWrap("convert", async () => {
    const prev = readJson(path.join(STATE, "convert-state.json"), { armed: false, pendingSbd: 0 });
    const inv = obs.ok ? (obs.inventory ?? { sbd: 0 }) : { sbd: 0 };
    const marketSbdUsd = obs.ok ? (obs.sbdUsd ?? 0) : 0;
    const plan = planConvert({
      liquidSbd: inv.sbd ?? 0, parity: obs.ok ? obs.parity.parity : 0,
      marketSbdUsd, previouslyArmed: !!prev.armed, pendingSbd: prev.pendingSbd ?? 0,
    });
    const impliedSbdUsd = obs.ok && (obs.steemUsd ?? 0) > 0 && obs.feed > 0
      ? Math.round((obs.steemUsd / obs.feed) * 1e6) / 1e6 : null;
    const out = { ...plan, marketSbdUsd: Math.round(marketSbdUsd * 1e6) / 1e6, impliedSbdUsd, marketSourceNote: marketSbdUsd > 0 ? "external-measured" : "no-external-SBD-market (delisted binance/poloniex/upbit/mexc) — HOLD is honest", at: now };
    if (persist) {
      writeJson(path.join(STATE, "convert-plan.json"), out);
      writeJson(path.join(STATE, "convert-state.json"), { armed: plan.verdict === "CONVERT-PLAN", pendingSbd: prev.pendingSbd ?? 0 });
      appendLine(path.join(STATE, "events.jsonl"), { type: "convert.planned", at: now, verdict: plan.verdict, edgeBps: plan.edgeBps, amountSbd: plan.amountSbd });
    }
    return { verdict: plan.verdict, amountSbd: plan.amountSbd, edgeBps: plan.edgeBps, marketSbdUsd: out.marketSbdUsd, impliedSbdUsd: out.impliedSbdUsd, marketSourceNote: out.marketSourceNote };
  });

  /* join the parallel curate branch here (it never gates the front chain) */
  report.steps.curate = await curateP;

  /* 6 · execute (SIGNING — the X-1 rail, engine-held, doctrine-capped).
   * T-16 CRED GATE FIRST: when the credential is missing this step used to
   * burn ~1.7s of accountState reads before executeOps discovered the typed
   * absence — 144 cycles/day of doomed network work. Fail fast (same typed
   * error the classifier expects), zero network. */
  report.steps.execute = await stepWrap("execute", async () => {
    const conf = armedConf();
    if (!conf.armed) return { verdict: "DISARMED", reason: "standing-order-off" };
    if (execPaused()) return { verdict: "OPERATOR-PAUSED", reason: "kill-switch" };
    loadCredential(); // typed CREDENTIAL-MISSING here — before ANY network read

    /* T-19 OPS BUDGET (the honest cost of activity): every order op costs RC
     * and presence — the doctrine now JOURNALS its own throughput. A day cap
     * keeps the churn bounded while the cockpit shows the meter. */
    const OPS_FILE = path.join(STATE, "order-ops.json");
    const opsDay = readJson(OPS_FILE, { day: null, opsToday: 0, lastRcPct: null });
    const today = now.slice(0, 10);
    if (opsDay.day !== today) { opsDay.day = today; opsDay.opsToday = 0; }
    const opsDayCap = conf.opsDayCap ?? 1500;
    const maxOpsPerCycle = conf.maxOpsPerCycle ?? 44;

    /* T-19 OURS-TRACKING (the self-competition guard, measured live): the
     * account's open orders include the SECOND SIGNER's orders — cancelling
     * "stale" ones blindly would cancel a co-signer's book and start a
     * churn-war on our own account. Only orders THIS engine created are
     * ever cancel candidates. */
    const OURS_FILE = path.join(STATE, "our-orders.json");
    const ours = readJson(OURS_FILE, { orderids: [] });
    const oursSet = new Set((ours.orderids ?? []).map((o) => (typeof o === "object" ? o.id : o)));
    /* T-19b HYPER-GRID: the hyper tranche belongs to the high-frequency layer
     * (order-id partition [2.1e9, 4.29e9]) — the cycle NEVER cancels it, and
     * when the hyper layer is enabled the cycle stops touching the flow
     * tranche entirely (single owner of the mobile layer — no self-war). */
    const hyperSet = new Set((ours.orderids ?? []).filter((o) => typeof o === "object" && o.tranche === "hyper").map((o) => o.id));
    const hyperEnabled = conf.hyperGrid?.enabled === true;
    const offer = readJson(path.join(STATE, "offer.json"), null);
    const staleIds = (offer?.stale?.orderids ?? []).filter((id) => oursSet.has(id) && !hyperSet.has(id));
    /* T-19 REQUOTE: our previous flow-tranche levels are CANCELLED this cycle
     * and re-created at the new front (the mobile layer replaces itself —
     * never additive, never touching the value tranche or the second
     * signer's orders). */
    const prevFlowIds = (ours.orderids ?? []).filter((o) => typeof o === "object" && o.tranche === "flow").map((o) => o.id);
    const flowRequoteIds = hyperEnabled ? [] : prevFlowIds.filter((id) => !staleIds.includes(id));

    /* (c-NEW · R210 §VI/§IX) the claim op is built FIRST in the batch —
     * the maxOpsPerCycle slice truncates the TAIL, so a late-pushed claim
     * could be silently dropped after its prediction was written
     * (adversarial finding A-9). Front-loading makes that impossible.
     * NATURAL TRIGGER MONITOR + PRE-ACTION PREDICTION live here too. */
    const ops = [];
    const rewDec = intelOut?.decisions?.find((d) => d.kind === "rewards" && d.decision === "claim");
    const pend = rewDec?.action ? { steem: rewDec.action.steem ?? 0, sbd: rewDec.action.sbd ?? 0, vests: rewDec.action.vests ?? 0 } : { steem: 0, sbd: 0, vests: 0 };
    triggerWatch(rewDec?.action?.any === true, pend);
    let claimPred = null;
    if (rewDec?.action?.any) {
      const rr = resolveClaimRole({ countConsumption: false }); // plan-side only — hot path counts consumption
      if (rr.failClosed) {
        journalClaimRefusal(rr.reason, { trigger: pend });
      } else {
        claimPred = writePrediction({
          action: "claim_reward_balance",
          adaptationId: rr.adaptationId, ruleVersion: rr.ruleVersion,
          expectedRole: rr.role, roleSource: rr.roleSource, confidence: rr.confidence,
          trigger: pend,
          expectedOutcome: "broadcast accepted + CHAIN INCLUSION of claim_reward_balance signed by POSTING authority with canonical op-id 39",
          falsifier: "valid pending reward + canonical serialization (op-id 39) + broadcast rejection citing posting authority",
        });
        ops.push(["claim_reward_balance", {
          account: ACCOUNT,
          reward_steem: `${(rewDec.action.steem ?? 0).toFixed(3)} STEEM`,
          reward_sbd: `${(rewDec.action.sbd ?? 0).toFixed(3)} SBD`,
          reward_vests: `${(rewDec.action.vests ?? 0).toFixed(6)} VESTS`,
        }]);
      }
    }

    // (a) stale repricing — cancel ONLY our own law-violating orders (D-021, cap 5→12: measured stale pile of 13)
    for (const id of staleIds.slice(0, 12)) {
      ops.push(["limit_order_cancel", { owner: ACCOUNT, orderid: id }]);
    }
    // (a2) T-19 flow requote — cancel our previous flow levels (mobile layer), cap 12
    for (const id of flowRequoteIds.slice(0, 12)) {
      ops.push(["limit_order_cancel", { owner: ACCOUNT, orderid: id }]);
    }
    // (b) fresh ladder from LIVE liquid, intel-capped (per-op CLAMPED to caps —
    // a cap must shrink an order, never silently skip the whole ladder side)
    let createdIds = [];
    if (offer?.plan) {
      const acc = await accountState(ACCOUNT);
      const liquidSteem = Math.max(0, acc.ok ? acc.steem ?? 0 : 0);
      const convAmt = report.steps.convert?.verdict === "CONVERT-PLAN" ? (report.steps.convert.amountSbd ?? 0) : 0;
      const bidCap = Math.max(0, (acc.ok ? acc.sbd ?? 0 : 0) - convAmt - (conf.bidReserveSbd ?? 0.5));
      let askSum = 0, bidSum = 0;
      const tSec = Math.floor(Date.now() / 1000);
      const pushLadder = (levels, kind) => {
        for (const lvl of levels ?? []) {
          if (ops.length >= maxOpsPerCycle) break;
          if (kind === "ask") {
            const amt = Math.min(lvl.amountSteem, Math.max(0, (conf.maxAskSteemPerCycle ?? 200) - askSum), Math.max(0, liquidSteem - askSum));
            if (amt < 0.001) break;
            const id = (tSec + ops.length) >>> 0;
            /* T-19: flow levels carry sbdOut3 — the EXACT 3dp SBD out computed
             * at plan time; value levels fall back to multiply-and-round. */
            const sOut = lvl.sbdOut3 != null ? lvl.sbdOut3 : amt * lvl.unit;
            ops.push(["limit_order_create", { owner: ACCOUNT, orderid: id, amount_to_sell: `${amt.toFixed(3)} STEEM`, min_to_receive: `${sOut.toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + 86400 }]);
            createdIds.push({ id, side: "ask", unit: lvl.unit, tranche: lvl.tranche ?? "value", at: now });
            askSum = Math.round((askSum + amt) * 1e6) / 1e6;
          } else {
            const amt = Math.min(lvl.amountSbd, Math.max(0, bidCap - bidSum), Math.max(0, (conf.maxBidSbdPerCycle ?? 20) - bidSum));
            if (amt < 0.001) break;
            const id = (tSec + ops.length) >>> 0;
            const stOut = lvl.steemOut3 != null ? lvl.steemOut3 : amt / lvl.unit;
            ops.push(["limit_order_create", { owner: ACCOUNT, orderid: id, amount_to_sell: `${amt.toFixed(3)} SBD`, min_to_receive: `${stOut.toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + 86400 }]);
            createdIds.push({ id, side: "bid", unit: lvl.unit, tranche: lvl.tranche ?? "value", at: now });
            bidSum = Math.round((bidSum + amt) * 1e6) / 1e6;
          }
        }
      };
      pushLadder(offer.plan.asks, "ask");
      pushLadder(offer.plan.bids, "bid");
      if (!hyperEnabled) {
        pushLadder(offer.plan.flowAsks, "ask");   // T-19 flow tranche — AT-the-front presence
        pushLadder(offer.plan.flowBids, "bid");
      } // T-19b: hyper layer owns the mobile tranche when enabled
    }
    // (c) claim block moved to (c-NEW) at the TOP of batch construction —
    // the natural-trigger monitor + pre-action prediction now precede all
    // order ops, so the cap slice can never drop a predicted claim (A-9).
    const rewDecLegacy = null; void rewDecLegacy;
    // (d) convert execution (3.5d face-$1 rail) when MEASURED edge arms it.
    // R210 (A-10): claim needs posting authority, convert needs active — a
    // mixed atomic tx is un-signable. When a claim is in this batch, convert
    // is deferred to the next cycle (journaling the defer honestly).
    if (convAmtExec(report.steps.convert)) {
      if (ops.some(([n]) => n === "claim_reward_balance")) {
        report.steps.convertDeferredForClaim = true;
      } else {
      const c = report.steps.convert;
      ops.push(["convert", { owner: ACCOUNT, amount: `${c.amountSbd.toFixed(3)} SBD`, requestid: (Math.floor(Date.now() / 1000) & 0x7fffffff) }]);
      }
    }
    /* T-19: the ops DAY-CAP is a LAW — past it the machine journals honestly
     * instead of churning (RC is a shared budget: votes, orders, soldiers). */
    if (ops.length && opsDay.opsToday + ops.length > opsDayCap) {
      writeJson(OPS_FILE, { ...opsDay, lastRcPct: null });
      if (claimPred) reconcileOrphans(); // honest UNRESOLVED for the orphaned prediction
      return { verdict: "OPS-DAY-CAP", opsToday: opsDay.opsToday, opsDayCap, staged: ops.length };
    }
    if (!ops.length) {
      if (claimPred) reconcileOrphans();
      return { verdict: "NO-OPS", ops: 0, opsToday: opsDay.opsToday, opsDayCap };
    }
    const res = await executeOps(ops, { tag: "cycle-execute", predictionId: claimPred?.predictionId ?? null });
    /* R210 §VIII/§IX/X · the chain judges, not the local result.
     * execRow carries the signer's OWN log-row evidence (at/role/serialization)
     * so prediction-time < action-time is verifiable from immutable logs (C-1). */
    if (claimPred) {
      try {
        const chain = res.ok ? await claimChainTruth(res.txid) : { included: false };
        const execRow = { at: res.execAt ?? null, role: res.role ?? null, serialization: res.serialization ?? null, txid: res.txid ?? null };
        const outcome = evaluateAndJournal({ prediction: claimPred, execRow, res, chain });
        updateBelief({ classification: outcome.classification, evidence: { txid: res.txid ?? null, chain } });
      } catch { /* honest best-effort — never invent an outcome */ }
    }
    /* T-19 bookkeeping: track OUR created orderids (the second signer's
     * orders on this account must never be our cancel candidates) + meter
     * the ops throughput + RC trend — measured, not assumed. */
    if (res.ok ?? res.verdict === "BROADCAST") {
      const cancelled = new Set([...staleIds, ...flowRequoteIds]);
      const cut = (ours.orderids ?? []).filter((o) => !cancelled.has(typeof o === "object" ? o.id : o));
      writeJson(OURS_FILE, { orderids: [...cut, ...createdIds].slice(-200) });
      let rcPct = null;
      try { const acc2 = await accountState(ACCOUNT); rcPct = acc2.ok ? acc2.rcPct ?? null : null; } catch { /* honest null */ }
      writeJson(OPS_FILE, { day: today, opsToday: opsDay.opsToday + ops.length, lastRcPct: rcPct, opsDayCap });
    }

    // (e) promotion rail — one honest public report per day (posting key)
    let promo = null;
    if (conf.promo?.armed && obs.ok) {
      try { promo = await postDailyReport({ obs, rollup: report.steps.report?.rollup ?? null, intel: intelOut, now }); }
      catch (e) { promo = { verdict: "PROMO-ERROR", error: String(e?.message ?? e).slice(0, 120) }; }
    }
    return { verdict: res.verdict, txid: res.txid ?? null, ops: ops.length, opNames: res.opNames ?? ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null, promo, opsToday: opsDay.opsToday + ops.length, opsDayCap, cancels: staleIds.length, created: createdIds.length, hyperLayer: hyperEnabled ? "hypergrid-owns-flow" : "cycle-flow-tranche" };
  });

  /* 7 · soldiers: T-80 FROZEN-BY-DEFAULT (operator stop-order 2026-10-04 —
   * "עדיין מאצילה לחיילים, שלחה להם כסף, עושה בהם שימוש בגריד בלי מפתח").
   * Laws now enforced structurally:
   *   - config gate: conf.soldiers.enabled must be TRUE (T-90 round-2 order:
   *     authorized — deploy + fund via explicit allowlist only)
   *   - custody gate: a soldier WITHOUT a chain-verified credential gets
   *     ZERO network reads, ZERO ops, ZERO funds — instant typed freeze
   *   - the top-up rail can only ever fire for custody-VERIFIED soldiers,
   *     and even then the signer's T-80 think-gate independently forbids
   *     outbound transfers unless policy.allowTransfersOut is true. */
  report.steps.soldiers = await stepWrap("soldiers", async () => {
    const conf = armedConf();
    if (!conf.armed || execPaused()) return { verdict: "DISARMED-OR-PAUSED" };
    if (!conf.soldiers?.enabled) return { verdict: "DISABLED-T80-OPERATOR-STOP" };
    loadCredential(); // typed CREDENTIAL-MISSING here — before ANY network read
    /* T-90 SELF-CUSTODY SWEEP (before the partition): engine restarts empty
     * the key memory; stored soldier credentials are re-proven against the
     * live chain authorities here — fail-closed, idempotent, journaled. */
    const sweep = await verifySoldierCustody();
    if (sweep.out?.length) appendLine(path.join(STATE, "events.jsonl"), { type: "soldiers.custody-sweep", at: now, sweep: sweep.out });
    const st = soldiersState();
    // T-80 CUSTODY LEDGER: partition soldiers by proven custody BEFORE any read
    const frozen = (st.deployed ? st.accounts : []).filter((r) => custodyOf(r.name) !== "verified");
    if (frozen.length) {
      appendLine(path.join(STATE, "events.jsonl"), { type: "soldiers.custody-frozen", at: now, accounts: frozen.map((r) => r.name), verdict: "NO-CUSTODY-FROZEN", law: "T-80: keyless accounts are never funded, never grid-run, never signed for" });
    }
    /* T-90 DEPLOY PATH UNJAMMED: the fresh-era deploy was structurally dead —
     * the custody early-return fired on a never-deployed era (live=[][]) BEFORE
     * the deploy call ever ran. Now the deploy runs first and stays double-gated
     * (operator.allowSoldierDeploy + explicit transfer allowlist); the deploy tx
     * self-verifies custody before any grid may fire, so the freeze law holds. */
    let deploy = null, topups = [];
    if (!st.deployed) deploy = await deploySoldiers();
    const stNow = deploy?.ok ? soldiersState() : st;
    const live = (stNow.deployed ? stNow.accounts : []).filter((r) => custodyOf(r.name) === "verified");
    if (!live.length) {
      return {
        verdict: deploy && !deploy.ok ? `DEPLOY-${deploy.verdict}` : "NO-CUSTODY-FROZEN",
        deploy: deploy ? { verdict: deploy.verdict, error: deploy.error ?? null } : null,
        frozen: frozen.map((r) => r.name), topups: [], grids: [],
      };
    }
    // top-up rail: custody-VERIFIED soldiers only — the measured leak (auto
    // top-ups into keyless accounts while their STEEM sat locked in orders)
    // is structurally dead: no-custody soldiers never reach this loop.
    const acc = await accountState(ACCOUNT);
    const masterLiquid = Math.max(0, acc.ok ? acc.steem ?? 0 : 0);
    const masterSbd = Math.max(0, acc.ok ? acc.sbd ?? 0 : 0);
    for (const rec of live) {
      if (topups.length >= 1) break; // max 1 top-up/cycle (doctrine cap)
      const sAcc = await accountState(rec.name);
      /* T-90 BID-SIDE SEED: a verified soldier holding 0 SBD can never run
       * its bid tranche — while the master holds ≥3 SBD of fill proceeds,
       * 1 SBD seeds the soldier's buy side. Same allowlist + custody + cap. */
      if ((sAcc.sbd ?? 0) < 0.2 && masterSbd >= 3) {
        const res = await executeAs(ACCOUNT, [["transfer", { from: ACCOUNT, to: rec.name, amount: "1.000 SBD", memo: "grid soldier bid-side funding" }]], { tag: "soldier-topup-sbd" });
        topups.push({ name: rec.name, kind: "sbd", verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null });
        continue;
      }
      if ((sAcc.steem ?? 0) < 1 && masterLiquid - topups.length * 12 > 40) {
        const res = await executeAs(ACCOUNT, [["transfer", { from: ACCOUNT, to: rec.name, amount: "10.000 STEEM", memo: "grid soldier top-up" }]], { tag: "soldier-topup" });
        topups.push({ name: rec.name, kind: "steem", verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null });
      }
    }
    const parity = obs.ok ? obs.parity.parity : 0;
    /* T-19: soldiers join the FLOW TRANCHE — the live book edges + chain
     * anchor passed through so their small ladders sit AT the market front
     * (never below the witness feed, never crossing the master's ladder). */
    const pegOffer = readJson(path.join(STATE, "offer.json"), null);
    const grids = await runSoldierGrids({
      parity, spreadBps: intelOut?.spreadBpsRec ?? 0, now,
      bestBid: pegOffer?.book?.bestBid ?? null, bestAsk: pegOffer?.book?.bestAsk ?? null,
      feedAnchor: obs.ok && obs.feed > 0 ? obs.feed : null,
    });
    const verdict = deploy && !deploy.ok ? `DEPLOY-${deploy.verdict}` : grids.verdict;
    return {
      verdict, deploy: deploy ? { verdict: deploy.verdict, txid: deploy.txid ?? null, error: deploy.error ?? null } : null,
      topups, grids: grids.soldiers ?? [],
    };
  });

  /* 9 · learn (T-14): ingest recorded history → lessons → bounded tunings.
   *   learning is cheap (local files only) — every cycle; discovery (network
   *   reads) is cadence-gated internally at 30min. Fail-isolated like all
   *   steps; never blocks execution — learning shapes the NEXT cycle. */
  report.steps.learn = await stepWrap("learn", async () => {
    const learning = await runLearning({ now });
    const discovery = await runDiscovery({ now });
    return {
      verdict: learning.verdict,
      lessons: learning.lessons.map((l) => l.id),
      tunings: learning.tuningsApplied,
      discoveryVerdict: discovery.verdict,
      topOpportunities: discovery.opportunities?.slice(0, 3).map((o) => `${o.id}(${o.potentialClass})`) ?? [],
    };
  });

  /* T-22 · WEB-INTEL TEAM: external eyes on the ecosystem — rotating sourced
   * scans (price news, chain developments, SBD market, competitors). The
   * cadence gate lives inside runWebIntel (6h); every finding carries a
   * url — the machine no longer depends on the operator for discovery. */
  report.steps.webintel = await stepWrap("webintel", async () => {
    const out = await runWebIntel({ now });
    return { verdict: out.verdict, totalFindings: out.totalFindings ?? null, failedScans: out.failedScans ?? null, lastAt: out.lastAt ?? null, ms: out.ms ?? null };
  });

  /* T-22 · CONTENT TEAM: smart discussion drafts, grounded on measured
   * telemetry + web intel, exposure-law-checked in pure code, queued for the
   * promo rail (broadcast only after credential verification). Cadence 12h. */
  report.steps.content = await stepWrap("content", async () => {
    const out = await runContent({ now });
    return { verdict: out.verdict, draftsQueued: out.draftsQueued ?? 0, exposureBlocked: out.exposureBlocked ?? 0, lastAt: out.lastAt ?? null, ms: out.ms ?? null };
  });

  /* T-85 · SMART-SOCIAL RAIL: random-time publishing (drafts queue),
   * fleet mutual votes, comment replies — custody-gated per account (T-80):
   * the master is live today, the 10 army accounts report REFUSED-NO-CUSTODY
   * until the operator's credentials are adopted. Fail-isolated. */
  report.steps.social = await stepWrap("social", async () => {
    const out = await runSocial({ now });
    return { verdict: out.verdict, executed: out.executed ?? 0, refused: out.refused ?? 0, due: out.due ?? 0, ms: out.ms ?? null };
  });

  /* T-22 · RC-TANK: the daily measured curve of the 100,000× law
   * (max_rc + equilibrium ops/day + growth). Read-only — runs with or
   * without a credential. Day-gated here (one chain read/day). */
  report.steps.rctank = await stepWrap("rctank", async () => {
    const today = now.slice(0, 10);
    const cached = rcTankState();
    if (cached?.day === today) return { verdict: cached.verdict ?? "CADENCE-GATED", maxRc: cached.maxRc ?? null, opsPerDayEquilibrium: cached.opsPerDayEquilibrium ?? null, growthPct: cached.growthPct ?? null, day: today };
    const out = await runRcTank({ now, account: ACCOUNT });
    return { verdict: out.verdict, maxRc: out.maxRc ?? null, opsPerDayEquilibrium: out.opsPerDayEquilibrium ?? null, growthPct: out.growthPct ?? null, day: out.day ?? today };
  });

  /* T-23 · PAYOUTS TEAM: המכשיר שהופך המערך-הכלכלי ממדומה לאמיתי — pending
   * rewards + the payout CLOCK (T-18c) + settled reward rollup + VP probe
   * (T-18e). Read-only, credential-free. Day-gated (one chain scan/day). */
  report.steps.payouts = await stepWrap("payouts", async () => {
    const today = now.slice(0, 10);
    const cached = payoutsState();
    if (cached?.day === today && cached?.verdict?.startsWith("MEASURED")) {
      return { verdict: cached.verdict, day: today, pendingVests: cached.pending?.vests ?? null, daysRemaining: cached.payout?.daysRemaining ?? null, rollupConfidence: cached.rollup?.confidence ?? null };
    }
    const out = await runPayouts({ now, account: ACCOUNT });
    return { verdict: out.verdict, day: out.day, pendingVests: out.pending?.vests ?? null, daysRemaining: out.payout?.daysRemaining ?? null, rollupConfidence: out.rollup?.confidence ?? null, firstVoteDay: out.scan?.firstVoteDay ?? null };
  });

  /* T-23 · WEAVE HANDSHAKE: the one-body contract with the external second
   * signer — both writers observed from chain truth, the shared day-cap,
   * lanes and collision laws PUBLISHED (T-19f v1). Read-only. Day-gated. */
  report.steps.weave = await stepWrap("weave", async () => {
    const today = now.slice(0, 10);
    const cached = weaveState();
    if (cached?.day === today && cached?.protocol === "saos.weave.core.v1") {
      return { verdict: "PUBLISHED", day: today, theirVotesToday: cached.theirs?.votesToday ?? 0, ourVotesToday: cached.ours?.votesToday ?? 0, revision: cached.handshake?.revision ?? null };
    }
    const out = await runWeave({ now, account: ACCOUNT });
    return { verdict: "PUBLISHED", day: out.day, theirVotesToday: out.theirs?.votesToday ?? 0, ourVotesToday: out.ours?.votesToday ?? 0, revision: out.handshake?.revision ?? 1 };
  });

  /* T-22 · STANDING SELFTEST: the machine audits its own laws daily —
   * the deterministic vectors run in a clean child process (offline, no
   * network) and refresh state/selftest-last-run.json. The integrity-
   * auditor's evidence is now refreshed BY the machine, not by a dev run. */
  report.steps.selftest = await stepWrap("selftest", async () => {
    const today = now.slice(0, 10);
    const last = readJson(path.join(STATE, "selftest-last-run.json"), null);
    if (last?.at && String(last.at).slice(0, 10) === today && last.fail === 0) {
      return { verdict: "CADENCE-GATED", pass: last.pass, fail: last.fail, at: last.at };
    }
    const sp = Bun.spawnSync(["bun", "selftest.mjs"], { cwd: DIR, stdout: "pipe", stderr: "pipe" });
    const outText = `${sp.stdout.toString()}\n${sp.stderr.toString()}`;
    const m = outText.match(/SELFTEST (\d+)\/(\d+) (PASS|FAIL)/);
    const fresh = readJson(path.join(STATE, "selftest-last-run.json"), null);
    return {
      verdict: sp.exitCode === 0 && m ? `SELFTEST-${m[3]}` : "SELFTEST-FAIL",
      pass: fresh?.pass ?? (m ? Number(m[1]) : null),
      fail: fresh?.fail ?? (m ? Number(m[2]) - Number(m[1]) : null),
      exitCode: sp.exitCode,
    };
  });

  /* T-21 · economics: the multi-rail rollup (measured | estimated | blocked
   * per rail, totals never merged across classes) — the honest answer to
   * "how do we turn the simulated array into real value": you can only
   * monetize what you can SEE. */
  report.steps.economics = await stepWrap("economics", async () => {
    const econ = runEconomics(now);
    return {
      totalMeasuredUsdPerDay: econ.totalMeasuredUsdPerDay,
      totalEstUsdPerDay: econ.totalEstUsdPerDay,
      rails: econ.rails.length,
      measuredCount: econ.measuredCount,
      estimatedCount: econ.estimatedCount,
      blockedCount: econ.blockedCount,
    };
  });

  /* T-21/22 · recruit (moved LAST of the state-writing steps): הצבא מפתח את
   * עצמו — the recruiter re-inspects EVERY state artifact the cycle just
   * wrote (webintel/content/selftest/rctank included) and recruits/demotes
   * NAMED stations by same-cycle evidence, not last-cycle lag. */
  report.steps.recruit = await stepWrap("recruit", async () => {
    const roster = runRecruiter(now);
    return { verdict: roster.verdict, active: roster.active, total: roster.total };
  });

  /* 10 · report: profitability rollup */
  report.steps.report = await stepWrap("report", async () => {
    const pnl = obs.ok ? obs.pnl : null;
    const fuelUsd = obs.ok ? obs.fuel?.fuelUsdPerDay ?? null : null;
    const authorUsd = obs.ok ? obs.fuel?.authorUsdPerDay ?? null : null;
    const rollup = {
      realizedSbd: pnl?.realizedSbd ?? null,
      positionSteem: pnl?.positionSteem ?? null,
      positionAvgCost: pnl?.positionAvgCost ?? null,
      unbasedSteem: pnl?.unbasedSteem ?? null,
      deployedSteem: obs.ok && obs.ordersOk
        ? (obs.orders ?? []).filter((o) => o.side === "ask").reduce((s, o) => s + Number(o.base.split(" ")[0] || 0), 0)
        : null,
      fuelUsdPerDay: fuelUsd, authorUsdPerDay: authorUsd,
      measuredTotalUsdPerDay: Math.round(((fuelUsd ?? 0) + (authorUsd ?? 0)) * 1e4) / 1e4,
      honesty: "unbased ≠ profit · signing doctrine-capped · all numbers measured this cycle",
    };
    report.rollup = rollup;
    return rollup;
  });

  /* T-16 truth taxonomy: ok | blocked (ONLY cred-gated failures — lawful) |
   * fail (any real malfunction). `ok` stays strict all-steps-green; the new
   * health field stops the 11/35 "fail" lie-by-composition from polluting
   * the sovereign counters, the learning metrics, and the cockpit. */
  report.ok = Object.values(report.steps).every((s) => s.ok !== false);
  report.health = cycleHealth(report.steps);
  report.failures = cycleFailureBreakdown(report.steps);
  report.finishedAt = new Date().toISOString();
  if (persist) writeJson(path.join(STATE, "daily-report.json"), report);
  return report;
  } finally {
    /* the marker ALWAYS closes — even on a thrown error mid-body (the
     * thrown error still propagates to the caller; the marker says fail) */
    cycleInFlight = false;
    cycleInFlightSince = null;
    writeJson(markerFile, {
      running: false,
      startedAt: now,
      finishedAt: new Date().toISOString(),
      ms: Date.now() - cycleT0,
      health: report.health ?? "fail",
      ok: report.ok ?? false,
      steps: Object.fromEntries(Object.entries(report.steps ?? {}).map(([k, v]) => [k, v?.ok === true])),
      blockedSteps: report.failures?.blockedSteps ?? null,
      failedSteps: report.failures?.failedSteps ?? null,
      error: report.error ?? null,
    });
  }
}

function convAmtExec(convertStep) {
  return convertStep?.verdict === "CONVERT-PLAN" && (convertStep.amountSbd ?? 0) >= 1;
}

/* CLI: bun daily.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCycle().then((r) => {
    console.log(JSON.stringify({ ok: r.ok, steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v.verdict ?? (v.ok ? "ok" : "fail")])), rollup: r.rollup }, null, 2));
  }).catch((e) => { console.error("CYCLE-FAIL", e); process.exit(1); });
}
