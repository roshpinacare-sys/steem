/**
 * capital-router.mjs — R292 · THE PROFIT-MAXIMIZATION & ROUTING ENGINE
 * (operator order: "מקסם רווחיות על הכל מכל הפעולות שלנו וגם ניתוב נכון
 *  בין אחד לשני" — maximize profitability across ALL our actions with
 *  correct routing between one lane and another; micro AND macro).
 *
 * MEASURED BASIS (all chain-sourced, 2026-10-09, zero trust):
 *   · curation is the ONLY live yield lane (headcorner 0.57 SP/day measured)
 *   · author rail pays $0.00 (all fleet posts pending 0.000 — dust votes only)
 *   · HBD savings 0%, SBD premium -1.51% (no conversion arb), Hive/Blurt dust
 *   · 2463 SP in the expiring-delegation queue (recalled, lands ~Oct 10-11) —
 *     delegated_vesting_shares 3057.26 − active rows 594.24 = 2463.02
 *   · powerspan holds 50.12 SP of ours FREE (external shell, zero own vests,
 *     random external votes, not in custody/personas/rc-roles)
 *   · T35 empirical curve: SP/Grs 0.000416 (5-30m) → 0.000234 (480m+)
 *   · vote-rshare calibration: rshares ≈ 0.02 × vests_µ × weight × VP (k=0.020007
 *     measured median of 8 chain samples — matches the Steem constant 0.02)
 *
 * THE LAWS (all pure, all selftest-covered):
 *   · SLOTS×SP      daily curation yield ≈ Σᵢ slotsᵢ × valuePerVoteᵢ —
 *                   capital distribution across accounts is YIELD-NEUTRAL
 *                   when utilization is full (Σ SPᵢ×v is invariant); the real
 *                   routing variable is SLOT UTILIZATION + candidate quality.
 *   · REGEN         sustainable votes/day = regenPct ÷ burnPerFullVotePct
 *                   adjusted by the weight mix — burning above regen only
 *                   borrows from tomorrow at the VP-floor's interest.
 *   · AGE           vote in the 5-30m window (curve peak); crowded-pool gate
 *                   (maxPostVotes) stays owned by curator.mjs — additive only.
 *   · LANDING       a >15% effective-SP jump is the recall wave — the same
 *                   slots then vote with the bigger battery (×3 measured).
 *   · SHELL         SP parked on an external, role-less, unpaying account is
 *                   a measured leak — recall it (reversible, evidence-led).
 *   · DUST-LANES    lanes measured dead (author-reach absent, HBD 0%,
 *                   SBD premium inside peg, Hive/Blurt dust) are journaled
 *                   honestly as DORMANT — never priced as profit.
 *   · JOURNAL       every verdict lands in receipts/capital-router.jsonl —
 *                   verdicts and evidence, never keys.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const stateDir = () => process.env.SAOS_STATE_DIR || path.join(DIR, "state");
const receiptsDir = () => path.join(DIR, "receipts");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export const ROUTER_LAW = "slots×SP is the yield law; regen bounds the burn; age-curve picks the moment; landing is detected not assumed; external shells are recalled with evidence; dead lanes stay honest";

/* measured constants (R292 probe + T35 curve) — overridable for tests */
export const CONSTANTS = {
  regenPctPerDay: 20,            /* Steem VP regen — classic constant */
  burnPctPerFullVote: 2,         /* a 100%-weight 100%-VP vote costs ~2% VP */
  k: 0.02,                       /* rshares = k × vests_µ × weight × VP (calibrated 0.020007) */
  curveEarly: 0.000416,          /* SP per Grshare, 5-30m votes (T35, 96 ops) */
  curveLate: 0.000234,           /* SP per Grshare, 480m+ votes (T35) */
  earlyWindowMin: 5,
  earlyWindowMax: 30,
};

const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const finite = (x) => Number.isFinite(Number(x)) ? Number(x) : 0;

