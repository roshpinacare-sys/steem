/**
 * index.ts — SAOS sovereign engine HTTP service (port 3040).
 * T-12: master credential is ENGINE-HELD (operator's standing order) —
 * signing is doctrine-capped in signer.mjs; credentials never leave memory;
 * every broadcast is journaled with txids (never keys).
 */
import { runCycle, cycleRunning, cycleMarker } from "./daily.mjs";
import { externalParity, internalFeed, accountState, openOrders, measureAll, rpcCall } from "./measure.mjs";
import { execStatus, credentialState, armedConf, adoptCredentialText, verifyRoles, spoilagePublic, armyCustodyState, executeAs } from "./signer.mjs";
import { reviveArmyCustody, ARMY_ROSTER_VAULT } from "./vault-revival.mjs";
import { reviveToolbelt } from "./toolbelt-revival.mjs";
import { reviveIntegrations } from "./integrations-revival.mjs";
import { reviveWriterIdentity } from "../../scripts/sovereign-selfcustody.mjs";
import { soldiersPublic } from "./soldiers.mjs";
import { intelState } from "./intel.mjs";
import { curatorState } from "./curator.mjs";
import { learningState } from "./learning.mjs";
import { adaptationBoot, publicAdaptation } from "./adaptation.mjs";
adaptationBoot(); // R210 §XVI: restart counter — adaptation store proves persistence across boots
import { discoveryState } from "./discovery.mjs";
import { fleetState } from "./fleet.mjs";
import { startHyperGrid, hyperState } from "./hypergrid.mjs";
import { startArmyGrid, armyGridState } from "./armygrid.mjs";
import { startWeaveWitness } from "./weave-witness.mjs";
import { startDexFlow, dexState } from "./dexflow.mjs"; // R323 DEX-FLOW: the volume-taker layer (self-cross trips)
import { startManyHands, manyhandsState } from "./manyhands.mjs"; // G43 ONE-BODY-MANY-HANDS + the sharp taker (shadow-first)
import { runDisperse, disperseState, disperseConf } from "./disperse.mjs"; // W120 internal liquidity dispersion rail
import { startSharpTaker, sharpTakerState } from "./sharp-taker.mjs"; // G44: the master-rail dislocation taker (takeLaw on the custody that lives)
import { startExchangeExec, exchangeExecState } from "./exchange-exec.mjs"; // W17: the HTX executor (deposit+trade, ECG-gated)
import { startExternalQuotes, externalQuotesState } from "./external-quotes.mjs"; // W27-c: the REAL-MONEY external price anchor (Poloniex/Bithumb/Gecko)
import { startFfGate, ffGateState } from "./ff-gate.mjs"; // W27-a: the FixedFloat real-money gate (PENDING-ACTIVATION → ACTIVE → promote)
import { startHedgeDesk, hedgeDeskState } from "./hedge-desk.mjs"; // W28-b: the AutoHedge-adopted advisory hedge desk (risk-first, ZERO signing authority)
import { webintelState } from "./webintel.mjs";
import { contentState } from "./content.mjs";
import { streamState } from "./social-streamer.mjs"; /* R310: the live posts stream (one-body: the engine computes, the cockpit shows) */
import { personasPublic } from "./personas.mjs";
import { bridgeGuardState } from "./bridge-guard.mjs";
import { rcTankState } from "./rctank.mjs";
import { payoutsState } from "./payouts.mjs";
import { soldierClaimsState } from "./soldier-claims.mjs";
import { weaveState } from "./weave.mjs";
import { communityStatus } from "./community.mjs";
/* R287 · REVENUE ARCHITECT: the high-density content compiler (staging rail,
 * never broadcasts) + the live authority watchdog (GPG drift + node-health
 * circuit breaker). Native, zero new dependencies. */
import { compileRevenue, compilerState } from "./content-compiler.mjs";
import { runWatchdog, watchdogState, runNodeHealth, nodeHealthState } from "./authority-watchdog.mjs";
/* R288 · FINANCE DIGEST + YIELD DISTRIBUTOR: telemetry → digest → buffer
 * (operator question #1) and the local token transaction engine for the
 * secondary fleet wallets (operator question #2) — both native, gated. */
import { runFinanceDigest, financeDigestState } from "./finance-digest.mjs";
import { runYieldDistribution, yieldState } from "./yield-distributor.mjs";
/* R292 · CAPITAL ROUTER: profit-maximization + routing matrix + pure-recall
 * executor (recall-shell only — zero-amount delegation cannot create exposure) */
import { computeRouterReport, executeRouterActions, routerState } from "./capital-router.mjs";
import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";

/* T-80: office-selfcheck lawfully owns :3040 in the current organism; the
 * engine binds 3040 by default (historical) but a boot may override via
 * SAOS_ENGINE_PORT — the trading loop must never fight a sibling office. */
const PORT = Number(process.env.SAOS_ENGINE_PORT || 3040);
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const readLines = (p, n = 20) => {
  try {
    return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 120) }; } });
  } catch { return []; }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/* T-583 PUBLIC VISIBILITY: the pulse heartbeat reads /health every 30min and
 * publishes the fleet's activity — until now the ops count lived only in this
 * events stream, so every public pulse carried "ops ?". opsToday = today's
 * lines in state/events.jsonl, cached 30s (the keeper cross-checks /health
 * every 8s — zero per-poll re-read of the ~2MB stream; string-match on the
 * ISO day prefix, no JSON-parse per line). */
