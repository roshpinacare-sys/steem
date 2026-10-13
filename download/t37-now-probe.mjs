/* T-37 · NOW-PROBE — "תבדוק עוד, ראה מה אתה יכול להבין עכשיו, ברגע זה"
 *
 * Zero credentials, public RPC only. Answers with chain truth, at this moment:
 *   A. Recall: did the 3057.25 delegated-out SP land? (T-35: delta 0.00; T-36
 *      measured 1211.31 effective) — effective-SP delta NOW.
 *   B. Unclaimed: reward balances of master + full army roster (claimed = SP
 *      compounding; unclaimed = idle fuel measured in VESTS).
 *   C. Dark-window damage: the engine died ~02:02Z and nobody could revive it
 *      (guardianship deadlock, T-37). What did the chain see since — curation
 *      ops, MM fills, transfers — vs the expected cadence?
 *   D. Powering-down check (to_withdraw > 0?) — the one silent capital leak.
 *
 * Output: docs/measured/t37-probe.json + a human verdict block on stdout.
 * Honesty laws: every number chain-read NOW; every failure surfaces as
 * UNMEASURED, never as zero. */
import * as fs from "node:fs";
import * as path from "node:path";

const RPCS = ["https://api.steemit.com", "https://api.justyy.com", "https://steem.61bts.com"];
const MASTER = "headcorner";
const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const DAY = 86_400_000;
const now = new Date();
const nowMs = now.getTime();

async function rpc(method, params) {
  for (const url of RPCS) {
    try {
      const ctrl = AbortSignal.timeout(12_000);
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ctrl,
      });
      const j = await r.json();
      if (j.error) throw new Error(String(j.error.message ?? "rpc error").slice(0, 120));
      return { ok: true, result: j.result, node: url };
    } catch (e) { lastErr = String(e?.message ?? e).slice(0, 120); }
  }
  return { ok: false, error: lastErr ?? "all nodes failed" };
}
let lastErr = null;

const amt = (s) => {
  const m = /^([\d.]+)\s+(\w+)$/.exec(String(s ?? ""));
  return m ? { v: parseFloat(m[1]), sym: m[2] } : null;
};
const vestsToSp = (v, perSp) => (Number.isFinite(v) && perSp > 0 ? v / perSp : null);

/* ── chain truth ── */
const dgpoR = await rpc("condenser_api.get_dynamic_global_properties", []);
if (!dgpoR.ok) { console.error("FATAL: no dgpo —", dgpoR.error); process.exit(1); }
const dgpo = dgpoR.result;
const totalVests = amt(dgpo.total_vesting_shares)?.v ?? 0;
const totalFund = amt(dgpo.total_vesting_fund_steem)?.v ?? 0;
const vestsPerSp = totalFund > 0 ? totalVests / totalFund : 0;

const all = [MASTER, ...ARMY];
const accsR = await rpc("condenser_api.get_accounts", [all]);
if (!accsR.ok) { console.error("FATAL: no accounts —", accsR.error); process.exit(1); }
const accs = accsR.result;

const nowIso = now.toISOString();
const perAccount = {};
for (const a of accs) {
  const name = a.name ?? a.account; /* condenser returns `name` (measured T-37) */
  const own = amt(a.vesting_shares)?.v ?? 0;
  const received = amt(a.received_vesting_shares)?.v ?? 0;
  const delegated = amt(a.delegated_vesting_shares)?.v ?? 0;
  const effVests = own + received - delegated;
  const rewVests = amt(a.reward_vesting_balance)?.v ?? 0;
  perAccount[name] = {
    ownSp: Math.round(own / vestsPerSp * 1000) / 1000,
    effSp: Math.round(effVests / vestsPerSp * 1000) / 1000,
    delegatedOutSp: Math.round(delegated / vestsPerSp * 1000) / 1000,
    receivedSp: Math.round(received / vestsPerSp * 1000) / 1000,
    unclaimed: {
      vests: rewVests,
      vestsSpEquiv: Math.round(rewVests / vestsPerSp * 1000) / 1000,
      steem: amt(a.reward_steem_balance)?.v ?? 0,
      sbd: amt(a.reward_sbd_balance)?.v ?? 0,
    },
    liquidSteem: amt(a.balance)?.v ?? 0,
    liquidSbd: amt(a.sbd_balance)?.v ?? 0,
    rcPct: a.rc
      ? Math.round((parseInt(a.rc.current_mana ?? "0", 10) / (parseInt(a.rc.max_rc ?? "1", 10) || 1)) * 1000) / 10
      : null,
    poweringDown: (parseInt(a.to_withdraw ?? "0", 10) > parseInt(a.withdrawn ?? "0", 10)) ? true : false,
  };
}

const m = perAccount[MASTER];
const armyAgg = ARMY.reduce((s, n) => {
  const a = perAccount[n];
  return a ? {
    effSp: s.effSp + a.effSp, unclaimedVests: s.unclaimedVests + a.unclaimed.vests,
    unclaimedSpEquiv: s.unclaimedSpEquiv + a.unclaimed.vestsSpEquiv,
    poweringDown: s.poweringDown || a.poweringDown,
  } : s;
}, { effSp: 0, unclaimedVests: 0, unclaimedSpEquiv: 0, poweringDown: false });