/* ── pure: sustainable vote budget ──────────────────────────────── */
/* burn/day = votes × (avgWeight/100) × burnPerFullVote. Sustainable means
 * burn/day ≤ regen/day. The floor is the state's VP floor (battery guard). */
export function sustainableVoteBudget({ maxPerDay, avgWeightPct = 60, regenPctPerDay = CONSTANTS.regenPctPerDay, burnPctPerFullVote = CONSTANTS.burnPctPerFullVote } = {}) {
  const max = Math.max(0, Math.floor(finite(maxPerDay)));
  if (regenPctPerDay <= 0 || burnPctPerFullVote <= 0 || avgWeightPct <= 0) return 0;
  const perVote = (avgWeightPct / 100) * burnPctPerFullVote;
  const byRegen = Math.floor(regenPctPerDay / perVote);
  return Math.min(max, byRegen);
}

/* hours until VP floor unlocks when the rail is floor-blocked */
export function etaToVpFloorHours({ vpPct, floorPct, regenPctPerDay = CONSTANTS.regenPctPerDay } = {}) {
  const vp = finite(vpPct), floor = finite(floorPct);
  if (vp >= floor) return 0;
  if (regenPctPerDay <= 0) return Infinity;
  return ((floor - vp) / regenPctPerDay) * 24;
}

/* ── pure: value per vote (curve-based, author-side and curator-side) ── */
export function voteValueSp({ effectiveSp, vestsPerSp, vpPct = 100, weightPct = 100, k = CONSTANTS.k, spPerGrs = CONSTANTS.curveEarly } = {}) {
  const sp = finite(effectiveSp), vps = finite(vestsPerSp);
  if (sp <= 0 || vps <= 0 || vps > 1e9) return 0;
  const vestsMicro = sp * vps * 1e6;
  const rshares = vestsMicro * k * (finite(vpPct) / 100) * (finite(weightPct) / 100);
  const grs = rshares / 1e9;
  return r6(grs * finite(spPerGrs));
}

/* ── pure: distribution-neutrality law ──────────────────────────── */
/* Σᵢ slotsᵢ×SPᵢ is invariant under capital redistribution WHEN every account
 * deploys the same slots/day — proof-shaped function used by the selftest. */
export function fleetYieldSpPerDay({ accounts, spPerGrs, vestsPerSp, vpPct = 100, weightPct = 80 }) {
  if (!Array.isArray(accounts)) return 0;
  return r6(accounts.reduce((s, a) => s + finite(sustainableVoteBudget({ maxPerDay: a.maxPerDay ?? 99, avgWeightPct: weightPct })) * voteValueSp({ effectiveSp: a.effectiveSp, vestsPerSp, vpPct, weightPct, spPerGrs }), 0));
}

/* ── pure: yield ladder (today → landing → tags → army → recall) ── */
export function yieldLadder({ headEffectiveSp, headAprPct, tagBoostPct = 0, armyDailySp = 0, steemUsd = 0.104095, pendingLandingSp = 0 } = {}) {
  const apr = finite(headAprPct) / 100;
  const daily = (sp) => (sp * apr) / 365;
  const usd = (spPerDay) => (steemUsd > 0 ? r6(spPerDay * steemUsd) : null);
  const stages = [];
  const push = (id, label, spPerDayVal, note) => stages.push({ id, label, spPerDay: r6(spPerDayVal), usdPerDay: usd(spPerDayVal), note });
  const todayDaily = daily(finite(headEffectiveSp));
  push("today", "as-measured now", todayDaily, "curation-only lane, author dust, other lanes dormant");
  const afterLanding = finite(headEffectiveSp) + finite(pendingLandingSp);
  push("landing", "recall wave lands (expiring→effective)", daily(afterLanding), `${r2(pendingLandingSp)} SP measured in the expiring queue`);
  const tagFrac = 1 + finite(tagBoostPct) / 100;
  push("tags", "tag-ROI budget shift to measured top tags", daily(afterLanding) * tagFrac, `+${finite(tagBoostPct)}% on vote yield (s34challenge-wk6a 0.121 vs fleet-avg ~0.05 SP/op measured; conservative fraction of the measured ×2.4 spread)`);
  push("fleet", "army battery deployed (regen-bounded slots × SP)", daily(afterLanding) * tagFrac + finite(armyDailySp), `army adds ${r6(finite(armyDailySp))} SP/day from measured slots×SP (regen-bounded budget, early-curve)`);
  /* the ladder's own multipliers — honest, no promise inflation */
  const base = stages[0].spPerDay || 1e-9;
  for (const s of stages) s.multiplierVsToday = r2(s.spPerDay / base);
  /* compounding: curation settles as VESTS → SP → bigger battery (annualized) */
  const finalSpPerDay = stages[stages.length - 1].spPerDay;
  const compoundAprPct = finite(headEffectiveSp) > 0 ? r2((finalSpPerDay * 365) / finite(headEffectiveSp) * 100) : null;
  return { stages, compoundAprPct, armyDailySp: r6(finite(armyDailySp)), note: "curation rewards settle as VESTS — the battery itself compounds" };
}