const EVENTS_FILE = path.join(STATE, "events.jsonl");
let opsCache: { day: string; n: number; at: number } = { day: "", n: 0, at: 0 };
function opsTodayCount(): number {
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  if (opsCache.day === day && now - opsCache.at < 30_000) return opsCache.n;
  let n = 0;
  try {
    const buf = fs.readFileSync(EVENTS_FILE, "utf8");
    for (const line of buf.split("\n")) if (line.includes(`"at":"${day}`)) n++;
  } catch { /* no stream yet — honest 0 */ }
  opsCache = { day, n, at: now };
  return n;
}

// T-16 brute-force bound for /adopt-credential (in-memory timestamps)
const adoptAttempts: number[] = [];

async function handle(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/health") return json({ ok: true, service: "saos-engine", account: ACCOUNT, at: new Date().toISOString(), keyless: false, credentialMode: "runtime-adopted · WIFs derived on demand (signer.mjs) · memory-only — never persisted, never logged, never returned", opsToday: opsTodayCount(), armyCustody: armyCustodyState([ACCOUNT, ...ARMY_ROSTER_VAULT]), doctrine: "capped-autonomy" });
  if (p === "/status") {
    const execLog = (() => { try { return fs.readFileSync(path.join(STATE, "exec-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(-8).map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 80) }; } }); } catch { return []; } })();
    let exec = null;
    try { exec = await execStatus(); } catch (e) { exec = { ok: false, reason: String(e?.message ?? e).slice(0, 80) }; }
    /* T-22 ONE-BODY LAW: the live chain layer is computed HERE — the Next
     * proxy became a thin renderer; domain logic exists exactly once. */
    const [oo, acc, convR] = await Promise.all([openOrders(ACCOUNT).catch(() => ({ ok: false, orders: [] })), accountState(ACCOUNT).catch(() => ({ ok: false })), rpcCall("condenser_api.get_conversion_requests", [ACCOUNT]).catch(() => ({ ok: false }))]);
    const observe = readJson(path.join(STATE, "observe.json"));
    const offer = readJson(path.join(STATE, "offer.json"));
    /* R246 · the 3.5-day SBD→STEEM convert rail — live chain truth: every
     * in-flight request with its REAL maturity (the chain's own date), hours
     * remaining, and the payout projected at the CURRENT feed (payout =
     * amount/feed at maturity — D-023 measured doctrine). */
    const feedSbdPerSteem = (observe as any)?.feed ?? null;
    const conversions = convR?.ok && Array.isArray((convR as any).result)
      ? (convR as any).result.map((c: any) => {
          const maturesMs = Date.parse(String(c.conversion_date).replace(/Z$/, "") + "Z");
          const amount = Number(String(c.amount ?? "0").split(" ")[0]) || 0;
          return {
            requestid: c.requestid,
            amount: c.amount,
            maturesAt: c.conversion_date,
            hoursRemaining: Number.isFinite(maturesMs) ? Math.round(((maturesMs - Date.now()) / 360000)) / 10 : null,
            expectedSteemAtCurrentFeed: feedSbdPerSteem > 0 ? Math.round((amount / feedSbdPerSteem) * 1000) / 1000 : null,
          };
        })
      : null;
    const community = communityStatus();
    const parityRef = offer?.marks?.paritySbdPerSteem ?? null;
    const pnl = observe?.pnl ?? null;
    const profit = pnl ? {
      ...pnl,
      parityRef,
      unrealizedAtParitySbd:
        (pnl.positionSteem ?? 0) > 1e-9 && parityRef
          ? Math.round((pnl.positionSteem * parityRef - (pnl.positionCostSbd ?? 0)) * 1e6) / 1e6
          : null,
      method: "יסוד-עלות-ממוצע על fill_order חי (A-10, lib.pnlFromFills — מימוש אחד בגוף) · מכירה-בלי-יסוד = unbased, לא רווח",
    } : null;
    return json({
      ok: true, at: new Date().toISOString(), account: ACCOUNT,
      observe,
      state: readJson(path.join(STATE, "state.json")),
      offer,
      convertPlan: readJson(path.join(STATE, "convert-plan.json")),
      conversions,
      community,
      intel: intelState(),
      curator: curatorState(),
      learning: learningState(),
      discovery: discoveryState(),
      soldiers: soldiersPublic(),
      execution: exec,
      credential: credentialState(),
      /* T-16: the visible price of the blocked signing rail (see signer.mjs
       * spoilagePublic — measured days/votes + ESTIMATED steem, never
       * claimed as measured money) */
      spoilage: spoilagePublic(),
      adaptation: publicAdaptation(), // R210: learned-rule state, verdicts only
      fleet: fleetState(),
      /* T-19b HYPER-GRID: the volume layer — live meter + day counter */
      hyper: hyperState(),
      /* R323 DEX-FLOW: the volume-TAKER layer — real fills + accumulating volume */
      dexflow: dexState(),
      /* G43 MANY-HANDS: the one-body fleet grid + the sharp taker (shadow-first) */
      manyhands: manyhandsState(),
      /* G44 SHARP-TAKER: the master-rail dislocation taker (takeLaw · FOK · own id partition) — wiring union-restored W120 */
      sharpTaker: sharpTakerState(),
      /* W17 EXCHANGE-EXEC: the HTX executor — deposit+trade verdicts (typed, journaled) */
      exchangeExec: exchangeExecState(),
      /* W27-c EXT-QUOTES: the real-money external anchor (steemUsd/sbdUsd/implied cross unit) */
      externalQuotes: externalQuotesState(),
      /* W27-a FF-GATE: FixedFloat real-money lane — PENDING-ACTIVATION → ACTIVE → promote plan */
      ffGate: ffGateState(),
      /* W28-b HEDGE-DESK: the AutoHedge-adopted advisory risk desk — GO/TRIM/WIDEN/RETIER/HALT/ABSTAIN from measured book+anchor state (advisory-only forever) */
      hedgeDesk: hedgeDeskState(),
      /* T-22 ONE-BODY live layer — computed by the ENGINE (single source) */
      live: {
        orders: oo.orders ?? [],
        balances: acc.ok ? { steem: acc.steem ?? null, sbd: acc.sbd ?? null, vests: acc.vests ?? null } : null,
        rcPct: acc.ok ? acc.rcPct ?? null : null,
        chainReadOk: acc.ok || oo.ok,
      },
      profit,
      /* T-22 standing teams + the measured scaling curve */
      webintel: webintelState(),
      content: contentState(),
      /* R310 · THE LIVE STREAM: posts on-chain, titles, steemit links, cap/runway — the operator's sight-channel */
      stream: streamState(),
      rcTank: rcTankState(),
      /* T-23 · the payout instrument (estimated→measured converter) + the
       * weave handshake with the second signer (the one-body contract) */
      payouts: payoutsState(),
      weave: weaveState(),
      /* R282 · soldier reward claims (income capture) — verdicts + txids */
      soldierClaims: soldierClaimsState(),
      /* T-21 evidence files the cockpit renders (single source: the engine) */
      roles: readJson(path.join(STATE, "fleet-roles.json")),
      economics: readJson(path.join(STATE, "economics.json")),
      /* R237-B COUNCIL: the live inter-organ mesh — measured verdicts for
       * custodian/metrics/builder + the last engine→builder work-order */
      council: readJson(path.join(STATE, "council.json")),
      /* R254 · the HIVE organ (operator-approved trial): custody verdicts,
       * probe receipts, fleet pause — verdicts only, never keys */
      hive: {
        ops: readJson(path.join(STATE, "hive-ops.json")),
        custody: readJson(path.join(STATE, "hive-custody.json")),
        flagPauses: readJson(path.join(STATE, "flag-pauses.json")),
      },
      /* R255 · THE PERSONA ENGINE (operator: profiles + personality + slang,
       * between professional and neighborhood): canon + sync + arc state —
       * verdicts only, no secrets exist in this layer by construction */
      personas: personasPublic(readJson(path.join(STATE, "personas.json"))),
      /* R263 · THE BRIDGE CIRCUIT BREAKER (the 429-storm law): the cockpit
       * sees whether the LLM bridge is closed/half-open/open and why */
      bridgeGuard: bridgeGuardState(),
      /* R287 · REVENUE RAIL: the BROADCAST-READY staging buffer + the L-26
       * cadence law + the authority watchdog + node-health circuit breaker */
      revenue: compilerState(),
      watchdog: watchdogState(),
      nodeHealth: nodeHealthState(),
      /* R288 · the digest rail (telemetry → intake → buffer) + the yield
       * distribution rail (pool → plan → custody-gated execution) */
      financeDigest: financeDigestState(),
      yieldRail: yieldState(),
      execLog,
      events: readLines(path.join(STATE, "events.jsonl"), 20),
      notes: ["sovereign engine · state lives inside my-project · master credential engine-held, doctrine-capped, never logged", "T-14: continuous-learning layer live — lessons from recorded history, hard-clamped tunings, growth-option discovery", "T-22: one-body law — every domain fact on this page is computed exactly once (here)"],
    });
  }
  if (p === "/hyper") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, ...hyperState() });
  }
  // T-559 ARMY-GRID: one smart body, many hands — the custody-verified army
  // books live (staggered requotes, per-account governors, full gate stack).
  if (p === "/army-grid") {
    return json({ ok: true, at: new Date().toISOString(), master: ACCOUNT, ...armyGridState() });
  }
  // W120 LIQUIDITY-DISPERSE: the internal top-up rail (master → own roster
  // bodies) — GET is the last-run state, POST executes one capped, idempotent
  // run (allowlist + master floor + run caps; ?dry=1 for a measured plan).
  if (p === "/disperse") {
    if (req.method === "POST") {
      try {
        const dry = new URL(req.url, "http://x").searchParams.get("dry") === "1";
        const out = await runDisperse({ dryRun: dry });
        return json({ ok: true, at: new Date().toISOString(), master: ACCOUNT, result: out });
      } catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
    }
    return json({ ok: true, at: new Date().toISOString(), master: ACCOUNT, disperse: disperseState(), conf: disperseConf() });
  }
  if (p === "/payouts") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, payouts: payoutsState() });
  }
  if (p === "/weave") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, weave: weaveState() });
  }
  // T-87: the smart-social rail state (schedules, caps, fleet conversation)
  // — single source: the engine's own social.json + the drafts queue
  if (p === "/social") {
    return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, social: readJson(path.join(STATE, "social.json")), content: contentState() });
  }
  // T-91: the redeployment doctrine — ratios, floors, live plan verdict, law
  if (p === "/redeploy") {
    const conf = armedConf();
    return json({
      ok: true, at: new Date().toISOString(), account: ACCOUNT,
      plan: readJson(path.join(STATE, "redeploy-plan.json")),
      doctrine: conf.redeploy ?? null,
      executionArmed: conf.operator?.allowPowerUp === true,
      law: "מימוש אף-פעם לא עוצר את האוטונומיה — הערך שממומש זורם חזרה למכונה לפי היחסים, מעל רצפות-ההפעלה בלבד",
    });
  }
  if (p === "/cycle") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    /* T-17: START-ACK. The POST returns immediately; the cycle runs detached.
     * The sovereign polls /cycle-status for the marker — no HTTP wait can
     * outlive-or-kill a healthy multi-vote signing cycle again, and the
     * engine-side mutex (daily.mjs cycleInFlight) makes overlap impossible. */
    if (cycleRunning()) {
      return json({ ok: false, error: "cycle-in-flight", since: cycleMarker()?.startedAt ?? null });
    }
    void runCycle().catch((e) => {
      appendLine(path.join(STATE, "events.jsonl"), { type: "cycle.detached-error", at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 200) });
    });
    return json({ ok: true, started: true, at: new Date().toISOString() });
  }
  if (p === "/cycle-status") {
    return json({ ok: true, at: new Date().toISOString(), running: cycleRunning(), marker: cycleMarker() });
  }
  /* R287 · the revenue compiler rail (read-only state + on-demand compile) */
  if (p === "/revenue") {
    return json({ ok: true, at: new Date().toISOString(), revenue: compilerState() });
  }
  if (p === "/revenue-compile") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    try { return json({ ok: true, at: new Date().toISOString(), revenue: compileRevenue() }); }
    catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
  }
  if (p === "/watchdog") {
    return json({ ok: true, at: new Date().toISOString(), watchdog: watchdogState(), nodeHealth: nodeHealthState() });
  }
  /* R288 · the finance digest rail (read-only state + on-demand rebuild) */
  if (p === "/finance-digest") {
    if (req.method === "POST") {
      try { return json({ ok: true, at: new Date().toISOString(), digest: await runFinanceDigest({ force: true }) }); }
      catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
    }
    return json({ ok: true, at: new Date().toISOString(), digest: financeDigestState() });
  }
  /* R288 · the yield distribution rail — GET is the measured plan state;
   * POST /yield-run is the operator-visible execute path (the think gate
   * and the custody gate still own every broadcast decision). */
  if (p === "/yield") {
    return json({ ok: true, at: new Date().toISOString(), yieldRail: yieldState() });
  }
  if (p === "/yield-run") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    try { return json({ ok: true, at: new Date().toISOString(), yieldRail: await runYieldDistribution({ execute: true }) }); }
    catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
  }
  /* R292 · the capital router rail — GET is the computed matrix (ladder +
   * ranked actions); POST /capital-run recomputes and executes the pure-recall
   * execute-now actions through the think gate (single-body law). */
  if (p === "/capital-route") {
    return json({ ok: true, at: new Date().toISOString(), router: routerState() });
  }
  if (p === "/capital-run") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    try {
      const rep = computeRouterReport({ now: new Date().toISOString() });
      if (rep.verdict !== "ROUTED") return json({ ok: false, router: rep });
      const ex = await executeRouterActions({ now: new Date().toISOString(), plan: rep, executeAsFn: executeAs, verifyRolesFn: verifyRoles, masterAcct: ACCOUNT });
      return json({ ok: true, at: new Date().toISOString(), router: rep, executed: ex });
    } catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
  }
  if (p === "/live") {
    try {
      const [par, feed, acc, oo] = await Promise.all([externalParity(), internalFeed(), accountState(ACCOUNT), openOrders(ACCOUNT)]);
      return json({ ok: true, at: new Date().toISOString(), account: ACCOUNT, parity: par, feed, account_state: acc, orders: oo.orders });
    } catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 502); }
  }
  if (p === "/fills") {
    const meas = await measureAll(ACCOUNT);
    return json({ ok: meas.ok, at: new Date().toISOString(), account: ACCOUNT, ...meas });
  }
  /* W12 · the activation board — read-only over the last measured matrix
   * (state/fleet-matrix.json, written every cycle). Never measures inline:
   * a route must stay cheap; freshness lives in the cycle. */
  if (p === "/fleet-matrix") {
    const m = readJson(path.join(STATE, "fleet-matrix.json"), null);
    if (!m) return json({ ok: false, error: "not-measured-yet (the cycle writes it every 10min)" }, 404);
    return json({ ok: true, matrix: m });
  }
  if (p === "/fleet-rebalance") {
    const m = readJson(path.join(STATE, "fleet-rebalance.json"), null);
    if (!m) return json({ ok: false, error: "not-planned-yet (the cycle writes it every 10min)" }, 404);
    return json({ ok: true, rebalance: m });
  }
  if (p === "/exec-status") {
    try { return json({ ok: true, at: new Date().toISOString(), ...(await execStatus()) }); }
    catch (e) { return json({ ok: false, error: String(e?.message ?? e).slice(0, 160) }, 500); }
  }
  // T-15: the unified agent registry — light route (state files + pids only,
  // zero chain reads) so the cockpit can afford it on every refresh
  if (p === "/fleet") {
    return json({ ok: true, at: new Date().toISOString(), fleet: fleetState({ credential: credentialState(), armedConf: armedConf() }), credential: credentialState(), spoilage: spoilagePublic() });
  }
  // T-16 · paste-revival — the fastest self-service path back to a living
  // signing fleet. Contract: the secret arrives as JSON body {text}, is
  // validated (pure), secured (0600 .secrets/), NEVER logged or echoed, and
  // verified against the chain's own authorities BEFORE the answer. Brute
  // force is bounded: 5 attempts/hour in-memory. On success the very next
  // cycle revives the whole signing fleet (zero restart).
  if (p === "/adopt-credential") {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const hourAgo = Date.now() - 3600_000;
    while (adoptAttempts.length && adoptAttempts[0] < hourAgo) adoptAttempts.shift();
    if (adoptAttempts.length >= 5) return json({ ok: false, error: "rate-limited (5/hour) — wait before retrying" }, 429);
    adoptAttempts.push(Date.now());
    let body: { text?: unknown } = {};
    try { body = await req.json() as { text?: unknown }; } catch { return json({ ok: false, error: "json-body required" }, 400); }
    const adopted = adoptCredentialText(String(body.text ?? ""), { source: "cockpit-paste" });
    if (!adopted.ok) return json({ ok: false, stage: "adopt", reason: adopted.reason });
    let ver: Record<string, unknown> | null = null;
    try { ver = await verifyRoles(adopted.account) as unknown as Record<string, unknown>; } catch (e) { ver = { ok: false, reason: String((e as Error)?.message ?? e).slice(0, 120) }; }
    const verified = Boolean((ver as { ok?: boolean } | null)?.ok);
    return json({
      ok: true, stage: "verified", account: adopted.account, fingerprint: adopted.fingerprint,
      verified, verdict: (ver as { verdict?: string } | null)?.verdict ?? (verified ? "VERIFIED" : null),
      reason: (ver as { reason?: string } | null)?.reason ?? null,
      guidance: (ver as { guidance?: string } | null)?.guidance ?? null,
      proposedPubkeys: (ver as { proposedPubkeys?: unknown } | null)?.proposedPubkeys ?? null,
      next: verified ? "the next cycle (≤10min) revives curate/execute/soldiers/promo — or kick a cycle now"
                     : "credential secured but not matching this account's authorities — install the proposedPubkeys on steemit.com, or paste the CURRENT password instead",
    });
  }
  return json({ ok: false, error: "not-found", routes: ["/health", "/status", "/hyper", "/payouts", "/weave", "/social", "/redeploy", "/cycle", "/cycle-status", "/live", "/fills", "/exec-status", "/fleet", "/adopt-credential", "/finance-digest", "/yield", "/yield-run", "/army-grid", "/disperse"] }, 404);
}

