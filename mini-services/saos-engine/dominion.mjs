/* ═══════════ §T-68 · THE DOMINION RUNNER — מכשיר עושה-השוק הריבוני ═══════════
 * The operator's time-of-truth mandate: be the dominant maker on the networks
 * we run on. This instrument measures the pond and our place in it EVERY
 * cycle, from ALREADY-measured state (zero extra chain calls) + the fleet's
 * per-account credential truth (the T-66 pattern: a missing key is a measured
 * answer, not a crash):
 *   venue  ← state/market.json (the engine's own 24h trade measurement)
 *   ours   ← state/observe.json fillsRows (per-fill ledger → per-day truth)
 *   guard  ← state/hyper-grid.json lastGuardAction (PAUSE-FLOW is truth)
 *   rc     ← observe.inventory.rcPct · ops ← state/hyper-ops.json
 *   fleet  ← state/soldiers.json accounts × loadCredential (live, per-account)
 * LAWS (lib.mjs, vector-locked): dominionShareLaw · presencePlanLaw ·
 * fleetVolumePlanLaw. Fail-closed: any missing state → typed UNMEASURABLE,
 * never a guess. */

import * as fs from "node:fs";
import * as path from "node:path";
import { dominionShareLaw, presencePlanLaw, fleetVolumePlanLaw, pondCeilingLaw, multiPondRankLaw, hiveArmPlanLaw, volumePlanLaw, inquiryLaw } from "./lib.mjs";
import { loadCredential } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const DOMINION_FILE = path.join(STATE, "dominion.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = `${p}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, p); }; /* §T-67 ATOMIC-WRITE */

/* fleet truth: the snapshot is NOT a fleet (the T-66 lie kill) — every
 * account is judged by its own credential, in its own catch */
async function fleetAliveCount(accounts) {
  let alive = 0;
  for (const s of Array.isArray(accounts) ? accounts : []) {
    const name = typeof s === "object" ? (s?.name ?? null) : (s ?? null);
    if (!name) continue;
    try { const c = await loadCredential(name); if (c) alive += 1; } catch { /* missing key = a measured answer */ }
  }
  return alive;
}

/* our 24h flow from the per-fill ledger — a LOWER BOUND while the rows'
 * covered span is < 24h (rows are capped + the history slice is what the
 * engine measured): under-counting OUR fills can only UNDERSTATE our share —
 * the safe bias for a dominion claim, never vanity. The same bias poisons
 * the burst-window comparison the other way: a 2.4h active burst (27 fills)
 * vs a 24h pond read 64% “dominant” live — caught and killed here. */
function our24hFlow(rows, nowMs) {
  const arr = Array.isArray(rows) ? rows.filter((r) => r?.at) : [];
  const tsOf = (r) => Date.parse(String(r.at).endsWith("Z") ? r.at : `${r.at}Z`);
  const ts = arr.map(tsOf).filter((t) => Number.isFinite(t));
  if (!ts.length) return { count24h: 0, vol24h: 0, coveredHours: 0, partial: true };
  const cutoff = nowMs - 86_400_000;
  let count24h = 0, vol24h = 0;
  for (const r of arr) {
    if (tsOf(r) >= cutoff) { count24h += 1; vol24h += Math.abs(Number(r?.steem ?? 0)) || 0; }
  }
  const coveredHours = Math.max(0.1, (Math.max(...ts) - Math.min(...ts)) / 3600_000);
  return { count24h, vol24h: Math.round(vol24h * 1e4) / 1e4, coveredHours: Math.round(coveredHours * 10) / 10, partial: coveredHours < 24 };
}

export async function runDominion({ now = new Date().toISOString() } = {}) {
  const market = readJson(path.join(STATE, "market.json"), null);
  const observe = readJson(path.join(STATE, "observe.json"), null);
  const hyper = readJson(path.join(STATE, "hyper-grid.json"), null);
  const hyperOps = readJson(path.join(STATE, "hyper-ops.json"), null);
  const soldiers = readJson(path.join(STATE, "soldiers.json"), null);

  const venue = market?.book && market?.class === "measured" ? {
    tradesPerDay: market.tradesPerDay ?? null,
    volSteemPerDay: market.volSteem ?? null,
    spreadBps: market.book.spreadBps ?? null,
    windowHours: market.windowHours ?? 24,
  } : null;

  const flow24 = our24hFlow(observe?.fillsRows, Date.parse(now));
  const steemUsd = observe?.parity?.steemUsd ?? null;
  const guard = hyper?.lastGuardAction ?? null;

  const share = venue ? dominionShareLaw({
    ourFillsPerDay: flow24.count24h,
    ourVolSteemPerDay: flow24.vol24h,
    venueTradesPerDay: venue.tradesPerDay,
    venueVolSteemPerDay: venue.volSteemPerDay,
    spreadBps: venue.spreadBps,
    steemUsd,
  }) : { verdict: "VENUE-UNMEASURABLE", fillShare: null, volShare: null, share: null, captureSteemPerDay: null, captureUsdPerDay: null, law: "הבריכה לא נמדדה — אין דומיניון בלי מדידת-מקור" };

  /* presence: our live levels from the chain-observed order list (asks/bids) */
  const liveOrders = Array.isArray(observe?.orders) ? observe.orders : [];
  const liveAskLevels = liveOrders.filter((o) => o?.side === "ask").length;
  const liveBidLevels = liveOrders.filter((o) => o?.side === "bid").length;
  const presence = presencePlanLaw({
    rcPct: observe?.inventory?.rcPct ?? null,
    guard,
    opsDayCap: hyperOps?.opsDayCap ?? 0,
    opsToday: hyperOps?.opsToday ?? 0,
    liveAskLevels, liveBidLevels,
    targetAskLevels: 10, targetBidLevels: 10,
  });

  const alive = soldiers?.accounts?.length ? await fleetAliveCount(soldiers.accounts) : 0;
  const fleet = fleetVolumePlanLaw({ soldiersAlive: alive, levelsEach: 6, opsPerDayEach: 20, opsPoolPerDay: 44 });

  /* §T-69 · THE MULTI-POND RANKING — the operator's mandate says NETWORKS
   * (plural). The second pond rides state/hive.json (the T-54 sensor's own
   * measurement, refreshed every cycle by the hive step BEFORE this one →
   * zero extra chain calls) + observe.parity.hiveUsd (the measure ladder's
   * measured dollar leg). No Hive credential exists on the machine → the
   * pond is UNDEPLOYED-OPERATOR-GATED truth, never a guess. */
  const hive = readJson(path.join(STATE, "hive.json"), null);
  const hiveUsd = observe?.parity?.hiveUsd ?? null;
  const steemPond = pondCeilingLaw({
    symbol: "STEEM:SBD",
    pondVolCoinPerDay: venue?.volSteemPerDay ?? null,
    venueTradesPerDay: venue?.tradesPerDay ?? null,
    spreadBps: venue?.spreadBps ?? null,
    coinUsd: steemUsd,
    ourVolCoinPerDay: flow24.vol24h,
    ourFillsPerDay: flow24.count24h,
    deployed: true,
  });
  const hivePond = pondCeilingLaw({
    symbol: "HIVE:HBD",
    pondVolCoinPerDay: hive?.pond?.volHive24h ?? hive?.volume?.hiveVolume24h ?? null,
    venueTradesPerDay: hive?.pond?.fills24h ?? null,
    spreadBps: hive?.book?.spreadBps ?? null,
    coinUsd: hiveUsd,
    ourVolCoinPerDay: hive?.pond?.ours?.hiveVol ?? 0,
    ourFillsPerDay: hive?.pond?.ours?.fills ?? 0,
    deployed: false,
  });
  /* §T-70 · THE THIRD WATER — Hive-Engine ponds, measured (the enginepond
   * step runs BEFORE dominion in the cycle → zero extra chain calls; the
   * T-69 composition law). Each measured pair becomes a pondCeilingLaw
   * entry riding the SAME hiveUsd dollar leg (SWAP.HIVE prices) and the
   * BOOK-touch spread (never the stale metrics snapshot). All UNDEPLOYED-
   * OPERATOR-GATED: an H-E-enabled Hive credential is the irreversible
   * gate — the pond is measured and ranked today, armed only by the
   * operator. The multiPondRankLaw needs no change: every pond adds its
   * ceiling, none dictates — the wide-hands doctrine as code. */
  const enginepond = readJson(path.join(STATE, "enginepond.json"), null);
  const enginePondEntries = [];
  for (const ep of Array.isArray(enginepond?.ponds) ? enginepond.ponds : []) {
    if (!ep?.pond) continue; // a failed pair is a typed error row in state — it never enters the rank
    enginePondEntries.push(pondCeilingLaw({
      symbol: `${ep.symbol}:SWAP.HIVE (H-E)`,
      pondVolCoinPerDay: ep.pond.volHive24h ?? null,
      venueTradesPerDay: ep.pond.fills24h ?? null,
      spreadBps: ep.touch?.spreadBps ?? null,
      coinUsd: hiveUsd,
      ourVolCoinPerDay: ep.pond.ours?.volHive ?? 0,
      ourFillsPerDay: ep.pond.ours?.fills ?? 0,
      deployed: false,
    }));
  }
  const ponds = [steemPond, hivePond, ...enginePondEntries];
  const rankedPonds = multiPondRankLaw(ponds);
  const hiveArmPlan = hiveArmPlanLaw({
    credentialPresent: false,
    spreadBps: hive?.book?.spreadBps ?? null,
    rangeBps: hive?.range?.rangeBps ?? null,
    tick: hive?.tick ?? null,
  });

  /* §T-70 · THE VOLUME PLAN — the maker's reachable fills/day on the
   * DEPLOYED pond (Steem), and what binds (pause → RC → ops). Rides the
   * presence law's own targets — one body, one plan. */
  const volumePlan = volumePlanLaw({
    pondFillsPerDay: venue?.tradesPerDay ?? null,
    ourFillsPerDay: flow24.count24h,
    guard,
    rcPct: observe?.inventory?.rcPct ?? null,
    opsToday: hyperOps?.opsToday ?? 0,
    opsDayCap: hyperOps?.opsDayCap ?? 0,
    asksLive: liveAskLevels,
    bidsLive: liveBidLevels,
    askTarget: presence?.askTarget ?? 10,
    bidTarget: presence?.bidTarget ?? 0,
  });

  /* §T-70 · THE SELF-INQUIRY — the sovereignty asking its own questions
   * from measured facts (deterministic, vector-locked): each answer is
   * chain truth, each OPEN-OPERATOR is an irreversible gate named. */
  const inquiries = inquiryLaw({
    sbdInv: observe?.inventory?.sbd ?? null,
    guard,
    rcPct: observe?.inventory?.rcPct ?? null,
    opsPct: Number(hyperOps?.opsDayCap) > 0 ? (hyperOps?.opsToday ?? 0) / hyperOps.opsDayCap : null,
    topEngineCaptureMaxUsdPerDay: rankedPonds.ranked
      .filter((p) => String(p.symbol ?? "").includes("(H-E)"))
      .reduce((m, p) => (Number.isFinite(p?.captureMaxUsdPerDay) && p.captureMaxUsdPerDay > (m ?? -1) ? p.captureMaxUsdPerDay : m), null),
    fleetAlive: alive,
  });

  /* §T-70 · the third-water cockpit face — per-pair measured summary */
  const enginePonds = (Array.isArray(enginepond?.ponds) ? enginepond.ponds : []).map((ep) => ({
    symbol: ep?.symbol ?? null,
    fills24h: ep?.pond?.fills24h ?? null,
    volHive24h: ep?.pond?.volHive24h ?? null,
    full24hBasis: ep?.pond?.full24hBasis ?? null,
    touchBps: ep?.touch?.spreadBps ?? null,
    touchVerdict: ep?.touch?.verdict ?? null,
    leaders: Array.isArray(ep?.pond?.leaders) ? ep.pond.leaders.slice(0, 3) : [],
    ours: ep?.pond?.ours ?? null,
    error: ep?.error ?? null,
  }));

  const out = {
    at: now,
    day: String(now).slice(0, 10),
    account: process.env.SAOS_ACCOUNT || "headcorner",
    verdict: venue ? share.verdict : "VENUE-UNMEASURABLE",
    venue: venue ?? { tradesPerDay: null, volSteemPerDay: null, spreadBps: null, windowHours: null },
    ours: {
      fills24h: flow24.count24h,
      vol24h: flow24.vol24h,
      coveredHours: flow24.coveredHours,
      partialBasis: flow24.partial
        ? `חלק-מינימום: פרוסת-השורות מכסה ${flow24.coveredHours}h מתוך 24h — החלק יכול רק לגדול`
        : "24h מלא",
      realizedSbd: observe?.pnl?.realizedSbd ?? null,
      positionSteem: observe?.pnl?.positionSteem ?? null,
      positionAvgCost: observe?.pnl?.positionAvgCost ?? null,
      basis: "fill_order חי — יסוד-עלות מהמנוע (A-10), ספירת-24ש בתוך הפרוסה-נמדדת",
    },
    share: { fillShare: share.fillShare, volShare: share.volShare, share: share.share, verdict: share.verdict },
    capture: { steemPerDay: share.captureSteemPerDay, usdPerDay: share.captureUsdPerDay, note: share.law },
    presence: { ...presence, guard, liveAsks: liveAskLevels, liveBids: liveBidLevels },
    fleet,
    /* §T-69 · many waters, one body */
    ponds,
    ranked: {
      verdict: rankedPonds.verdict,
      ranked: rankedPonds.ranked.map((p) => ({ symbol: p.symbol, verdict: p.verdict, pondUsdPerDay: p.pondUsdPerDay, share: p.share, captureUsdPerDay: p.captureUsdPerDay, captureMaxUsdPerDay: p.captureMaxUsdPerDay })),
      totalCaptureMaxUsdPerDay: rankedPonds.totalCaptureMaxUsdPerDay,
      law: rankedPonds.law,
    },
    hivePond: hive?.pond ? {
      at: hive.pond.at ?? null,
      fills24h: hive.pond.fills24h ?? null,
      volHive24h: hive.pond.volHive24h ?? null,
      basis: hive.pond.basisLabel ?? null,
      leaders: Array.isArray(hive.pond.leaders) ? hive.pond.leaders : [],
      leaderCount: hive.pond.leaderCount ?? null,
      top1VolShare: hive.pond.top1VolShare ?? null,
      top3VolShare: hive.pond.top3VolShare ?? null,
      ours: hive.pond.ours ?? null,
      law: hive.pond.law ?? null,
    } : null,
    hiveArmPlan,
    /* §T-70 · the third water + the volume plan + the self-inquiries */
    enginePonds,
    volumePlan,
    inquiries,
    law: "דומיניון = חלק-שוק נמדד + נוכחות חוקית + לכידת-זרימה-של-אחרים; רווחיות-על-ווליום-יומרני — אין עמלות באף-מים נמדד, יש מרווח; הידיים-הגדולות מחזיקות את כל הבריכות (§T-69) ועתה גם את המים-השלישיים (§T-70)",
  };
  writeJson(DOMINION_FILE, out);
  return out;
}

export function dominionState() { return readJson(DOMINION_FILE, null); }