/* ── pure: SBD routing rule ─────────────────────────────────────── */
export function sbdRoutingRule({ premiumPct, bookBid, feedSteemSbd, inventorySbd, dustSbd = 2 } = {}) {
  const inv = finite(inventorySbd);
  if (inv < dustSbd) return { verdict: "DUST-HOLD", note: `inventory ${r2(inv)} SBD below dust floor ${dustSbd} — no route` };
  if (!Number.isFinite(bookBid) || !Number.isFinite(feedSteemSbd) || feedSteemSbd <= 0) return { verdict: "NO-BOOK", note: "book/feed unreadable — hold" };
  const discountPct = r2((1 - bookBid / feedSteemSbd) * 100);
  if (discountPct >= 1) return { verdict: "ROUTE-VIA-BOOK", discountPct, note: `book bid buys STEEM ${discountPct}% below feed — sell SBD into the bid, power up the STEEM` };
  return { verdict: "HOLD", premiumPct: finite(premiumPct), note: "book at/below feed value — conversion arb stays dormant" };
}

/* ── pure: action ranking (the routing matrix) ──────────────────── */
export function rankActions({ deep, custodyOk = true, vpFloorPct = 60, headVpPct = null, armyPolicy = { maxPerDay: 12, avgWeightPct: 60 }, liveQueueSp = null } = {}) {
  const actions = [];
  const add = (id, klass, note, gainSpPerDay = 0, evidence = null) => actions.push({ id, class: klass, note: String(note).slice(0, 240), expectedSpPerDay: r6(gainSpPerDay), evidence });
  const hc = deep?.accounts?.headcorner ?? {};
  const rout = deep?.routing ?? {};
  const unclaimedSp = finite(rout?.capital?.unclaimedSp);
  const unclaimedSbd = finite(rout?.capital?.unclaimedSbd);
  const unclaimedSteem = finite(rout?.capital?.unclaimedSteem);
  if (unclaimedSp > 0 || unclaimedSbd > 0 || unclaimedSteem > 0) {
    add("claim-rewards", "execute-now", `unclaimed rewards on the table: ${r2(unclaimedSp)} SP + ${r2(unclaimedSbd)} SBD + ${r2(unclaimedSteem)} STEEM — claim sweeps value into the battery`, 0, { unclaimedSp, unclaimedSbd, unclaimedSteem });
  }
  /* expiring/landing */
  const expiring = (deep?.headcornerDelegations?.expiring ?? []).reduce((s, e) => s + finite(e.vestsSp ?? e.vests) / 1612, 0);
  const delegOut = finite(hc.delegatedOutSp);
  const activeRows = deep?.headcornerDelegations?.outFlows?.reduce((s, f) => s + finite(f.vests), 0) ?? 0;
  /* T-555: chain-live queue when the detector ran — the deep-probe derivation
   * only stands in when the live probe failed, and then says so by name. */
  const expiringSp = liveQueueSp != null ? finite(liveQueueSp) : delegOut - activeRows / 1612.65;
  if (expiringSp > 1) {
    add("await-landing", "schedule", `${r2(expiringSp)} SP in the expiring queue${liveQueueSp != null ? " (chain-live: delegated field − active rows, measured this run)" : " (deep-probe derivation — chain probe unavailable, honestly labeled)"} — detector armed; retune rails the day it lands`, 0, { delegOut, activeRowsVests: r2(activeRows), source: liveQueueSp != null ? "chain-live" : "deep-probe-cached" });
  }
  /* external shell leak */
  const flows = deep?.headcornerDelegations?.outFlows ?? [];
  const shells = flows.filter((f) => {
    const name = String(f.delegatee ?? "");
    const isArmyOrSoldier = /^(cashmachine|haran|israelnews|lsa|macrame|siq|tov|wic|wog|woq|hcsoldier\d)$/.test(name);
    const isCommunity = /^hive-\d+$/.test(name);
    return !isArmyOrSoldier && !isCommunity;
  });
  for (const s of shells) {
    const sp = finite(s.vests) / 1612.65;
    add(`recall-shell-${s.delegatee}`, custodyOk ? "execute-now" : "gated", `${r2(sp)} SP parked on external account "${s.delegatee}" (not custody, not persona, no rent received) — recall to battery; reversible op`, (sp * (finite(hc.effectiveSp) > 0 ? 0.57 / finite(hc.effectiveSp) : 0)) / 1, { delegatee: s.delegatee, sp: r2(sp), since: s.minDelegationTime });
  }
  /* VP pacing */
  if (Number.isFinite(headVpPct) && headVpPct < vpFloorPct) {
    const eta = etaToVpFloorHours({ vpPct: headVpPct, floorPct: vpFloorPct });
    add("vp-pace-headcorner", "schedule", `headcorner VP ${r2(headVpPct)}% below floor ${vpFloorPct}% — rail lawfully paused; unlocks in ~${r2(eta)}h at 20%/day regen; do NOT burn early`, 0, { vpPct: r2(headVpPct), etaHours: r2(eta) });
  }
  /* army pacing */
  const budget = sustainableVoteBudget({ maxPerDay: armyPolicy.maxPerDay, avgWeightPct: armyPolicy.avgWeightPct });
  if (budget < armyPolicy.maxPerDay) {
    add("army-pace", "law", `army maxPerDay ${armyPolicy.maxPerDay} exceeds regen-bounded budget ${budget} (burn ${armyPolicy.avgWeightPct}%×2%/vote) — pace to ${budget}/day so the floor never clamps mid-day`, 0, { budget, maxPerDay: armyPolicy.maxPerDay });
  }
  /* author rail honesty */
  const pending = deep?.pendingScan ?? {};
  if (Number.isFinite(pending.totalPendingUsd) && pending.totalPendingUsd < 0.01) {
    add("author-reach", "dormant-lane", `author rail measured $0.00 pending across ${pending.posts?.length ?? 0} recent posts — content without external votes pays dust; route content INTO challenge/community formats where whale votes live (operator-gated whitelist change)`, 0, { postsScanned: pending.posts?.length ?? 0 });
  }
  /* SBD routing */
  const ob = rout?.lanes?.sbdArb?.orderBook ?? {};
  const sbdRoute = sbdRoutingRule({ premiumPct: rout?.lanes?.sbdArb?.premiumPct, bookBid: ob.bestBid, feedSteemSbd: deep?.chain?.steemSbdFeed, inventorySbd: finite(hc.liquidSbd) });
  add("sbd-route", sbdRoute.verdict === "ROUTE-VIA-BOOK" ? "execute-now" : "dormant-lane", `SBD routing: ${sbdRoute.note}`, 0, sbdRoute);
  /* dead-lane honesty block */
  add("hbd-savings", "dormant-lane", `HBD savings interest measured ${finite(deep?.chain?.hbdInterestPct)}% — the lane is closed on-chain today`, 0, null);
  add("hive-blurt", "dormant-lane", "Hive 0 HP/0 HBD, Blurt dust — presence-only, honestly $0", 0, null);
  return { actions, sbdRoute, armyBudget: budget };
}