// T-15 SINGLE-INSTANCE LAW (measured live: 3 duplicate engine processes were
// found alive — 1 port owner + 2 zombies from a boot race). A second instance
// must NEVER linger: if the port is held by a HEALTHY engine → clean exit
// (adopt, don't duplicate). Only a short dying-process grace retry is allowed
// (the holder may be mid-death: unhealthy → retry 3×1s, then exit — never
// linger forever like the old 8×1.5s loop that leaked zombies).
let bound = false;
let duplicateExit = false;
// T-80 STRENGTHENED SINGLE-INSTANCE LAW (the measured triple-instance event,
// 2026-10-04: three `bun --hot index.ts` processes alive at once — Bun.serve
// does NOT throw EADDRINUSE synchronously on this runtime, so the old bind-
// catch guard never fired and 3 copies raced each other's orders, burning RC
// and journaling "unknown key" failures). Now: BEFORE binding, probe the
// port's health — a live engine answers → I am the duplicate → clean exit.
// The bind-catch path stays as the second line of defense.
for (let probe = 0; probe < 3 && !duplicateExit; probe++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      console.log(`port ${PORT} held by a healthy engine (pre-bind probe) — duplicate-exit (single-instance law)`);
      duplicateExit = true;
      break;
    }
  } catch { /* nothing healthy on the port → proceed to bind */ }
  break;
}
for (let attempt = 1; attempt <= 3 && !bound && !duplicateExit; attempt++) {
  try {
    Bun.serve({
      port: PORT,
      fetch: (req) => handle(req),
      // T-14 root-cause fix (proven in engine.log): Bun's default idleTimeout
      // is 10s — a full cycle takes 10-12s, so the connection was killed
      // mid-cycle and the sovereign got "fetch failed" (1 real cycle fall).
      // 255s = Bun max; doctrine timeout (90s sovereign, 18s exec client)
      // still bounds every caller from the outside.
      idleTimeout: 255,
    });
    bound = true;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (!/EADDRINUSE|address already in use/i.test(msg)) throw e;
    // who owns the port? healthy engine → I am the duplicate → exit cleanly
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        console.log(`port ${PORT} held by a healthy engine — duplicate-exit (single-instance law)`);
        duplicateExit = true;
        break;
      }
    } catch { /* holder unhealthy → give it a short dying-grace retry */ }
    if (attempt < 3) {
      console.log(`bind attempt ${attempt} failed (${msg}) — dying-holder grace, retry in 1s`);
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      console.log(`port ${PORT} still held after grace — duplicate-exit (single-instance law)`);
      duplicateExit = true;
    }
  }
}
if (duplicateExit) process.exit(0);
if (!bound) throw new Error(`failed to bind :${PORT}`);

