/**
 * daily.mjs — one-command autonomous cycle (A-8 lineage, T-9 local rebuild,
 * T-12 LIVE EXECUTION: the operator handed the master credential and ordered
 * full autonomous, sovereign operation without operator intervention.
 * T-14 CONTINUOUS LEARNING: the machine reads its own recorded history every
 * cycle, derives evidence-backed lessons, and applies hard-clamped tunings —
 * plus a cadence-gated network scan for growth options (discovery).
 *
 * observe → intel → tick → peg(intel-fed) → convert → redeploy(T-91) → execute(SIGN) → soldiers → learn(T-14) → report
 *
 * Fail-isolated steps; every signing op doctrine-capped (signer.mjs);
 * pause button = operator kill-switch (state/exec-pause.json); everything
 * journaled: events.jsonl + exec-log.jsonl (txids, never keys).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  planLadder, planConvert, planRedeploy, redeployBidCapSbd, redeployPacing, rebuildPacingFromEvents, inventorySkew, parityVerdict, pnlFromFills, classifyStale,
  cycleHealth, cycleFailureBreakdown, signalDigest, measuredLayers, redeployIntel, blockageLedger, shouldFleetSweep,
} from "./lib.mjs";
import { runCouncil } from "./council.mjs";
import { mmGate } from "./rail-doctrine.mjs"; /* T-37: arm the measured MM verdict on runtime truth */
import { mergeFillLedger, runFills, fillLedgerState } from "./fills.mjs"; /* W12-D: the fill-capture ledger (T-25, finally wired) */
import {
  externalParity, internalFeed, accountState, openOrders, measureAll, fuelToUsdPerDay, marketPulse, rpcCall,
} from "./measure.mjs";
import { tick as gridTick } from "./grid.mjs";
import { runIntel } from "./intel.mjs";
import { executeOps, executeAs, armedConf, execPaused, masterAccount, loadCredential, custodyOf, verifyRoles } from "./signer.mjs";
import { writePrediction, evaluateAndJournal, updateBelief, triggerWatch, resolveClaimRole, journalClaimRefusal, claimChainTruth, reconcileOrphans } from "./adaptation.mjs";
import { deploySoldiers, runSoldierGrids, soldiersState, verifySoldierCustody } from "./soldiers.mjs";
import { postDailyReport } from "./promo.mjs";
/* R292 · CAPITAL ROUTER: profit-maximization + routing engine — computes the
 * ranked action matrix from the deep probe, executes pure-recall actions
 * (zero-amount delegation — structurally unable to create exposure). */
import { computeRouterReport, executeRouterActions, probeLanding } from "./capital-router.mjs";
import { runCurator } from "./curator.mjs";
import { runArmyCuration } from "./army-curation.mjs";
import { runOnce as runStreamer } from "./social-streamer.mjs"; /* R308: THE POSTING STREAM — wired at last */
import { runTagRoi } from "./tag-roi.mjs";
import { runLearning } from "./learning.mjs";
import { runDiscovery } from "./discovery.mjs";
import { runRecruiter } from "./recruiter.mjs";
import { runEconomics } from "./economics.mjs";
import { runWebIntel } from "./webintel.mjs";
import { runContent } from "./content.mjs";
import { runSocial, runOrganicWatch, runProfiles, ARMY_ROSTER } from "./army-social.mjs";
import { runShellWatch } from "./shell-watch.mjs"; /* R299: THE UN-SHELL METER */
import { runVisibilityCensus } from "./fleet-visibility.mjs"; /* R300: THE MULTI-FRONTEND CENSUS */
import { runHiveRail } from "./hive.mjs";
import { runBlurtOrgan } from "./blurt.mjs";
import { runHiveProfiles } from "./hive-profiles.mjs";
import { runRcPool } from "./rc-pool.mjs";
import { runHiveSocial } from "./hive-social.mjs";
import { syncCommunityMembership, readCommunityState } from "./community.mjs";
import { runBus } from "./bus.mjs";
import { runRcTank, rcTankState } from "./rctank.mjs";
import { runPayouts, payoutsState } from "./payouts.mjs";
import { runIncome, incomeState } from "./income.mjs"; /* T-553: the orphaned instrument gets its caller — runIncome had ZERO callers since 10-02 */
import { runSoldierClaims } from "./soldier-claims.mjs";
import { runWeave, weaveState } from "./weave.mjs";
import { measureFleetMatrix, readFleetMatrix } from "./fleet-matrix.mjs"; /* W12: the activation board */
import { MASTER } from "./fleet-rebalance.mjs"; /* W12-D: the one-body master identity for the fill sweep */
import { runFleetRebalance } from "./fleet-rebalance.mjs"; /* W12: the mutual-support rail */

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: ATOMIC — torn-write of redeploy-state/ops files reset the pacing & ops-cap laws; rename is the atomic commit point */
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── R235: pacing-state read — tri-state with journal self-healing ─────────
 * ok → as-is · missing → rebuild from the events journal (crash-lost file,
 * same numbers as the old default when the journal has nothing today) ·
 * corrupt (torn JSON) → rebuild from the journal, HEAL the file, flag it.
 * Dead journal too → fail-closed (lastPowerUpAt = now blocks this cycle). */
const readPacingState = (rsFile, today, nowIso, eventsFile = path.join(STATE, "events.jsonl")) => {
  const journal = () => {
    try {
      const lines = fs.readFileSync(eventsFile, "utf8").split("\n");
      const events = [];
      for (const l of lines) { if (!l.trim()) continue; try { events.push(JSON.parse(l)); } catch { /* torn last line — skipped */ } }
      return rebuildPacingFromEvents(events, today);
    } catch { return null; }
  };
  let raw = null;
  try { raw = fs.readFileSync(rsFile, "utf8"); } catch {
    return { rs: journal() ?? { day: today, powerUpsToday: 0, lastPowerUpAt: nowIso, rebuilt: "fail-closed" }, corrupt: false };
  }
  try { return { rs: JSON.parse(raw), corrupt: false }; }
  catch {
    const built = journal();
    if (built) { try { writeJson(rsFile, built); } catch { /* heal best-effort */ } return { rs: built, corrupt: true }; }
    return { rs: { day: today, powerUpsToday: 0, lastPowerUpAt: nowIso, rebuilt: "fail-closed" }, corrupt: true };
  }
};

export { readPacingState };

/* R299 · THE STEP DEADLINE (measured 2026-10-09 21:25-21:52Z): a step whose
 * await never settles (stalled socket — 326 bytes frozen in the send queue
 * of a Steem node connection) froze the WHOLE cycle forever: the marker
 * stayed running:true and the grid deferred every tick (CYCLE-IN-FLIGHT) —
 * 27 minutes without a single requote. stepWrap catches ERRORS but can
 * never catch a HANG. Law: every step is wall-clock bounded (8min default,
 * SAOS_STEP_DEADLINE_MS overrides); a timed-out step returns an honest
 * ok:false and the cycle CONTINUES. The underlying promise stays pending
 * (JS cannot cancel) — fail-isolated, bounded, never trusted again. */