/* ── live: the landing detector — read from the chain, not from a cached probe ──
 * T-555 law-finding: the queue derived from the static deep-probe snapshot
 * (yield-deep-R292.json) rendered a FOSSIL — 767.69 SP claimed in the queue
 * while the chain truth (delegated field − live active rows) was 407.12 SP,
 * because part of the recall wave was re-delegated between snapshots
 * (6 rows × +59.96 SP measured 10:41→12:25). The router law already said
 * "landing is detected not assumed" — this function is the detection made
 * structural: public keyless reads, every routing run, no cache in the path.
 * Also captures the scheduled power-down (next_vesting_withdrawal) as RAW
 * chain fields — start time, size, progress — never interpreted away.
 * Fail-closed: every read failure returns { ok:false } — the caller labels
 * the cached derivation honestly instead of silently trusting a fossil. */
export async function probeLanding({ account = "headcorner", rowsLimit = 1000 } = {}) {
  const acc = await rpcCall("condenser_api.get_accounts", [[account]], 9000);
  if (!acc.ok || !Array.isArray(acc.result) || !acc.result[0]) return { ok: false, error: "account-read-failed" };
  const a = acc.result[0];
  const gp = await rpcCall("condenser_api.get_dynamic_global_properties", [], 9000);
  if (!gp.ok || !gp.result) return { ok: false, error: "props-read-failed" };
  const vests = (x) => parseFloat(String(x ?? "0").split(" ")[0].replace(/,/g, "")) || 0;
  const tvsh = vests(gp.result.total_vesting_shares);
  const tvfund = vests(gp.result.total_vesting_fund_steem);
  const vestsPerSp = tvsh > 0 ? tvsh / tvfund : 0; /* VESTS per 1 SP */
  const toSp = (v) => (vestsPerSp > 0 ? v / vestsPerSp : 0);
  const delegFieldVests = vests(a.delegated_vesting_shares);
  /* active outgoing rows — paginated; the deep-probe snapshot missed rows
   * grown after its stamp, which is exactly how the fossil was born */
  const rows = [];
  let from = "";
  const page = Math.min(Math.max(1, Math.floor(finite(rowsLimit))), 1000);
  for (let p = 0; p < 5; p++) {
    const d = await rpcCall("condenser_api.get_vesting_delegations", [account, from, page], 9000);
    if (!d.ok || !Array.isArray(d.result)) break;
    rows.push(...d.result);
    if (d.result.length < page) break;
    from = String(d.result[d.result.length - 1]?.delegatee ?? "");
    if (!from) break;
  }
  const activeVests = rows.reduce((s, r) => s + vests(r.vesting_shares), 0);
  const queueVests = Math.max(0, delegFieldVests - activeVests);
  const nwRaw = String(a.next_vesting_withdrawal ?? "");
  const nw = nwRaw && !/^(1969|1970)/.test(nwRaw) ? nwRaw : null;
  return {
    ok: true,
    at: new Date().toISOString(),
    source: "chain-live",
    account,
    vestsPerSp: r6(vestsPerSp),
    delegatedFieldSp: r2(toSp(delegFieldVests)),
    activeRowsSp: r2(toSp(activeVests)),
    activeRowsCount: rows.length,
    expiringQueueSp: r2(toSp(queueVests)),
    powerDown: nw ? {
      scheduled: true,
      nextWithdrawal: nw,
      toWithdrawVests: r2(finite(a.to_withdraw)),
      toWithdrawSp: r2(toSp(finite(a.to_withdraw))),
      withdrawnVests: r2(finite(a.withdrawn)),
      withdrawRateVests: String(a.vesting_withdraw_rate ?? ""),
      note: "raw chain fields — a vesting-withdraw schedule is active: start, size, progress; per-week semantics kept raw, never interpreted away",
    } : { scheduled: false, note: "no vesting-withdraw schedule on the account" },
  };
}