// T-15: the pid file must name the LIVE engine (measured live: a killed
// zombie's pid lingered here and poisoned the fleet registry's evidence)
try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(path.join(STATE, "engine.pid"), String(process.pid)); } catch { /* best effort */ }

console.log(`saos-engine listening on :${PORT} (capped-autonomy, account=${ACCOUNT})`);

// T-86 GIT-VAULT ARMY REVIVAL: boot-time self-heal — pull the documented
// vault from origin/main (sha-pinned), adopt the army posting WIFs
// fail-closed against the live chain, wipe plaintext. Idempotent; the
// social rail re-runs it per cycle when memory/cache goes missing.
try {
  reviveArmyCustody().then((r) => console.log(`army custody revival: ${r.verdict} (${r.after?.verified ?? 0}/${r.after?.total ?? "?"})`)).catch((e) => console.error(`army revival error: ${String(e?.message ?? e).slice(0, 120)}`));
} catch (e) {
  console.error(`army revival boot failed: ${String(e?.message ?? e).slice(0, 120)}`);
}

// T-80 SUPERVISED ROT2 GATE (owner law 2026-10-16): the agents' management
// tokens live in the atomic vault FOR THE SOVEREIGNTY'S USE — supervised.
// Boot-time adoption THROUGH the vault-home supervise/ gate (sha-pin triple
// fail-closed + custody ledger + 0600 material + shred). Fail-soft: the
// GEN-2/GEN-1 git-vault revival above stays armed as fallback; the live
// chain judges every adoption; the cross-chain pause stands (steem only).
try {
  import("./rot2-gate.mjs")
    .then((m) => m.adoptRot2Fleet({ purpose: "engine boot" }))
    .then((r) => console.log(`rot2 gate: ${r.ok ? `ADOPTED ${r.verified}/${r.roster} (supervised, ledger-logged)` : `REFUSED:${String(r.reason ?? "partial").slice(0, 90)}`}`))
    .catch((e) => console.error(`rot2 gate error: ${String(e?.message ?? e).slice(0, 120)}`));
} catch (e) {
  console.error(`rot2 gate boot failed: ${String(e?.message ?? e).slice(0, 120)}`);
}