const STEP_DEADLINE_MS = Number(process.env.SAOS_STEP_DEADLINE_MS) || 8 * 60_000;
const stepWrap = async (name, fn) => {
  const t0 = Date.now();
  try {
    const out = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`step-timeout-after-${Math.round((Date.now() - t0) / 1000)}s (hang guard)`)), STEP_DEADLINE_MS).unref?.()),
    ]);
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
  /* R243 · RUNNER WIF ADOPTION (chain-judged, in-process): an external
   * runner (public-minutes CI, any future host) delivers the master's WIFs
   * via env; the engine adopts them through the SAME lawful path as the
   * git-vault revival — the chain is the only judge, key material never
   * printed. This revives the master's signing roles (posting + active)
   * on hosts that hold no master password. Absent env = zero change. */
  for (const [role, envName] of [["posting", "CI_ADOPT_WIF_POSTING"], ["active", "CI_ADOPT_WIF_ACTIVE"]]) {
    const raw = (process.env[envName] ?? "").trim();
    if (!raw) continue;
    try {
      const bare = raw.startsWith("P") && raw.length >= 51 ? raw.slice(1) : raw;
      const { adoptVerifiedWifIdentity } = await import("./signer.mjs");
      const r = await adoptVerifiedWifIdentity(masterAccount(), bare, { role });
      appendLine(path.join(STATE, "events.jsonl"), { type: "runner-wif.adopted", at: now, role, ok: !!r?.ok, verdict: r?.ok ? "VERIFIED-VS-CHAIN" : String(r?.reason ?? "refused").slice(0, 80) });
    } catch (e) {
      appendLine(path.join(STATE, "events.jsonl"), { type: "runner-wif.error", at: now, role, error: String(e).slice(0, 100) });
    }
  }
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

  /* R290 · army-curation (parallel, fail-isolated): the structural multiplier —
   * Σ SPᵢ × regen deployed on the SAME external candidates. Shared candidate
   * fetch inside the rail; chain-truth day budget + VP floor per account. */
  const armyCurateP = stepWrap("army-curate", async () => {
    const out = await runArmyCuration({ now });
    return { verdict: out.verdict, totalVotes: out.totalVotes ?? 0, accounts: (out.accounts ?? []).map((a) => `${a.account}:${a.verdict}`), error: out.error ?? null };
  });

  /* R291 · tag-ROI walk (parallel, fail-isolated, day-guarded inside): which
   * tags actually pay US — feeds the ORDER of both voting rails' tag lists. */
  const tagRoiP = stepWrap("tag-roi", async () => {
    const out = await runTagRoi({ now });
    return { verdict: out.verdict, tagsRanked: out.tagsRanked ?? 0, resolved: out.resolved ?? 0, top: out.top ?? null, error: out.error ?? null };
  });

  /* R292 · capital-route (parallel, fail-isolated): the profit-maximization
   * matrix — reads the deep probe, computes the yield ladder + ranked
   * actions, and executes pure-recall actions through the think gate. */
  const capitalRouteP = stepWrap("capital-route", async () => {
    /* T-555 · the landing detector reads the chain LIVE every routing run —
     * "landing is detected not assumed" is now structural: the deep-probe
     * snapshot fossilized a 767.69 SP queue while the chain truth was 407.12
     * SP (partial re-deploy of the recall wave, 6 rows × +59.96 SP measured).
     * Fail-isolated: a probe failure degrades to the cached derivation, and
     * the report labels its source honestly either way. */
    const liveLanding = await probeLanding().catch(() => null);
    const rep = computeRouterReport({ now, liveLanding });
    if (rep.verdict !== "ROUTED") return rep;
    const ex = await executeRouterActions({ now, plan: rep, executeAsFn: executeAs, verifyRolesFn: verifyRoles, masterAcct: masterAccount() });
    return { verdict: rep.verdict, actions: rep.actions?.length ?? 0, ladderTop: rep.ladder?.stages?.[rep.ladder.stages.length - 1]?.spPerDay ?? null, executed: ex.executed ?? [] };
  });

  /* 1 · observe: parity + inventory + fills + rails fuel */
  report.steps.observe = await stepWrap("observe", async () => {
    const [par, feed, acc, oo, meas] = await Promise.all([
      externalParity(), internalFeed(), accountState(ACCOUNT), openOrders(ACCOUNT), measureAll(ACCOUNT),
    ]);
    const fillsPnl = pnlFromFills(meas.fills);
    /* T-37 · mm-gate truth file: the fill window the gate verdicts on
     * (fail-open elsewhere — a missing/stale file never throttles) */
    const firstFillAt = meas.fills.length ? new Date(Math.min(...meas.fills.map((f) => f.at))).toISOString() : null;
    const mmGatePnl = { fills: fillsPnl.fills, realizedSbd: fillsPnl.realizedSbd, firstFillAt, lastFillAt: meas.lastFillAt, computedAt: now };
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
      writeJson(path.join(STATE, "mm-gate.json"), mmGatePnl);
      appendLine(path.join(STATE, "events.jsonl"), { type: "observe.done", at: now, fills: meas.fills.length, parity: par.parity });
      /* W12-D · THE LEDGER WIRE (the T-25 instrument was born unwired —
       * mergeFillLedger had zero callers, the ledger froze on 10-02 while
       * 125 fills/day ran): the observe fills land in the persistent
       * chain-truth ledger and the rollup recomputes from raw. Fail-soft:
       * a ledger problem never blunts observation itself. */
      try {
        const merged = mergeFillLedger(meas.fills, { now, account: ACCOUNT });
        data.ledgerAdded = merged.added;
        runFills({ now, parity: par.parity, sbdUsd: par.sbdUsd ?? null });
      } catch (e) {
        data.ledgerError = String(e?.message ?? e).slice(0, 140);
      }
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

  /* 3 · signal-scan (R237 — THE SIM LAYER IS RETIRED): the operator ruled
   * "simulations instead of real runs" an architecture failure. The pure
   * trigger-grid stays an OFFLINE signal generator; the live cycle journals
   * ZERO simulated fills — `grid.fill`/`fee.spawn` (real:false) never reach
   * the bus again. Real fills are measured from the chain (measure.mjs),
   * real presence is measuredLayers (our tranches + hyper + verified
   * soldiers). Legacy simFills/simFeesMu are FROZEN heritage, never
   * incremented again. */
  report.steps.tick = await stepWrap("tick", async () => {
    const prev = readJson(path.join(STATE, "state.json"), { runCount: 0, simFills: 0, simFeesMu: 0 });
    const inv = obs.ok && !obs.error ? { steem: obs.inventory?.steem ?? 0, sbd: obs.inventory?.sbd ?? 0 } : { steem: 0, sbd: 0 };
    const res = gridTick({
      refPrice: obs.ok ? obs.parity.parity : 0,
      internalFeed: obs.ok ? obs.feed : 0,
      inventory: inv, runCount: prev.runCount, now,
    });
    const digest = signalDigest(res.events);
    const st = {
      runCount: (prev.runCount ?? 0) + 1,
      /* frozen heritage — the honest tombstone of the retired sim layer */
      simFills: prev.simFills ?? 0, simFeesMu: prev.simFeesMu ?? 0,
      sim: { retired: true, note: "R237: sim fills retired — real fills measured from chain; counters frozen" },
      asof: now,
      market: { refPrice: obs.ok ? obs.parity.parity : null, source: "engine", stale: false },
    };
    if (persist) {
      // T-15: the tick's recorded output must carry its own timestamp —
      // the fleet registry reads state.json.at as the liveness evidence
      const ourOrders = readJson(path.join(STATE, "our-orders.json"), { orderids: [] })?.orderids ?? [];
      const hyper = readJson(path.join(STATE, "hyper-grid.json"), null);
      const soldiers = readJson(path.join(STATE, "soldiers.json"), null);
      const soldiersVerified = Array.isArray(soldiers?.accounts) ? soldiers.accounts.filter((r) => r?.custody === "verified").length : 0;
      const layers = measuredLayers({ ourOrders, hyper, soldiersVerified });
      writeJson(path.join(STATE, "state.json"), { ...st, grids: layers });
      if ((prev.simFills > 0 || prev.simFeesMu > 0) && !prev.sim?.retired) {
        /* the tombstone fires ONCE — the first new-law cycle that saw the heritage */
        appendLine(path.join(STATE, "events.jsonl"), { type: "grid.sim-retired", at: now, frozenFills: prev.simFills ?? 0, frozenFeesMu: prev.simFeesMu ?? 0, law: "R237 — real fills are chain-measured, never simulated" });
      }
      for (const e of digest.signals) appendLine(path.join(STATE, "events.jsonl"), e);
    }
    return { runCount: st.runCount, signals: digest.signals.length, retiredFills: digest.retiredFills, arbSignal: digest.arbSignal, layers: "measured (see state.json.grids)" };
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
    /* T-91 enforcement (was documentation): the doctrine's buy-book share now
     * CAPS the bid budget — only buyBookPct of SBD above the reserve floor
     * may flow into bids; the rest is reserve by law, not by note. */
    const rdPeg = confPeg.redeploy ?? {};
    const buyBookCapSbd = redeployBidCapSbd(inv.sbd ?? 0, rdPeg.liquidSbdFloor ?? 0.5, rdPeg.buyBookPct ?? 0.5);
    const bidBudgetCapped = Math.min(bidBudget, buyBookCapSbd);
    const plan = planLadder({
      parity: obs.parity.parity,
      askBudgetSteem: askBudget,
      bidBudgetSbd: bidBudgetCapped,
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
      liquidity: { deployedAsks: Math.round(deployedAsks * 1e3) / 1e3, deployedBids: Math.round(deployedBids * 1e3) / 1e3, askBudget: Math.round(askBudget * 1e3) / 1e3, bidBudget: Math.round(bidBudgetCapped * 1e3) / 1e3, bidBudgetUncapped: Math.round(bidBudget * 1e3) / 1e3, buyBookCapSbd, deployCap: 0.6 },
      publishedAt: now,
    };
    if (persist) {
      writeJson(path.join(STATE, "offer.json"), offer);
      appendLine(path.join(STATE, "events.jsonl"), { type: "offer.published", at: now, verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length, flowAsks: plan.flowAsks?.length ?? 0, flowBids: plan.flowBids?.length ?? 0, bestAsk: book?.bestAsk ?? null, bestBid: book?.bestBid ?? null });
    }
    return { verdict: plan.verdict, asks: plan.asks.length, bids: plan.bids.length, flowAsks: plan.flowAsks?.length ?? 0, flowBids: plan.flowBids?.length ?? 0, staleCount: staleCls.stale.length, skew: skew.skew, book, market: pulse ? { tradesPerDay: pulse.tradesPerDay, spreadBps: pulse.book?.spreadBps ?? null } : null, liquidity: { ...offer.liquidity, bidBudgetCapped: true } };
  });

  /* 5 · convert-plan: R245-b feed-vs-parity doctrine (D-023 face-gap was the
   * HBD model mis-ported — SBD conversion pays at the witness feed rate) */
  report.steps.convert = await stepWrap("convert", async () => {
    const prev = readJson(path.join(STATE, "convert-state.json"), { armed: false, pendingSbd: 0 });
    const inv = obs.ok ? (obs.inventory ?? { sbd: 0 }) : { sbd: 0 };
    const marketSbdUsd = obs.ok ? (obs.sbdUsd ?? 0) : 0;
    const plan = planConvert({
      liquidSbd: inv.sbd ?? 0, feedSbdPerSteem: obs.ok ? obs.feed : 0,
      marketSbdPerSteem: obs.ok ? (obs.parity?.parity ?? null) : null,
      previouslyArmed: !!prev.armed, pendingSbd: prev.pendingSbd ?? 0,
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

  /* 5.5 · redeploy: T-91 doctrine — realized value flows back by fixed ratios.
   * THE LAW: cashing out NEVER stops the autonomy. The plan is pure doctrine
   * math; the EXECUTION (power-up op) happens in the execute step, gated by
   * operator.allowPowerUp + the signer's think-gate (self-directed only).
   * PACING LAW (R231 review): convergence must not churn — at most ONE
   * power-up per minIntervalSec, at most maxPerDay per day. A paced-out
   * plan reads REDEPLOY-COOLDOWN here (the pure plan stays in the file,
   * transparent), and the execute step naturally skips it. */
  report.steps.redeploy = await stepWrap("redeploy", async () => {
    const rd = armedConf().redeploy ?? {};
    const inv = obs.ok ? (obs.inventory ?? { steem: 0, sbd: 0 }) : { steem: 0, sbd: 0 };
    const plan = planRedeploy({
      now,
      liquidSteem: inv.steem ?? 0, liquidSbd: inv.sbd ?? 0,
      buyBookPct: rd.buyBookPct ?? 0.5, powerUpPct: rd.powerUpPct ?? 0.3, reservePct: rd.reservePct ?? 0.2,
      liquidSteemFloor: rd.liquidSteemFloor ?? 5, liquidSbdFloor: rd.liquidSbdFloor ?? 0.5,
      minPowerUpSteem: rd.minPowerUpSteem ?? 5,
    });
    /* pacing state — honest counter, seeded by the operator or the machine.
     * R233: the decision itself is the PURE redeployPacing() — corruption
     * classes (NaN/negative/future lastPowerUpAt) are guarded by design and
     * unit-tested, not by accident. */
    const RS_FILE = path.join(STATE, "redeploy-state.json");
    const today = now.slice(0, 10);
    const { rs, corrupt: rsCorrupt } = readPacingState(RS_FILE, today, now);
    if (rsCorrupt && persist) appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.pacing-corrupt", at: now, healed: true, day: today, powerUpsToday: rs.powerUpsToday ?? 0, lastPowerUpAt: rs.lastPowerUpAt ?? null });
    if (rs.day !== today) { rs.day = today; rs.powerUpsToday = 0; }
    const minIntervalSec = rd.minIntervalSec ?? 3600;
    const maxPerDay = rd.maxPerDay ?? 12;
    const sinceLastSec = rs.lastPowerUpAt ? Math.round((Date.now() - Date.parse(rs.lastPowerUpAt)) / 1000) : null;
    const pacing = redeployPacing({ verdict: plan.verdict, sinceLastSec, powerUpsToday: rs.powerUpsToday ?? 0, minIntervalSec, maxPerDay });
    if (pacing.verdict) {
      plan.verdict = "REDEPLOY-COOLDOWN";
      plan.reason = pacing.reason;
    }
    plan.pacing = { minIntervalSec, maxPerDay, powerUpsToday: rs.powerUpsToday ?? 0, lastPowerUpAt: rs.lastPowerUpAt, sinceLastSec, verdict: pacing.verdict };
    /* R237-C POWER-UP INTELLIGENCE — the calculated layer ON TOP of the pure
     * doctrine: measured factors (ladder ask-need from this cycle's offer,
     * RC pressure) explain the decision and may scale the power-up DOWN to
     * protect the grid. planRedeploy itself stays untouched (doctrine math
     * exact — selftest P2/P4 hold); the scale lives in execution only. */
    let intel = null;
    if (plan.verdict === "REDEPLOY-PLAN") {
      const offerNow = readJson(path.join(STATE, "offer.json"), null);
      const askNeed = Math.max(0, offerNow?.liquidity?.askBudget ?? 0);
      intel = redeployIntel({
        planned: plan.powerUpSteem,
        liquidSteem: inv.steem ?? 0,
        floorSteem: rd.liquidSteemFloor ?? 5,
        askNeed,
        rcPct: obs.ok ? obs.inventory?.rcPct ?? null : null,
      });
      plan.intel = intel;
    }
    if (persist) {
      writeJson(path.join(STATE, "redeploy-plan.json"), plan);
      appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.planned", at: now, verdict: plan.verdict, reason: plan.reason, powerUpSteem: plan.powerUpSteem, excessSteem: plan.excessSteem, ratios: plan.ratios, pacing: pacing.verdict, intel: intel ? { verdict: intel.verdict, scale: intel.scale, reason: intel.reason } : null });
    }
    return { verdict: plan.verdict, reason: plan.reason, powerUpSteem: plan.powerUpSteem, excessSteem: plan.excessSteem, ratios: plan.ratios, pacing: pacing.verdict ?? null, intel: intel ? { verdict: intel.verdict, scale: intel.scale, reason: intel.reason, urgency: intel.urgency } : null };
  });

  /* join the parallel curate branches here (they never gate the front chain) */
  report.steps.curate = await curateP;
  report.steps["army-curate"] = await armyCurateP;
  report.steps["tag-roi"] = await tagRoiP;
  report.steps["capital-route"] = await capitalRouteP;

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

    /* WAVE-91 SELF-CROSS GUARD (measured 2026-10-16): the 10-14 cycle sold
     * 297.1 STEEM into OUR OWN resting bid (fill_order current_orderid
     * 948945592 → open_orderid 2026101404) — a pure spread loss paid to
     * nobody. LAW: a new ask must rest strictly ABOVE every own resting
     * bid; a new bid strictly BELOW every own resting ask. The price
     * adjusts (lift/sink SELF_CROSS_BPS); co-layer orders are never
     * cancelled here (T-19 partition law unchanged). In-batch ops count
     * too — the chain applies ops sequentially, so an ask earlier in the
     * same tx can cross a bid later in it. dexflow is race-safe by its
     * cycle-marker respect; its TTL leftovers are real resting orders and
     * are honored by this guard. */
    const SELF_CROSS_BPS = 10;
    const guardNote = [];
    const selfCrossCancelSet = new Set([...staleIds, ...flowRequoteIds]);
    const selfAsks = [], selfBids = [];
    /* WAVE-91 sane band: only prices within [0.2×ref, 5×ref] of a measured
     * reference are real crossing risks; anything outside is data-corrupt or
     * fat-finger and is CANCELLED (ours-only) instead of distorting prices. */
    const refPx = Number(offer?.marks?.paritySbdPerSteem) > 0 ? Number(offer.marks.paritySbdPerSteem)
      : (Number(offer?.book?.bestBid) > 0 && Number(offer?.book?.bestAsk) > 0 ? (Number(offer.book.bestBid) + Number(offer.book.bestAsk)) / 2 : null);
    const insaneOursIds = [];
    try {
      const restingSelf = await openOrders(ACCOUNT);
      for (const o of (restingSelf?.ok ? restingSelf.orders : [])) {
        const id = Number(o.orderid);
        if (selfCrossCancelSet.has(id)) continue; // cancelled earlier in this same batch
        if (!(o.unit > 0)) continue;
        const insane = refPx > 0 && (o.unit < refPx * 0.2 || o.unit > refPx * 5);
        if (insane) {
          if (oursSet.has(id) && insaneOursIds.length < 5) insaneOursIds.push({ id, side: o.side, unit: o.unit });
          continue; // never let corrupt prices touch the guard's sets
        }
        (o.side === "ask" ? selfAsks : selfBids).push(o.unit);
      }
      if (!restingSelf?.ok) guardNote.push({ note: "resting-unreadable — guard degraded to in-batch only (honest)" });
    } catch (e) {
      guardNote.push({ note: `resting-read-error: ${String(e?.message ?? e).slice(0, 80)} — guard degraded to in-batch only (honest)` });
    }
    if (insaneOursIds.length) guardNote.push({ note: "insane-own-orders queued for cancel (ours-only, cap 5)", items: insaneOursIds });

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
    // (a0) WAVE-91 insane-price cancels — our own data-corrupt/fat-finger orders
    // (unit outside [0.2×ref, 5×ref], e.g. the 10.18 ask the pre-fix guard made)
    // are cancelled first-class so they can never lock capital or distort the book.
    for (const { id } of insaneOursIds) {
      ops.push(["limit_order_cancel", { owner: ACCOUNT, orderid: id }]);
    }
    // (a2) T-19 flow requote — cancel our previous flow levels (mobile layer), cap 12
    for (const id of flowRequoteIds.slice(0, 12)) {
      ops.push(["limit_order_cancel", { owner: ACCOUNT, orderid: id }]);
    }
    // (b) fresh ladder from LIVE liquid, intel-capped (per-op CLAMPED to caps —
    // a cap must shrink an order, never silently skip the whole ladder side)
    // T-37 · MM GATE: if the chain-measured window says BLEEDING, the ladder
    // does not resume (fail-open gate — only a ≥30-fill/≥2-day measured bleed
    // stops it; see rail-doctrine.mmGate). Throttle state is published so the
    // cockpit and the next cycle see WHY the book went quiet.
    let createdIds = [];
    const mmG = mmGate({ pnl: readJson(path.join(STATE, "mm-gate.json"), null) });
    if (mmG.action === "throttle") {
      writeJson(path.join(STATE, "offer.json"), { verdict: "MM-THROTTLED", blocker: [mmG.reason], gate: mmG.verdict, at: now, publishedAt: now });
      appendLine(path.join(STATE, "events.jsonl"), { type: "mm.throttled", at: now, reason: mmG.reason, verdict: mmG.verdict });
      report.steps.mmGate = { action: "throttle", reason: mmG.reason };
    } else if (offer?.plan) {
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
            /* WAVE-91 self-cross guard: never rest an ask at/below an own bid. */
            let pxAsk = lvl.sbdOut3 != null && amt > 0 ? Math.round((lvl.sbdOut3 / amt) * 1e6) / 1e6 : lvl.unit;
            const maxOwnBid = selfBids.length ? Math.max(...selfBids) : 0;
            let lifted = false;
            if (maxOwnBid > 0 && pxAsk <= maxOwnBid) {
              pxAsk = Math.round(maxOwnBid * (1 + SELF_CROSS_BPS / 1e4) * 1e6) / 1e6;
              lifted = true;
              guardNote.push({ side: "ask", id, from: lvl.unit, to: pxAsk, why: `own-bid@${maxOwnBid}` });
            }
            const sOut = lifted ? Math.round(amt * pxAsk * 1e3) / 1e3 : (lvl.sbdOut3 != null ? lvl.sbdOut3 : amt * lvl.unit);
            selfAsks.push(pxAsk);
            ops.push(["limit_order_create", { owner: ACCOUNT, orderid: id, amount_to_sell: `${amt.toFixed(3)} STEEM`, min_to_receive: `${sOut.toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + 86400 }]);
            createdIds.push({ id, side: "ask", unit: pxAsk, tranche: lvl.tranche ?? "value", amountSteem: amt, at: now });
            askSum = Math.round((askSum + amt) * 1e6) / 1e6;
          } else {
            const amt = Math.min(lvl.amountSbd, Math.max(0, bidCap - bidSum), Math.max(0, (conf.maxBidSbdPerCycle ?? 20) - bidSum));
            if (amt < 0.001) break;
            const id = (tSec + ops.length) >>> 0;
            /* WAVE-91 self-cross guard: never rest a bid at/above an own ask. */
            let pxBid = lvl.steemOut3 != null && amt > 0 ? Math.round((amt / lvl.steemOut3) * 1e6) / 1e6 : lvl.unit;
            const minOwnAsk = selfAsks.length ? Math.min(...selfAsks) : Infinity;
            let sunk = false;
            if (Number.isFinite(minOwnAsk) && minOwnAsk > 0 && pxBid >= minOwnAsk) {
              pxBid = Math.round(minOwnAsk * (1 - SELF_CROSS_BPS / 1e4) * 1e6) / 1e6;
              sunk = true;
              guardNote.push({ side: "bid", id, from: lvl.unit, to: pxBid, why: `own-ask@${minOwnAsk}` });
            }
            const stOut = sunk ? Math.round(amt / pxBid * 1e3) / 1e3 : (lvl.steemOut3 != null ? lvl.steemOut3 : amt / lvl.unit);
            selfBids.push(pxBid);
            ops.push(["limit_order_create", { owner: ACCOUNT, orderid: id, amount_to_sell: `${amt.toFixed(3)} SBD`, min_to_receive: `${stOut.toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + 86400 }]);
            createdIds.push({ id, side: "bid", unit: pxBid, tranche: lvl.tranche ?? "value", amountSbd: amt, at: now });
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
    // (d2) T-91 redeploy execution — power-up the doctrine share of excess
    // STEEM (transfer_to_vesting, self-directed, op-id 3 chain-verified).
    // Gates: operator.allowPowerUp + REDEPLOY-PLAN (pacing already applied
    // in the redeploy step) + active-only batch (a claim in the batch means
    // posting-authority mix → defer like convert) + OPS-CAP compliance (the
    // power-up never busts maxOpsPerCycle) + BATCH-FUNDS GUARD (the ladder's
    // fresh ask locks + the vest amount can never exceed chain liquid above
    // the floor — one tx must always be fundable end-to-end).
    const rdExec = report.steps.redeploy;
    if (conf.operator?.allowPowerUp === true && rdExec?.verdict === "REDEPLOY-PLAN" && (rdExec.powerUpSteem ?? 0) >= 0.001) {
      if (ops.some(([n]) => n === "claim_reward_balance")) {
        report.steps.redeployDeferredForClaim = true;
      } else if (ops.length >= maxOpsPerCycle) {
        report.steps.redeployDeferredForOpsCap = { ops: ops.length, cap: maxOpsPerCycle };
      } else {
        try {
          const accRd = await accountState(ACCOUNT);
          const floorSteem = conf.redeploy?.liquidSteemFloor ?? 5;
          const steemLockedThisBatch = createdIds
            .filter((c) => c.side === "ask")
            .reduce((s, c) => s + (c.amountSteem ?? 0), 0);
          /* R237-C: the intelligence layer recomputed on FRESH chain reads
           * (binding) — doctrine share × protective scale, then the existing
           * batch-funds guard. Never above doctrine, journaled either way. */
          const offerExec = readJson(path.join(STATE, "offer.json"), null);
          const intelExec = redeployIntel({
            planned: rdExec.powerUpSteem,
            liquidSteem: accRd.ok ? accRd.steem ?? 0 : 0,
            floorSteem,
            askNeed: Math.max(0, offerExec?.liquidity?.askBudget ?? 0),
            rcPct: accRd.ok ? accRd.rcPct ?? null : null,
          });
          report.steps.redeployIntel = { ...intelExec };
          if (persist) appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.intel", at: now, planned: rdExec.powerUpSteem, scale: intelExec.scale, verdict: intelExec.verdict, reason: intelExec.reason, urgency: intelExec.urgency ?? null, factors: intelExec.factors });
          const amt = Math.min(
            rdExec.powerUpSteem * (intelExec.scale ?? 1),
            Math.max(0, (accRd.ok ? accRd.steem ?? 0 : 0) - floorSteem - steemLockedThisBatch),
          );
          const amt3 = Math.floor(amt * 1000) / 1000;
          if (amt3 >= 0.001) {
            ops.push(["transfer_to_vesting", { from: ACCOUNT, to: ACCOUNT, amount: `${amt3.toFixed(3)} STEEM` }]);
            /* pacing state bumped at PUSH time — honest conservative counter */
            const RS_FILE = path.join(STATE, "redeploy-state.json");
            const rdDay = now.slice(0, 10);
            const { rs: rsExec, corrupt: rsCorruptExec } = readPacingState(RS_FILE, rdDay, now);
            if (rsCorruptExec && persist) appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.pacing-corrupt", at: now, healed: true, day: rdDay, powerUpsToday: rsExec.powerUpsToday ?? 0, lastPowerUpAt: rsExec.lastPowerUpAt ?? null });
            if (rsExec.day !== rdDay) { rsExec.day = rdDay; rsExec.powerUpsToday = 0; }
            writeJson(RS_FILE, { day: rdDay, powerUpsToday: (rsExec.powerUpsToday ?? 0) + 1, lastPowerUpAt: now });
            if (persist) appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.powerup-op", at: now, amountSteem: amt3 });
          } else {
            /* R233/R237: the funds-bound skip is JOURNALED, never silent —
             * the battery found the old path vanished without a trace; the
             * intel verdict names WHICH guard bound (funds vs grid-protect) */
            report.steps.redeploySkippedForFunds = { planned: rdExec.powerUpSteem, chainSteem: accRd.ok ? accRd.steem ?? null : null, floorSteem, steemLockedThisBatch, intel: intelExec?.verdict ?? null };
            if (persist) appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.skipped-funds", at: now, ...report.steps.redeploySkippedForFunds });
          }
        } catch (e) {
          /* honest skip — next cycle retries on fresh plan; the skip itself
           * is journaled (R233: silent catch was an observability gap) */
          report.steps.redeploySkippedForProbe = String(e?.message ?? e).slice(0, 200);
          if (persist) appendLine(path.join(STATE, "events.jsonl"), { type: "redeploy.skipped-probe", at: now, error: report.steps.redeploySkippedForProbe });
        }
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
      const cancelled = new Set([...staleIds, ...flowRequoteIds, ...insaneOursIds.map((x) => x.id)]);
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
    if (persist && guardNote.length) appendLine(path.join(STATE, "events.jsonl"), { type: "self-cross-guard", at: now, actions: guardNote.slice(0, 20) });
    return { verdict: res.verdict, txid: res.txid ?? null, ops: ops.length, opNames: res.opNames ?? ops.map(([n]) => n), node: res.node ?? null, error: res.error ?? null, promo, opsToday: opsDay.opsToday + ops.length, opsDayCap, cancels: staleIds.length, created: createdIds.length, hyperLayer: hyperEnabled ? "hypergrid-owns-flow" : "cycle-flow-tranche", selfCrossGuard: guardNote.length ? guardNote : null };
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
    /* W23 · FLEET-WIDE GRID (owner trace 1a15937c02271931: "מסחר גריד בסטימיט
     * של כל החשבונות … יעבדו כחברה משותפת"): every GRID-ACTIVE body on the
     * freshest measured board joins the grid pass — computed BEFORE the
     * legacy early-return (the measured bug: the keyless legacy roster
     * blocked the whole verified fleet from ever quoting). The master is
     * excluded (its hyper-grid IS its ladder); the custody fast-gate inside
     * runSoldierGrids freezes keyless names per-body (zero reads, one row). */
    const fmBoard = readFleetMatrix();
    const legacyNames = new Set((stNow.deployed ? stNow.accounts : []).map((s) => s.name));
    const fleetRoster = (fmBoard?.rows ?? [])
      .filter((r) => r.name && r.name !== ACCOUNT && r.class === "GRID-ACTIVE" && !legacyNames.has(r.name))
      .map((r) => r.name);
    if (fleetRoster.length) appendLine(path.join(STATE, "events.jsonl"), { type: "soldiers.fleet-roster", at: now, count: fleetRoster.length, roster: fleetRoster });
    if (!live.length && !fleetRoster.length) {
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
      extraRoster: fleetRoster,
    });
    const verdict = deploy && !deploy.ok ? `DEPLOY-${deploy.verdict}` : grids.verdict;
    return {
      verdict, deploy: deploy ? { verdict: deploy.verdict, txid: deploy.txid ?? null, error: deploy.error ?? null } : null,
      topups, grids: grids.soldiers ?? [],
    };
  });

  /* W12 · fleet-matrix (owner order 2026-10-19: "קודם וודא הפעלה מרבית של
   * כל הצי"): the measured activation board of the whole estate — custody,
   * balances, RC tanks, 24h chain-truth activity, activation class + gap
   * list. READ-ONLY, fail-isolated. Written every cycle so the cockpit and
   * the rebalance rail always read a fresh board. */
  report.steps.fleetMatrix = await stepWrap("fleet-matrix", async () => {
    const m = await measureFleetMatrix({ now });
    return {
      verdict: `ACTIVATION-${Math.round(m.activation.rate * 100)}pct`,
      activation: m.activation,
      totals: m.totals,
      gaps: m.gaps.map((g) => `${g.name}:${g.class}`),
    };
  });

  /* W12-D · fleet-fills (the estate one-body fill sweep): the maker book is
   * 13 accounts, but the ledger only ever saw the master — the fleet's
   * realized P&L was structurally invisible. A cadence-gated sweep (≥30min,
   * ≤14 accounts, fail-isolated per body) merges every GRID-ACTIVE/CURATE-
   * ONLY body's chain fills into ONE global ledger with trx-level dedupe
   * (a fill_order trx sits in BOTH parties' histories — counted once, the
   * one-body law), then rolls the window up. Zero keys, read-only. */
  report.steps.fleetFills = await stepWrap("fleet-fills", async () => {
    const sweepMark = readJson(path.join(STATE, "fills-fleet-sweep.json"), null);
    if (!shouldFleetSweep(sweepMark?.at)) return { verdict: "SKIP-RECENT", lastSweepAt: sweepMark.at };
    const m = readFleetMatrix();
    const rows = (m?.rows ?? []).filter((r) => r.name !== MASTER
      && (r.class === "GRID-ACTIVE" || r.class === "CURATE-ONLY")
      && (r.custody === "verified" || r.custody === "master-verified" || r.custody === "era-verified" || r.custody === "master-era-verified")).slice(0, 14);
    let accounts = 0, added = 0, errs = [];
    for (const r of rows) {
      try {
        const one = await measureAll(r.name, { window: 400 });
        if (Array.isArray(one?.fills) && one.fills.length) {
          const tagged = one.fills.map((f) => ({ ...f, account: r.name }));
          const res = mergeFillLedger(tagged, { now });
          added += res.added;
        }
        accounts += 1;
      } catch (e) {
        errs.push(`${r.name}:${String(e?.message ?? e).slice(0, 60)}`);
      }
    }
    const roll = runFills({ now });
    const mark = { at: now, accounts, added, errs: errs.slice(0, 6), roll: { fillsTotal: roll.fillsTotal, windowDays: roll.windowDays, perDayReady: roll.perDayReady, realizedSbd: roll.realizedSbd } };
    if (persist) writeJson(path.join(STATE, "fills-fleet-sweep.json"), mark);
    return { verdict: accounts ? `SWEPT-${accounts}` : "NO-ROWS", added, errs: errs.length, windowDays: roll.windowDays, perDayReady: roll.perDayReady };
  });

  /* W12 · fleet-rebalance (划转互填 — the mutual-support rail): plans the
   * measured moves (sweep / sp-ladder / idle-recall) and executes EXACTLY
   * as far as the standing policy allows — the think-gate owns every
   * broadcast; delegation moves stay PLAN-ONLY with their one-flag arm.
   * Fail-isolated like every step. */
  report.steps.fleetRebalance = await stepWrap("fleet-rebalance", async () => {
    const out = await runFleetRebalance({ now });
    return {
      verdict: out.verdict ?? "NO-OP",
      planned: out.planOnly?.length ?? 0,
      executed: out.executed?.length ?? 0,
      refused: out.refused?.length ?? 0,
      planPreview: (out.planOnly ?? []).slice(0, 4).map((m) => `${m.kind}:${m.to ?? ""}:${m.sp ?? m.vests ?? ""}`),
    };
  });

  /* 8.5 · community (R246): the sovereign community organ — steady-state
   * membership sync only (custody-verified accounts, ≤2 joins/cycle, idempotent).
   * Creation itself is a one-shot operator-ordered action (community-launch.mjs)
   * that never runs inside the cycle. Fail-isolated like every step. */
  report.steps.community = await stepWrap("community", async () => {
    const cst = readCommunityState();
    if (!cst?.name) return { verdict: "NO-COMMUNITY" };
    const sync = await syncCommunityMembership({ now, persist });
    return { verdict: sync.verdict, name: cst.name, phase: cst.phase, members: (cst.fleet?.subscribed ?? []).length, joined: sync.joined ?? 0, missing: sync.missing ?? 0 };
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

  /* R308 · THE POSTING STREAM, WIRED (operator order: release the rails to
   * full activity — R287 built the bounded broadcast path and no loop ever
   * called it: BROADCAST-READY sat staged while the operator saw no posts).
   * The gate order is UNCHANGED (mode → armed → kill-switch → daily cap →
   * per-account gap → dedupe → live-authority sig-verify); caps bind both
   * modes; the chain is the anchor, the sent-ledger is the trace.
   * Fail-isolated like every rail. */
  report.steps.streamer = await stepWrap("streamer", async () => {
    /* R310 · THE PER-CYCLE BURST (engineering: the cycle fires every few
     * minutes; ONE broadcast per cycle left the released 14/day cap mostly
     * unspent while fat drafts piled up — artificial quiet. Up to 3
     * broadcasts per cycle now, EVERY one through the FULL gate stack —
     * mode → armed → kill-switch → daily cap → per-account gap → dedupe →
     * sig-verify still bind per post; the burst only stops at the first
     * non-BROADCASTED verdict). */
    const outs = [];
    for (let i = 0; i < 3; i++) {
      const o = await runStreamer({ now: now ?? undefined });
      outs.push(o);
      if (o?.verdict !== "BROADCASTED") break;
    }
    const last = outs[outs.length - 1] ?? {};
    const broadcasts = outs.filter((o) => o?.verdict === "BROADCASTED").length;
    return { verdict: last?.verdict ?? null, mode: last?.mode ?? null, account: last?.account ?? null, txid: last?.txid ?? null, permlink: last?.permlink ?? null, broadcasts, txids: outs.filter((o) => o?.txid).map((o) => String(o.txid).slice(0, 12)), staged: last?.stage?.staged ?? null, stagedRevenue: last?.stage?.stagedRevenue ?? null, revenuePublished: last?.stage?.revenuePublished ?? null, drafts: last?.stage?.totalInQueue ?? null, ms: last?.ms ?? null };
  });

  /* R254 · THE ORGANIC WATCH (wired at last — it existed since R243 but no
   * caller): the network's verdict on our last posts + THE DOWNVOTE VETO —
   * any flag pauses the author's rail (analysis-first resumption). */
  report.steps.organic = await stepWrap("organic", async () => {
    const out = await runOrganicWatch({ now });
    return { verdict: out.organic?.verdict ?? null, activePauses: Object.keys(out.pauses ?? {}).length, flags: out.posts?.reduce((n, p2) => n + (p2.flags ?? 0), 0) ?? 0, ms: null };
  });

  /* R299 · THE UN-SHELL METER (the shelling incident): the frontend-level
   * shell state of the roster is invisible to the chain API — this step
   * probes steemit.com profile pages from the engine's own vantage and
   * records render/shell/challenge HONESTLY (read-only, zero keys).
   * Fail-isolated like every rail. */
  report.steps.shellWatch = await stepWrap("shell-watch", async () => {
    const out = await runShellWatch({ now, roster: [masterAccount(), ...ARMY_ROSTER] });
    return { verdict: out.summary?.verdict ?? null, shelled: out.summary?.shelled ?? null, rendered: out.summary?.rendered ?? null, challenged: out.summary?.challenged ?? null, control: out.control?.verdict ?? null };
  });

  /* R300 · THE MULTI-FRONTEND CENSUS (owner order 2026-10-14: "יש עוד רשתות
   * שמציגות בבלוקצ'יין של סטימיט בוא נעבוד איתם"): steemit.com is one
   * frontend among many — the census measures the roster across the chain
   * nodes and every public frontend we can reach (wallet · steemworld ·
   * steemdb · steemscan), so the network knows WHERE it is visible
   * regardless of one gatekeeper's filter. Read-only, zero keys,
   * fail-honest per cell. Fail-isolated like every rail. */
  report.steps.visibility = await stepWrap("visibility", async () => {
    const out = await runVisibilityCensus({ now, roster: [masterAccount(), ...ARMY_ROSTER] });
    return { verdict: out.summary?.verdict ?? null, chain: out.summary?.chain ?? null, nodes: out.summary?.nodes ?? null, steemit: out.summary?.steemit ?? null, alt: out.summary?.alt ?? null, altRenderedAccounts: out.summary?.altRenderedAccounts ?? null, judged: out.summary?.cells?.judged ?? null, totalCells: out.summary?.cells?.total ?? null };
  });

  /* R255 · THE PERSONA PROFILE SYNC (the visibility law): on-chain profiles
   * become organized personas (name/about/interests, merged metadata,
   * idempotent, ≤2/run, custody-gated). Fail-isolated. */
  report.steps.profiles = await stepWrap("profiles", async () => {
    const out = await runProfiles({ now });
    return { verdict: out.updated.length > 0 ? "PROFILES-UPDATED" : out.deferred.some((d) => String(d.reason ?? "").startsWith("custody")) ? "CUSTODY-DEFERRED" : "SYNCED", updated: out.updated.length, skipped: out.skipped.length, deferred: out.deferred.length, ms: out.ms ?? null };
  });

  /* R254 · THE HIVE ORGAN (operator-approved trial, verbatim: "אני מאשר
   * ניסיון ובחינה פתיחה בhive"): probe-sized sovereign rounds on the sister
   * chain from the GEN-1 vault keys, stricter gates, RC-gated, veto-armed.
   * BLURT (R294, owner order 2026-10-11 — supersedes the R254 pause
   * "לגבי blurt תמתין"): the line lives as a measured keyless probe every
   * cycle (accounts + posting authorities + mana, public data only);
   * broadcasting stays behind the deliberate owner arm-file AND the general
   * blurt tx serializer. Fail-isolated. */
  report.steps.hive = await stepWrap("hive", async () => {
    const out = await runHiveRail({ now, limit: 2 });
    return { verdict: out.verdict, executed: out.executed ?? 0, custody: out.custody ?? null, reason: out.reason ?? null, ms: out.ms ?? null };
  });

  report.steps.blurt = await stepWrap("blurt", async () => {
    const out = await runBlurtOrgan({ now });
    return { verdict: out.verdict, mode: out.mode ?? null, reason: out.reason ?? null, existing: out.probe?.existing ?? null, roster: out.probe?.roster ?? null, ms: null };
  });

  /* R262 · HIVE PROFILES (operator order: professional profile + image for
   * EVERYONE on Hive, macrame first): persona identity + verified Wikimedia
   * images via account_update2, idempotent vs the chain, custody-gated. */
  report.steps.hiveProfiles = await stepWrap("hiveProfiles", async () => {
    const out = await runHiveProfiles({ now });
    return { verdict: out.verdict, updated: out.updated?.length ?? 0, skipped: out.skipped?.length ?? 0, deferred: out.deferred?.length ?? 0, ms: out.ms ?? null };
  });

  /* R262 · THE RC MUTUAL-AID POOL (operator order: "להחזיר להפעיל את כולם
   * על Hive"): measured RC budgets showed five accounts structurally under
   * the post line (max_rc < 2.3B, waiting never fixes that). Donors inside
   * our own custody lift them via delegate_rc; every lift is re-measured
   * and journaled; the chain judges each broadcast. */
  report.steps.rcPool = await stepWrap("rcPool", async () => {
    const out = await runRcPool({ now });
    return { verdict: out.verdict, lifts: out.lifts?.length ?? 0, measured: out.measured ?? null, deferred: out.deferred?.length ?? 0, ms: out.ms ?? null };
  });

  /* R262 · THE HIVE COMMUNITY LOOP (operator order: everyone active in their
   * time, going over the community members, replying and voting per ability
   * — our own channel): anti-herd fleet votes @25%, persona-voiced comments
   * on the least-commented sibling post, deepens on answers to us. Capped,
   * RC-gated, veto-armed, seeded schedules (auditability law). */
  report.steps.hiveSocial = await stepWrap("hiveSocial", async () => {
    const out = await runHiveSocial({ now });
    return { verdict: out.verdict, executed: out.executed ?? 0, custody: out.custody ?? null, reason: out.reason ?? null, ms: out.ms ?? null };
  });

  /* T-88 · AGENT-BUS (R243): the agents talk THROUGH the chain — the engine
   * serves its inbox (receipts/thresholds/custody notes from other runners:
   * sandbox, CI, future hosts all read+write the same sovereign mail) and
   * publishes one custody-gated cycle receipt. Rate-limited, fail-soft. */
  report.steps.bus = await stepWrap("bus", async () => {
    const out = await runBus({ now, cycleReport: report });
    return { verdict: out.verdict, delivered: out.delivered ?? 0, published: out.published ?? 0, ms: out.ms ?? null };
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

  /* T-553 · INCOME STEP WIRING: runIncome (T-29) was an orphaned instrument —
   * exported, correct, and called by NOBODY; income.json froze at 2026-10-02
   * for 18 days while the wall rendered it as if alive. Same discipline as the
   * payouts step: day-gated (one chain scan/day), read-only chain truth
   * (get_accounts + dynamic props + account_history), zero credentials,
   * zero signing. The income classes never merge (claims / trading / pending
   * face / estimate — each labeled). */
  report.steps.income = await stepWrap("income", async () => {
    const today = now.slice(0, 10);
    const cached = incomeState();
    if (cached?.day === today && cached?.verdict) {
      return { verdict: cached.verdict, day: today, usdPerDay7d: cached.income?.usdPerDay7d ?? null, totalRealizedUsd: cached.income?.totalRealizedUsd ?? null, cached: true };
    }
    const out = await runIncome({ now, account: ACCOUNT });
    return { verdict: out.verdict, day: out.day ?? today, usdPerDay7d: out.income?.usdPerDay7d ?? null, totalRealizedUsd: out.income?.totalRealizedUsd ?? null, cached: false };
  });

  /* R282 · SOLDIER CLAIMS: the income-capture rail — chain-truth pending
   * rewards on the ARMY accounts get claimed (canonical op 39, posting
   * authority) instead of rotting on-chain. The R282 measured gap:
   * israelnews held 359.77 vests + 0.223 STEEM pending with NO claim path.
   * Bounded (maxClaimsPerRun), chain-truth-triggered, journaled. */
  report.steps.soldierClaims = await stepWrap("soldierClaims", async () => {
    const s = await runSoldierClaims({ now, execute: true });
    return { verdict: s.verdict, scanned: s.scanned, rosterSize: s.rosterSize, pendingAccounts: s.pendingAccounts.length, claimed: s.claimed.length, failed: s.failed.length, txids: s.claimed.filter((c) => c.txid).map((c) => c.txid).slice(0, 5) };
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

  /* R237-B · COUNCIL: the engine reads its fellow organs LIVE (custodian
   * :3041, metrics :3042, builder :3043) — measured verdicts, never assumed.
   * Cadence-gated deep gossip: full reads every cycle (cheap, 3 × /health),
   * the builder work-order at most 1/day and only when its queue is empty —
   * the machine feeds its engineer organ ONE evidence-backed task carrying
   * the top measured lesson (memory/ is inside the builder's path law).
   * Fail-isolated: a dark organ journals DOWN — it never blocks the cycle. */
  report.steps.council = await stepWrap("council", async () => {
    const prevCouncil = readJson(path.join(STATE, "council.json"), null) ?? {};
    const today = now.slice(0, 10);
    const taskDay = prevCouncil?.builderTask?.at ? String(prevCouncil.builderTask.at).slice(0, 10) : null;
    let builderTask = null;
    const builderOrgan = (prevCouncil?.organs ?? []).find((o) => o?.id === "builder");
    const queueEmpty = (builderOrgan?.evidence?.builder?.queue ?? 0) === 0;
    if (taskDay !== today && queueEmpty) {
      const lessons = readJson(path.join(STATE, "learning.json"), null)?.lessons ?? [];
      const top = Array.isArray(lessons) ? lessons[0] : null;
      if (top && (top.id || top.lesson)) {
        builderTask = {
          file: "memory/lessons.md",
          basis: `measured lesson ${top.id ?? "?"} from state/learning.json`,
          task: `הוסף שורת-לקח אחת ל-memory/lessons.md: [${now.slice(0, 10)}] ${String(top.id ?? "").slice(0, 60)} — ${String(top.lesson ?? top.summary ?? "").slice(0, 240)} (מקור: state/learning.json, מדוד). הצע עריכה אחת: find = השורה-האחרונה בקובץ, replace = השורה-האחרונה + שורת-הלקח החדשה.`,
        };
      }
    }
    const out = await runCouncil({ now, builderTask });
    return { verdict: out.mesh, organs: out.organs.map((o) => `${o.id}:${o.verdict}`), builderTask: out.builderTask ? { verdict: out.builderTask.verdict, file: out.builderTask.file, error: out.builderTask.error } : null, error: null };
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
  /* R237-D: every blockage named, owned, classified LAWFUL — surfaced to
   * the cockpit verbatim. A blockage without an owner is the only kind
   * this machine no longer tolerates. */
  report.blockages = blockageLedger({ steps: report.steps, conf: armedConf() });
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