/* ── live: run the router from the deep probe state ─────────────── */
export function computeRouterReport({ now = new Date().toISOString(), custodyOk = true, liveLanding = null } = {}) {
  const deep = readJson(path.join(stateDir(), "yield-deep-R292.json"), null);
  if (!deep) return { verdict: "NO-PROBE", note: "yield-deep-R292.json missing — probe first", at: now };
  const hc = deep.accounts?.headcorner ?? {};
  const armyNames = Object.keys(deep.accounts ?? {}).filter((n) => n !== "headcorner");
  const armyAccounts = armyNames.map((n) => ({ account: n, effectiveSp: finite(deep.accounts[n].effectiveSp) }));
  const armySp = r2(armyAccounts.reduce((s, a) => s + a.effectiveSp, 0));
  /* army daily yield from the slots×SP law (regen-bounded budget per account,
   * early-window curve, measured VP ~90% → modelled at chain truth) */
  const vestsPerSp = finite(deep.chain?.vestsPerSp) || 1612.65;
  const armyDailySp = fleetYieldSpPerDay({
    accounts: armyAccounts.map((a) => ({ ...a, maxPerDay: sustainableVoteBudget({ maxPerDay: 12, avgWeightPct: 60 }) })),
    vestsPerSp, vpPct: 90, weightPct: 60, spPerGrs: CONSTANTS.curveEarly,
  });
  /* T-555 · the landing queue: chain-live when the probe succeeded — the
   * deep-probe derivation is kept ONLY as the drift comparison, so a fossil
   * can never masquerade as a measurement again. Fail-isolated: no probe →
   * cached derivation with an honest label. */
  const deepQueueSp = Math.max(0, finite(hc.delegatedOutSp) - ((deep.headcornerDelegations?.outFlows ?? []).reduce((s, f) => s + finite(f.vests), 0)) / 1612.65);
  const landing = liveLanding && liveLanding.ok
    ? {
        source: "chain-live",
        queueSp: liveLanding.expiringQueueSp,
        delegatedFieldSp: liveLanding.delegatedFieldSp,
        activeRowsSp: liveLanding.activeRowsSp,
        activeRowsCount: liveLanding.activeRowsCount,
        vestsPerSp: liveLanding.vestsPerSp,
        deepProbeQueueSp: r2(deepQueueSp),
        driftVsDeepProbeSp: r2(liveLanding.expiringQueueSp - deepQueueSp),
        at: liveLanding.at,
      }
    : {
        source: "deep-probe-cached",
        queueSp: r2(deepQueueSp),
        note: "live chain probe unavailable this run — the deep-probe derivation stands, honestly labeled (a cached derivation is a hypothesis, not a detection)",
      };
  const ladder = yieldLadder({
    headEffectiveSp: finite(hc.effectiveSp),
    headAprPct: 17.7,
    tagBoostPct: 40,
    armyDailySp,
    steemUsd: finite(deep.chain?.steemSbdFeed) || 0.104095,
    pendingLandingSp: landing.queueSp,
  });
  const ranked = rankActions({ deep, custodyOk, headVpPct: Number.isFinite(hc.vpPct) ? hc.vpPct : null, liveQueueSp: landing.source === "chain-live" ? landing.queueSp : null });
  const report = {
    at: now, law: ROUTER_LAW, verdict: "ROUTED",
    capital: deep.routing?.capital ?? null,
    landing,
    powerDown: liveLanding && liveLanding.ok ? liveLanding.powerDown : null,
    ladder,
    actions: ranked.actions,
    armyBudget: ranked.armyBudget,
    calibration: deep.calibration ?? null,
  };
  writeJson(path.join(stateDir(), "capital-router.json"), report);
  appendLine(path.join(receiptsDir(), "capital-router.jsonl"), { at: now, verdict: report.verdict, actions: report.actions.map((a) => a.id), ladderTop: ladder.stages[ladder.stages.length - 1]?.spPerDay ?? null });
  return report;
}