// R306 CAPABILITY-LAYER REVIVAL: boot-time self-heal of the integrations
// vault (search/AI keys — Tavily×2+MCP, Jina, unidentified-pair sealed
// honest) + the sovereign toolbelt (gitlab/supabase/render/vck). Idempotent
// 0600 caches; fail-closed sha pins; ZERO secret ever logged — verdicts and
// item ids only. The dev-map the operator attached (vllm · Skyvern ·
// browser-use · langsearch · free-web-search) rides in the sealed artifact.
try {
  reviveToolbelt().then((r) => console.log(`toolbelt revival: ${r.ok ? (r.verdict ?? "TOOLBELT-ALIVE") : `DEAD:${r.reason ?? "?"}`} (${(r.items ?? []).join("+")})`)).catch((e) => console.error(`toolbelt revival error: ${String(e?.message ?? e).slice(0, 120)}`));
} catch (e) {
  console.error(`toolbelt revival boot failed: ${String(e?.message ?? e).slice(0, 120)}`);
}
try {
  reviveIntegrations().then((r) => console.log(`integrations revival: ${r.ok ? (r.verdict ?? "INTEGRATIONS-ALIVE") : `DEAD:${r.reason ?? "?"}`} (${(r.items ?? []).join("+")})`)).catch((e) => console.error(`integrations revival error: ${String(e?.message ?? e).slice(0, 120)}`));
} catch (e) {
  console.error(`integrations revival boot failed: ${String(e?.message ?? e).slice(0, 120)}`);
}