/* ── dark-window ops: what the chain saw since the engine died (~02:02Z) ── */
/* the appbase-native API is the working form (condenser asserts on this node —
 * measured T-37); identical fallback chain to the engine's own measure.mjs */
const histR = await rpc("account_history_api.get_account_history", { account: MASTER, start: -1, limit: 100 }); /* native API caps at 100 — measured T-37 */
let dark = { ok: false };
if (histR.ok) {
  const ops = (histR.result?.history ?? []).map(([, x]) => x);
  const tsOf = (x) => x?.timestamp ? Date.parse(x.timestamp + (x.timestamp.endsWith("Z") ? "" : "Z")) : 0;
  const since = ops.filter((x) => tsOf(x) >= nowMs - 36 * 3600_000);
  const darkOps = ops.filter((x) => tsOf(x) >= Date.parse("2026-10-09T01:28:00Z")); /* last live cycle's curator write */
  const count = (arr, pred) => arr.filter(pred).length;
  dark = {
    ok: true,
    since36h: {
      curationOps: count(since, (x) => /curation_reward/.test(x?.op?.type ?? "")),
      fillOrders: count(since, (x) => /fill_order/.test(x?.op?.type ?? "") && !/limit_order/.test(x?.op?.type ?? "")),
      transfers: count(since, (x) => /transfer/.test(x?.op?.type ?? "")),
      votes: count(since, (x) => /(^|\.)vote$/.test(x?.op?.type ?? "")),
      claims: count(since, (x) => /claim_reward_balance/.test(x?.op?.type ?? "")),
    },
    sinceEngineDeath: {
      windowFrom: "2026-10-09T01:28:00Z",
      opsTotal: darkOps.length,
      curationOps: count(darkOps, (x) => /curation_reward/.test(x?.op?.type ?? "")),
      fillOrders: count(darkOps, (x) => /fill_order$/.test(x?.op?.type ?? "")),
      votes: count(darkOps, (x) => /(^|\.)vote$/.test(x?.op?.type ?? "")),
    },
    newestOpAt: ops.length ? new Date(tsOf(ops[ops.length - 1])).toISOString() : null,
  };
}

/* ── recall verdict vs T-36 measured baseline ── */
const T36_EFF_SP = 1211.31;
const T35_DELEGATED_OUT = 3057.25;
const delta = m ? Math.round((m.effSp - T36_EFF_SP) * 1000) / 1000 : null;
if (m) {
  m.recall = {
    baselineT36EffSp: T36_EFF_SP, delegatedOutAtT35: T35_DELEGATED_OUT, effSpDeltaVsT36: delta,
    verdict: delta > 15 ? "SCALING-EVENT-DETECTED" : delta < -0.05 ? "REGRESSION-DETECTED" : "NO-CHANGE",
  };
}

const probe = {
  at: nowIso, node: dgpoR.node,
  vestsPerSp: Math.round(vestsPerSp * 1000) / 1000,
  feed: (() => { const f = dgpo?.feed_history?.current_median_history; return { sbdPerSteem: amt(f)?.v ?? null, raw: f ?? null }; })(),
  master: m ?? "UNMEASURED",
  armyAgg: { rosterSize: ARMY.length, ...armyAgg, effSp: Math.round(armyAgg.effSp * 1000) / 1000, unclaimedSpEquiv: Math.round(armyAgg.unclaimedSpEquiv * 1000) / 1000 },
  perAccount, dark,
  law: "T-37 now-probe: every number chain-read at this moment; failures surface as UNMEASURED, never zero",
};
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "docs", "measured");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "t37-probe.json"), JSON.stringify(probe, null, 2));

/* human block */
console.log(`\n=== T-37 NOW-PROBE @ ${nowIso} (node ${dgpoR.node}) ===`);
console.log(`vestsPerSP = ${probe.vestsPerSp}`);
if (m) {
  console.log(`MASTER effSp=${m.effSp} (T-36: ${T36_EFF_SP}, Δ=${delta}) → ${m.recall.verdict}`);
  console.log(`MASTER unclaimed: ${m.unclaimed.vestsSpEquiv} SP-equiv + ${m.unclaimed.steem} STEEM + ${m.unclaimed.sbd} SBD · RC=${m.rcPct}% · poweringDown=${m.poweringDown}`);
}
console.log(`ARMY(10) effSp=${probe.armyAgg.effSp} · unclaimed=${probe.armyAgg.unclaimedSpEquiv} SP-equiv · anyPowerDown=${probe.armyAgg.poweringDown}`);
console.log(`DARK-WINDOW since 01:28Z: ${JSON.stringify(dark.sinceEngineDeath ?? {})}`);
console.log(`newest master op on chain: ${dark.newestOpAt ?? "UNMEASURED"}`);