/* thin state reader (engine route shape parity with the other rails) */
export function routerState() {
  return readJson(path.join(stateDir(), "capital-router.json"), { verdict: "NO-PROBE", note: "capital-router.json missing — run the probe + router first" });
}

/* ── live: execute the router's execute-now actions (single-body law) ──
 * ONLY the recall-shell class executes here: delegate_vesting_shares with
 * amount exactly 0 — a pure recall the think gate's R292 exception allows
 * (and that structurally cannot create exposure). Idempotent: a chain
 * pre-read acks ALREADY-DONE when nothing is left to recall; the ack
 * ledger (state/capital-router-exec.json) prevents re-fires. The master
 * credential is chain-proven in-process first (verifyRoles) — the gate
 * refuses keyed-but-unverified identities by law. */
export async function executeRouterActions({ now = new Date().toISOString(), plan = null, executeAsFn = null, verifyRolesFn = null, masterAcct = "headcorner" } = {}) {
  const ackFile = path.join(stateDir(), "capital-router-exec.json");
  const ack = readJson(ackFile, { executed: {} });
  const p = plan ?? readJson(path.join(stateDir(), "capital-router.json"), null);
  if (!p?.actions) return { verdict: "NO-PLAN", executed: [] };
  const execFn = executeAsFn;
  if (!execFn) return { verdict: "NO-EXECUTOR", note: "executeAs not provided (test mode)", executed: [] };
  /* identity boot: the think gate refuses until the credential is chain-proven
   * THIS RUN (R233 gap closure) — prove it here, honestly, before any op */
  if (verifyRolesFn) {
    const ver = await verifyRolesFn(masterAcct);
    if (!ver?.ok) return { verdict: "IDENTITY-UNPROVEN", reason: String(ver?.reason ?? ver?.verdict ?? "unknown").slice(0, 140), executed: [] };
  }
  const executed = [];
  for (const a of p.actions) {
    if (a.class !== "execute-now") continue;
    const m = /^recall-shell-(.+)$/.exec(a.id);
    if (!m) continue;
    const shell = m[1];
    if (ack.executed[a.id]?.verified) { executed.push({ id: a.id, verdict: "ACK-ALREADY-DONE" }); continue; }
    /* chain pre-read — the truth beats every ledger */
    let currentVests = null;
    try {
      const { rpcCall } = await import("./measure.mjs");
      const r = await rpcCall("condenser_api.get_vesting_delegations", [masterAcct, "", 100]);
      const row = (r?.result ?? []).find((d) => d.delegatee === shell);
      currentVests = row ? parseFloat(String(row.vesting_shares).replace(/[^0-9.\-]/g, "")) || 0 : 0;
    } catch (e) {
      executed.push({ id: a.id, verdict: "PRE-READ-FAIL", error: String(e?.message ?? e).slice(0, 120) });
      continue;
    }
    if (!(currentVests > 0)) {
      ack.executed[a.id] = { at: now, verdict: "ALREADY-DONE", verified: true };
      executed.push({ id: a.id, verdict: "ALREADY-DONE" });
      continue;
    }
    const res = await execFn(masterAcct, [["delegate_vesting_shares", { delegator: masterAcct, delegatee: shell, vesting_shares: "0.000000 VESTS" }]], { tag: "R292-capital-route", role: "active" });
    const entry = { at: now, id: a.id, shell, vestsBefore: currentVests, ok: !!res.ok, verdict: res.verdict ?? null, txid: res.txid ?? null, reasons: res.reasons ?? null };
    if (res.ok) ack.executed[a.id] = { at: now, verdict: "BROADCASTED", txid: res.txid ?? null, verified: false };
    executed.push(entry);
    appendLine(path.join(receiptsDir(), "capital-router-exec.jsonl"), entry);
  }
  writeJson(ackFile, ack);
  return { verdict: "EXECUTED", executed };
}

/* CLI: bun capital-router.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = computeRouterReport({ custodyOk: true });
  console.log(JSON.stringify(out, null, 2));
}