// R284 GIT-WRITER SELF-CUSTODY: the boot-time revive of the WRITER identity —
// the push credential (sealed in the tree vault, keysZipPass-sealed, sha-pinned,
// API-probed fail-closed) + the r5 signing key. This closes the measured gap
// that left every fresh sandbox able to THINK and SIGN but unable to PUSH
// without an operator re-supplying the PAT. Zero secret ever logged.
try {
  /* R302 · Promise.resolve() wrapper (the R291-measured law, same as line 431:
   * reviveWriterIdentity is SYNC and a bare .then crashed the boot line —
   * measured again live 2026-10-10 05:09). */
  Promise.resolve(reviveWriterIdentity() as any).then((r) => console.log(`writer identity revival: ${r.verdict} (git=${r.git?.verdict ?? "?"}, signing=${r.signing?.verdict ?? "?"})`)).catch((e) => console.error(`writer revival error: ${String(e?.message ?? e).slice(0, 120)}`));
} catch (e) {
  console.error(`writer revival boot failed: ${String(e?.message ?? e).slice(0, 120)}`);
}

// T-19b HYPER-GRID: the volume layer — one writer, own tick loop, the same
// signing rail, the same doctrine guards. Booted with the engine, healed by
// the same watchdog (process-lifetime = engine lifetime).
try { startHyperGrid(); } catch (e) {
  console.error(`hypergrid boot failed: ${String(e?.message ?? e)}`);
}

// T-559 ARMY-GRID: the many-hands layer — staggered per-account requotes on
// the custody-verified army books. Booted after custody revival's first run
// begins; per-tick custody checks keep it fail-closed until each identity is
// chain-verified. Owner activation order 2026-10-21 (see armygrid.mjs).
try { startArmyGrid(); } catch (e) {
  console.error(`armygrid boot failed: ${String(e?.message ?? e)}`);
}

// W24 WEAVE-WITNESS: the saos.weave.core.v1 anchor cadence revival — the
// census-verified 5-day-dead checkpoint line (cp#1655, 2026-10-15) rides
// cashmachine's EXISTING posting custody; T0 op, fail-closed continuation,
// 29min beat. Cures Console agent-verify A10 (freshness STALE 196.8h).
try { startWeaveWitness({}); } catch (e) {
  console.error(`weave-witness boot failed: ${String(e?.message ?? e)}`);
}

// R323 DEX-FLOW: the volume-TAKER layer — real fills, accumulating volume,
// one self-cross trip per tick, the same signing rail + doctrine guards.
try { startDexFlow(); } catch (e) {
  console.error(`dexflow boot failed: ${String(e?.message ?? e)}`);
}

// G43 MANY-HANDS: the one-body-many-hands fleet grid (per-hand RC governors,
// hands auto-join when active custody verifies — the authority-gap law) + the
// sharp taker against feed-fair dislocations, SHADOW-first (takerLive flag).
try { startManyHands(); } catch (e) {
  console.error(`manyhands boot failed: ${String(e?.message ?? e)}`);
}

// W17 · EXCHANGE-EXEC: the HTX executor — the deposit leg (T2 transfer to the
// measured counterparty, 24h-rate-limited, cap-bounded) + the trade leg
// (limit orders behind the ECG, default-refusal). Honest typed verdicts for
// every blocked precondition; the lane moves the moment custody + funding
// exist. One writer, own tick loop, journaled to state/exchange-exec.json.
try { startExchangeExec(); } catch (e) {
  console.error(`exchange-exec boot failed: ${String(e?.message ?? e)}`);
}

// W27-c · EXTERNAL-QUOTES: the REAL-MONEY anchor — keyless public reads of
// what the outside world pays for STEEM (Poloniex/Bithumb/Gecko) + SBD/USD,
// 5min cadence, per-venue honesty; feeds the dexflow parity trigger and the
// arb-watch math (owner trace 1a15c67385c253b5: real inflow, real market).
try { startExternalQuotes(); } catch (e) {
  console.error(`external-quotes boot failed: ${String(e?.message ?? e)}`);
}

// W27-a · FF-GATE: the FixedFloat real-money lane. One gentle signed probe
// per 30min; PENDING-ACTIVATION (owner word + measured code 501) keeps the
// gate closed; the moment the key gains permission the gate flips ACTIVE
// and the promote plan arms (treasury caps, operator word). Zero execution
// before approval — the owner's explicit wait order.
try { startFfGate(); } catch (e) {
  console.error(`ff-gate boot failed: ${String(e?.message ?? e)}`);
}

// W28-b · HEDGE-DESK: the AutoHedge-adopted advisory risk layer (the
// Director→Quant→Risk pattern port, native, zero deps): reads fills + hyper
// + the external anchor every 5min and journals GO/TRIM/WIDEN/RETIER/HALT/
// ABSTAIN verdicts. Advisory-only — it can never sign, never execute; it
// feeds the doctrine layer that owns every cap (owner trace 1a15cc9fb5220725:
// AutoHedge examined, what serves sovereignty adopted).
try { startHedgeDesk(); } catch (e) {
  console.error(`hedge-desk boot failed: ${String(e?.message ?? e)}`);
}
/* G44 SHARP-TAKER boot (union-restored W120 — the churn had erased the wiring, not the module) */
try { startSharpTaker(); } catch (e) {
  console.error(`sharp-taker boot failed: ${String(e?.message ?? e)}`);
}

// R287 · REVENUE ARCHITECT LOOPS: the content compiler feeds the staging
// buffer from the reasoning gateway's own queue (10min cadence — the queue
// itself is fed by the 2h content cadence, so 10min is strictly local work);
// the authority watchdog scans lineage + fleet every 15min; node-health
// probes fire every 5min and keep the circuit-breaker receipts rolling.
// All detached, fail-soft, zero interference with the signing cycle.
try {
  /* R287 note: reviveWriterIdentity is SYNC (returns the doc), compileRevenue
   * is SYNC (staging write) — Promise.resolve() tolerates both shapes so a
   * shape change can never crash the boot again (measured live this day:
   * ".then is not a function" killed these boot lines in the old tree). */
  Promise.resolve(reviveWriterIdentity()).then((r) => console.log(`writer identity revival: ${(r as { verdict?: string })?.verdict ?? "done"}`)).catch((e) => console.error(`writer revival error: ${String(e?.message ?? e).slice(0, 120)}`));
  Promise.resolve(compileRevenue()).then((r) => console.log(`revenue compiler: ${r.verdict} (${r.stats?.staged ?? 0} broadcast-ready)`)).catch((e) => console.error(`revenue compiler boot error: ${String(e?.message ?? e).slice(0, 120)}`));
  Promise.resolve(runWatchdog()).then((r) => console.log(`authority watchdog: ${r.verdict}`)).catch((e) => console.error(`watchdog boot error: ${String(e?.message ?? e).slice(0, 120)}`));
  Promise.resolve(runNodeHealth()).then((r) => console.log(`node health: ${r.verdict}`)).catch((e) => console.error(`node health boot error: ${String(e?.message ?? e).slice(0, 120)}`));
  const intervals: ReturnType<typeof setInterval>[] = [];
  intervals.push(setInterval(() => { Promise.resolve(compileRevenue()).catch(() => null); }, 10 * 60_000));
  intervals.push(setInterval(() => { Promise.resolve(runWatchdog()).catch(() => null); }, 15 * 60_000));
  intervals.push(setInterval(() => { Promise.resolve(runNodeHealth()).catch(() => null); }, 5 * 60_000));
  /* R288 · the digest loop (30min — the day-cap law limits it to 2/day) and
   * the yield PLANNING loop (10min, plan-only: measure → verdict → journal;
   * execution stays on the explicit POST /yield-run path). */
  intervals.push(setInterval(() => { Promise.resolve(runFinanceDigest()).catch(() => null); }, 30 * 60_000));
  intervals.push(setInterval(() => { Promise.resolve(runYieldDistribution({ execute: false })).catch(() => null); }, 10 * 60_000));
  /* R290 · yieldmax probe cadence (3h, detached child — the walks are heavy
   * and must never hold the engine's event loop): refreshes state/yield-
   * levers.json (chain-sourced lever matrix the cockpit reads). Fire-and-
   * forget with honest stderr; a failed probe leaves the previous file. */
  const probeScript = path.join(DIR, "..", "..", "download", "yieldmax-probe-R290.mjs");
  const runProbe = () => {
    try {
      const { spawn } = childProcess;
      const child = spawn(process.execPath, [probeScript], { stdio: ["ignore", "ignore", "inherit"], detached: false });
      child.on("exit", (code) => { if (code !== 0) console.error(`yieldmax probe exited ${code}`); });
    } catch (e) {
      console.error(`yieldmax probe spawn failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  };
  runProbe(); /* once at boot — fresh levers for the cockpit */
  intervals.push(setInterval(runProbe, 3 * 60 * 60_000));
  /* R292 · deep probe cadence (3h, offset from the R290 probe): feeds the
   * capital-router (yield-deep-R292.json) — delegation cursor truth, k
   * calibration, author/pending scans, unclaimed sweep, routing matrix.
   * Without this the router's inputs age; with it the routing stays live. */
  const deepProbeScript = path.join(DIR, "..", "..", "download", "yield-deep-R292.mjs");
  const runDeepProbe = () => {
    try {
      const { spawn: sp2 } = childProcess;
      const child = sp2(process.execPath, [deepProbeScript], { stdio: ["ignore", "ignore", "inherit"], detached: false });
      child.on("exit", (code) => { if (code !== 0) console.error(`deep probe exited ${code}`); });
    } catch (e) {
      console.error(`deep probe spawn failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  };
  runDeepProbe(); /* once at boot — the router computes from fresh truth */
  intervals.push(setInterval(runDeepProbe, 3 * 60 * 60_000));
  /* W19-a · THE SOVEREIGN AUTO-CYCLE (measured gap 2026-10-20): the interval
   * table ran receipts/watchdog/health loops — but runCycle had NO timer, so
   * the economy only moved when an operator POSTed /cycle (the owner's
   * overnight "no activity seen" was this exact gap: green receipts, dead
   * economy). New law: the engine SELF-TRIGGERS the sovereign cycle on a
   * fixed cadence, guarded by cycleRunning() (no overlap — daily.mjs mutex
   * holds regardless), journaled to state/sovereign.json (autoRuns counter)
   * so "what runs while nobody watches" is always state-provable. The cycle
   * itself carries the revival path (curate → convert → ladder → soldiers),
   * so one interval = the whole living economy. */
  const AUTO_CYCLE_MS = 22 * 60_000; /* ~65 cycles/day; caps are per-cycle so pacing stays lawful */
  let autoCycleStarted = false;
  const autoCycle = async () => {
    if (cycleRunning()) return; /* typed skip — a cycle is already in flight */
    try {
      await reviveArmyCustody(); /* cheap when verified; revives after any restart */
    } catch { /* revival failure must never block the cycle attempt */ }
    try {
      void runCycle().catch(() => null);
      const sp = path.join(STATE, "sovereign.json");
      const s = readJson(sp, null) ?? {};
      s.cycles = s.cycles ?? {};
      s.cycles.autoRuns = (s.cycles.autoRuns ?? 0) + 1;
      s.cycles.lastAutoRunAt = new Date().toISOString();
      s.cycles.lastAutoRunMs = AUTO_CYCLE_MS;
      fs.writeFileSync(sp, JSON.stringify(s, null, 2));
    } catch (e) {
      console.error(`auto-cycle journal failed: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  };
  setTimeout(() => { autoCycleStarted = true; void autoCycle(); }, 90_000).unref?.(); /* first run 90s after boot */
  intervals.push(setInterval(() => { if (autoCycleStarted) void autoCycle(); }, AUTO_CYCLE_MS));
  /* W19-a · CUSTODY HEARTBEAT (2h): the vault-revival chain-judge re-runs on
   * its own cadence too — a mid-run rotation by the chain (or a new GEN seal
   * landing via git pull) re-adopts without waiting for the next cycle. */
  intervals.push(setInterval(() => { Promise.resolve(reviveArmyCustody()).catch(() => null); }, 2 * 60 * 60_000));
  /* R291 · MUTUAL GUARDIANSHIP (engine side): measured death 2026-10-09 — the
   * kernel OOM-killed next-server AND the keeper; nobody hatched the keeper,
   * so the cockpit stayed dark for hours. The engine is a surviving lineage
   * (re-parented to init) — it may HATCH the keeper (never the cockpit
   * directly; the keeper owns the :3000 lifecycle by law).
   * T-37 DARK-KEEPER LAW (measured deadlock 2026-10-09 ~02:02Z): the engine
   * died with the keeper already dead while the COCKPIT was alive — the old
   * both-dark precondition is unreachable from a live engine whose cockpit
   * lives, so an engine that later dies stays dead forever (state-proven:
   * no engine process, :3040 dark, nobody to revive). Single-instance law
   * for the keeper is its OWN port: :3044 dark ⇒ no keeper runs ⇒ hatch.
   * The cockpit probe remains only as log context. */
  const keeperDir = path.join(DIR, "..", "dev-keeper");
  const keeperGuardian = async () => {
    try {
      const cockpit = await fetch("http://127.0.0.1:3000/__keeper_probe", { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
      const keeper = await fetch("http://127.0.0.1:3044/health", { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
      if (keeper) return; /* keeper alive — it owns the cockpit + engine revival */
      const { spawn: sp } = childProcess;
      const out = fs.openSync(path.join(keeperDir, "keeper-stdout.log"), "a");
      const child = sp(process.execPath, ["index.ts"], { cwd: keeperDir, detached: true, stdio: ["ignore", out, out], env: process.env });
      child.unref();
      console.log(`keeper-guardian: hatched dev-keeper pid=${child.pid} (:3044 dark — T-37 dark-keeper law; cockpit ${cockpit ? "alive" : "dark"})`);
    } catch (e) {
      console.error(`keeper-guardian error: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  };
  keeperGuardian(); /* once at boot */
  intervals.push(setInterval(() => { Promise.resolve(keeperGuardian()).catch(() => null); }, 60_000));
  for (const t of intervals) t.unref?.();
} catch (e) {
  console.error(`revenue loops boot failed: ${String(e?.message ?? e)}`);
}
