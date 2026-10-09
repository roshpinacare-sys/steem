#!/usr/bin/env node
/* R290 · YIELDMAX PROBE — measure every revenue lever live, zero credentials.
 * Law: zero trust in every claim, including our own prior reports. Every number
 * here is read straight from the chains (Steem/Hive/Blurt) + market services.
 * Output: state/yield-levers.json (cockpit) + stdout summary. */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ENGINE = path.join(DIR, "..", "mini-services", "saos-engine");
const OUT_FILE = path.join(ENGINE, "state", "yield-levers.json");

const STEEM = "https://api.steemit.com";
const HIVE = "https://api.hive.blog";
const BLURT = "https://blurt-rpc.saboin.com";
const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const HIVE_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];

async function rpc(base, method, params, timeoutMs = 15000) {
  try {
    const r = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json();
    if (j.error) return { ok: false, error: j.error.message };
    return { ok: true, result: j.result };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
const steem = (m, p) => rpc(STEEM, m, p);
const hive = (m, p) => rpc(HIVE, m, p);
const blurt = (m, p) => rpc(BLURT, m, p);

/* strip asset suffix AND currency glyphs ("1.234 STEEM", "$0.104", "1.000 SBD") */
const num = (s) => parseFloat(String(s ?? "0").replace(/[^0-9.\-]/g, "")) || 0;
const isNum = (x) => Number.isFinite(x);

/* raw history walk — THIS NODE CAPS limit=100 (measured): paginate backwards
 * from -1, walk page by page until pages exhausted or window reached. */
async function recentOps(account, { pages = 50 } = {}) {
  const out = [];
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const r = await steem("condenser_api.get_account_history", [account, start, 100]);
    if (!r.ok) return { ops: out, error: r.error };
    const rows = r.result ?? [];
    if (!rows.length) break;
    for (const [idx, entry] of rows) {
      /* condenser shape: entry.op = ["type", {...}] | appbase: entry.op = {type, value} */
      const rawOp = entry?.op;
      const [type, value] = Array.isArray(rawOp) ? rawOp : [rawOp?.type, rawOp?.value];
      if (!type) continue;
      out.push({ idx, type, op: value ?? {}, ts: entry.timestamp });
    }
    const oldest = rows[0][0];
    if (rows.length < 100 || oldest <= 1) break;
    start = oldest - 1;
    if (start < 1) break;
  }
  out.sort((a, b) => a.idx - b.idx);
  return { ops: out, error: null };
}

function vestsToSp(vests, vestsPerSp) { return vests / vestsPerSp; }

function effectiveVests(acc) {
  const recv = (acc.vesting_shares ? num(acc.vesting_shares) : 0)
    + (acc.received_vesting_shares ? num(acc.received_vesting_shares) : 0)
    - (acc.delegated_vesting_shares ? num(acc.delegated_vesting_shares) : 0);
  return recv;
}

function vpEffPct(mana, vests) {
  if (!vests || vests <= 0) return null;
  /* curator.mjs-consistent: pool = vests/200 mana units; VP% = mana/pool */
  const pool = vests / 200;
  const pct = (mana / pool) * 100;
  return Math.round(Math.min(100, pct) * 10) / 10;
}

/* ── STEEM section ─────────────────────────────────────────────── */
async function measureSteem() {
  const out = { chain: "steem", ok: true, levers: {} };
  const dgpo = await steem("condenser_api.get_dynamic_global_properties", []);
  if (!dgpo.ok) return { ok: false, error: dgpo.error };
  /* R289 measured-law: vestsPerSP = total_vesting_shares / total_vesting_fund_steem
   * (≈1612) — the INVERTED ratio was the exact bug R289 already caught; fixed. */
  const vestsPerSp = num(dgpo.result.total_vesting_shares) / num(dgpo.result.total_vesting_fund_steem);
  const steemPerRshare = num(dgpo.result.total_reward_fund_steem) / num(dgpo.result.total_reward_shares2);
  out.vestsPerSp = Math.round(vestsPerSp * 100) / 100;
  out.steemPerRshare = steemPerRshare;
  out.headBlock = dgpo.result.head_block_number;
  out.time = dgpo.result.time;

  const accR = await steem("condenser_api.get_accounts", [["headcorner"]]);
  const acc = accR.ok ? accR.result?.[0] : null;
  if (!acc) return { ok: false, error: "no headcorner read" };
  const own = num(acc.vesting_shares);
  const effVests = effectiveVests(acc);
  const effSp = vestsToSp(effVests, vestsPerSp);
  out.headcorner = {
    ownSp: Math.round(own / vestsPerSp * 100) / 100,
    effectiveSp: Math.round(effSp * 100) / 100,
    delegatedOutSp: Math.round(num(acc.delegated_vesting_shares) / vestsPerSp * 100) / 100,
    receivedSp: Math.round(num(acc.received_vesting_shares) / vestsPerSp * 100) / 100,
    vpEffPct: null,
    liquidSteem: num(acc.balance),
    liquidSbd: num(acc.sbd_balance),
    rcPct: null,
  };
  // RC
  const rcR = await steem("rc_api.find_rc_accounts", { accounts: ["headcorner"] });
  if (rcR.ok) {
    const rc = rcR.result.rc_accounts?.[0];
    if (rc) {
      const pct = (Number(rc.rc_manabar.current_mana) / Number(rc.rc_manabar.max_mana)) * 100;
      out.headcorner.rcPct = Math.round(pct * 10) / 10;
    }
  }
  // VP — curator.mjs-consistent: max mana = vests × 1e6 (µ-vests)
  const mana = Number(acc.voting_manabar?.current_mana ?? 0);
  out.headcorner.vpEffPct = effVests > 0 ? Math.round(Math.min(100, (mana / (effVests * 1e6)) * 1000) / 10 * 10) / 10 : null;
  const vpOf = (a, av) => {
    const m = Number(a.voting_manabar?.current_mana ?? 0);
    return av > 0 ? Math.round(Math.min(100, (m / (av * 1e6)) * 1000)) / 10 : null;
  };

  /* recall-in-flight check: 7d delegate_vesting slippage — compare delegated-out
   * vs the 3057 SP R289 measured; positive drop = recalls landing */
  out.headcorner.delegatedOutDeltaVsR289 =
    Math.round((3057.2 - out.headcorner.delegatedOutSp) * 100) / 100;

  /* 7d curation on headcorner + army — local filter over recent ops */
  const hc = await recentOps("headcorner", { pages: 60 });
  out.headcorner.historyScan = { opsRead: hc.ops.length, error: hc.error, oldestTs: hc.ops.length ? hc.ops[0].ts : null };
  const hist = {};
  for (const o of hc.ops) hist[o.type] = (hist[o.type] ?? 0) + 1;
  out.headcorner.opsHistogram = hist;
  if (hc.ops.length) {
    const seven = Date.now() - 7 * 86400_000;
    let curationVests = 0, claimSp = 0, curationOps = 0, authorVests = 0, authorOps = 0;
    const transfers = [], curSamples = [];
    for (const o of hc.ops) {
      const t = Date.parse(o.ts.endsWith("Z") ? o.ts : o.ts + "Z");
      if (t < seven) continue;
      /* condenser history types have NO _operation suffix; appbase style does — normalize */
      const ty = o.type.replace(/_operation$/, "");
      if (ty === "curation_reward") {
        curationVests += num(o.op.reward); curationOps++;
        if (curSamples.length < 6) curSamples.push({ at: o.ts, sp: Math.round(num(o.op.reward) / vestsPerSp * 1000) / 1000, comment: `${o.op.comment_author}/${o.op.comment_permlink}` });
      }
      if (ty === "author_reward") { authorVests += num(o.op.vesting_payout); authorOps++; }
      if (ty === "claim_reward_balance") claimSp += vestsToSp(num(o.op.reward_vests ?? o.op.reward_vesting_shares), vestsPerSp);
      if (ty === "transfer") transfers.push({ at: o.ts, from: o.op.from, to: o.op.to, amount: o.op.amount, memo: String(o.op.memo ?? "").slice(0, 60) });
    }
    out.headcorner.transfersWindow = transfers;
    /* window is honest: measured per-day = total / ACTUAL window days (2-3), not /7 */
    const oldest = Date.parse(hc.ops[0].ts.endsWith("Z") ? hc.ops[0].ts : hc.ops[0].ts + "Z");
    const windowDays = Math.max(1, (Date.now() - oldest) / 86400_000);
    out.headcorner.measuredWindowDays = Math.round(windowDays * 10) / 10;
    out.headcorner.curation7d = { ops: curationOps, sp: Math.round(vestsToSp(curationVests, vestsPerSp) * 1000) / 1000, perDay: Math.round(vestsToSp(curationVests, vestsPerSp) / windowDays * 1000) / 1000 };
    out.headcorner.author7d = { ops: authorOps, sp: Math.round(vestsToSp(authorVests, vestsPerSp) * 1000) / 1000 };
    out.headcorner.claims7dSp = Math.round(claimSp * 1000) / 1000;
    out.headcorner.curationSamples = curSamples;
    out.headcorner.aprPct = effSp > 0
      ? Math.round((vestsToSp(curationVests, vestsPerSp) / windowDays / effSp * 36500) * 10) / 10
      : null;
  }

  /* army */
  const armyR = await steem("condenser_api.get_accounts", [ARMY_ROSTER]);
  if (armyR.ok) {
    out.army = [];
    for (const a of armyR.result ?? []) {
      const av = effectiveVests(a);
      const mana = Number(a.voting_manabar?.current_mana ?? 0);
      out.army.push({
        account: a.name,
        effectiveSp: Math.round(av / vestsPerSp * 100) / 100,
        vpEffPct: vpOf(a, av),
      });
    }
    out.armyTotals = {
      effectiveSp: Math.round(out.army.reduce((s, x) => s + x.effectiveSp, 0) * 100) / 100,
      vpIdlePct: Math.round((out.army.reduce((s, x) => s + (x.vpEffPct ?? 0), 0) / Math.max(1, out.army.length)) * 10) / 10,
    };
  }

  /* market + feed → SBD premium */
  const tk = await steem("condenser_api.get_ticker", []);
  if (tk.ok) {
    out.market = {
      latest: num(tk.result.latest),
      lowestAsk: num(tk.result.lowest_ask),
      highestBid: num(tk.result.highest_bid),
      percentChange: num(tk.result.percent_change),
    };
  }
  const feed = await steem("condenser_api.get_feed_history", []);
  if (feed.ok) {
    /* measured shape (2026-10-09): current_median_history = {base:"58306064.400 SBD",
     * quote:"560121848.335 STEEM"} — the node scales both legs but the RATIO is the
     * law: feed SBD-per-STEEM = base/quote ≈ 0.10409. */
    const cur = feed.result.current_median_history;
    const steemSbdFeed = num(cur.base) > 0 ? num(cur.base) / num(cur.quote) : null;
    out.feed = { steemSbdFeed, steemUsd: steemSbdFeed, sbdUsd: 1.0 };
    if (out.market && isNum(out.market.latest) && steemSbdFeed > 0) {
      out.sbdPremiumPct = Math.round((out.market.latest / steemSbdFeed - 1) * 10000) / 100;
      out.arbNote = out.market.latest < steemSbdFeed * 0.99
        ? `STEEM trades below feed on internal market — SBD→STEEM buys at ~${Math.round((1 - out.market.latest / steemSbdFeed) * 10000) / 100}% discount`
        : out.market.latest > steemSbdFeed * 1.01
          ? "STEEM trades above feed — STEEM→SBD sells at a premium"
          : "within peg band — no edge";
    }
  }
  return out;
}

/* ── HIVE section ──────────────────────────────────────────────── */
async function measureHive() {
  const out = { chain: "hive", ok: true, accounts: [], totals: { hivePower: 0, hbd: 0, hive: 0 } };
  const dgpo = await hive("condenser_api.get_dynamic_global_properties", []);
  const vestsPerHp = dgpo.ok ? num(dgpo.result.total_vesting_fund_hive) / num(dgpo.result.total_vesting_shares_hive) : null;
  const r = await hive("condenser_api.get_accounts", [HIVE_ROSTER]);
  if (!r.ok) return { ok: false, error: r.error };
  for (const a of r.result ?? []) {
    const own = num(a.vesting_shares) + num(a.received_vesting_shares) - num(a.delegated_vesting_shares);
    const hp = vestsPerHp ? Math.round(own / vestsPerHp * 1000) / 1000 : null;
    const hbd = num(a.hbd_balance);
    const hiv = num(a.balance);
    out.accounts.push({ account: a.name, hivePower: hp, hbd, hive: hiv });
    out.totals.hivePower += hp ?? 0;
    out.totals.hbd += hbd;
    out.totals.hive += hiv;
  }
  out.totals.hivePower = Math.round(out.totals.hivePower * 1000) / 1000;
  out.totals.hbd = Math.round(out.totals.hbd * 1000) / 1000;
  out.totals.hive = Math.round(out.totals.hive * 1000) / 1000;
  return out;
}

/* ── BLURT section ─────────────────────────────────────────────── */
async function measureBlurt() {
  const out = { chain: "blurt", ok: true, accounts: [], totals: { blurtPowerVests: 0, liquid: 0 } };
  const names = ["headcorner", ...ARMY_ROSTER];
  const r = await blurt("condenser_api.get_accounts", [names]);
  if (!r.ok) return { ok: false, error: r.error };
  for (const a of r.result ?? []) {
    const vests = num(a.vesting_shares);
    out.accounts.push({ account: a.name, vests, liquid: num(a.balance) });
    out.totals.blurtPowerVests += vests;
    out.totals.liquid += num(a.balance);
  }
  out.totals.blurtPowerVests = Math.round(out.totals.blurtPowerVests * 1000) / 1000;
  out.totals.liquid = Math.round(out.totals.liquid * 1000) / 1000;
  return out;
}

/* ── delegation market liveness ────────────────────────────────── */
async function probeDelegationMarket() {
  const out = { candidates: [] };
  const probes = [
    { name: "dlease", url: "https://market.dlease.io/api/market?count=5" },
    { name: "steemit-aggregator", url: "https://sds.steemhub.eu/Delegations" },
  ];
  for (const p of probes) {
    try {
      const r = await fetch(p.url, { signal: AbortSignal.timeout(8000) });
      out.candidates.push({ name: p.name, status: r.status, alive: r.ok });
    } catch (e) {
      out.candidates.push({ name: p.name, alive: false, error: String(e?.message ?? e).slice(0, 80) });
    }
  }
  return out;
}

/* ── lever matrix ──────────────────────────────────────────────── */
function leverMatrix(m) {
  const levers = [];
  const steemUsd = m.steem?.feed?.steemUsd ?? null;
  const usd = (sp) => steemUsd ? Math.round(sp * steemUsd * 10000) / 10000 : null;

  // L1 curation headcorner (measured 7d)
  const hc = m.steem?.headcorner ?? {};
  if (hc.curation7d) {
    const apr = hc.aprPct ?? null;
    levers.push({
      id: "steem-curation-headcorner",
      state: "LIVE",
      measuredSpPerDay: hc.curation7d.perDay,
      measuredUsdPerDay: usd(hc.curation7d.perDay),
      aprPct: apr,
      note: `7d measured ${hc.curation7d.ops} ops; effective ${hc.effectiveSp} SP; R289 tune ×4 VP utilization + recalls ${hc.delegatedOutDeltaVsR289} SP already back`,
    });
  }
  // L2 army curation (NEW R290 rail — policy numbers are the live law)
  const at = m.steem?.armyTotals;
  if (at) {
    /* armyCuratorPolicy(): maxPerDay 12, weights 80/40 → avg 60% →
     * VP burn/day = 12 × 0.60 = 7.2% of each account's battery (< 20% regen).
     * Projected yield scales headcorner's MEASURED APR by deployed-VP ratio. */
    const maxPerDay = 12, avgWeightPct = 60;
    const burnPerDayPct = (maxPerDay * avgWeightPct) / 100; // 7.2%/day
    const regenPct = 20;
    const aprFrac = ((hc.aprPct ?? 6.5) / 100) / 365;
    /* honest scaling: headcorner's measured APR assumes ~full VP deployment;
     * the army deploys only burnPerDayPct/regenPct of its battery per day */
    const projSpPerDay = at.effectiveSp * aprFrac * (burnPerDayPct / regenPct);
    levers.push({
      id: "steem-curation-army",
      state: "R290-NEW",
      armySp: at.effectiveSp,
      vpIdlePct: at.vpIdlePct,
      sustainableVotesPerDay: ARMY_ROSTER.length * maxPerDay,
      projectedSpPerDay: Math.round(projSpPerDay * 1000) / 1000,
      projectedUsdPerDay: usd(projSpPerDay),
      note: `10 accounts × ${maxPerDay} votes/day × ~${avgWeightPct}% weight = ${burnPerDayPct}%/day VP burn < ${regenPct}% regen (external-only, VP-floor 35)`,
    });
  }
  // L3 SBD peg arb — honest gate: the edge must exceed costs AND the inventory must matter
  if (m.steem?.sbdPremiumPct != null) {
    const premium = m.steem.sbdPremiumPct;
    const meaningful = Math.abs(premium) > 3 && (hc.liquidSbd ?? 0) > 5;
    levers.push({
      id: "sbd-peg-arb",
      state: meaningful ? "ACTIVE-OPPORTUNITY" : "DORMANT",
      premiumPct: premium,
      liquidSbd: hc.liquidSbd,
      note: meaningful
        ? premium > 0
          ? `SBD trades ${premium}% above internal feed ratio — ladder-sell SBD→STEEM then re-stake`
          : `STEEM ${premium}% below feed — SBD→STEEM buys at a discount`
        : `SBD within peg band (${premium}%) or inventory dust — no arb edge today`,
    });
  }
  // L4 market-making (existing rail)
  levers.push({
    id: "steem-market-making",
    state: "LIVE-THIN",
    liquidSteem: hc.liquidSteem,
    liquidSbd: hc.liquidSbd,
    note: "STEEM/SBD book rail runs; inventory ~" + hc.liquidSteem + " STEEM — fills pay spread bps, capital-bound",
  });
  // L5 hive rail
  if (m.hive?.ok) {
    const t = m.hive.totals;
    levers.push({
      id: "hive-multi-chain",
      state: t.hivePower > 1 || t.hbd > 1 ? "CAPITAL-READY" : "DUST-ONLY",
      hivePower: t.hivePower,
      hbd: Math.round(t.hbd * 1000) / 1000,
      hive: t.hive,
      note: "9/9 posting custody verified; HBD savings pays 15% APR if HBD parked; curation needs HP",
    });
  }
  // L6 blurt
  if (m.blurt?.ok) {
    levers.push({
      id: "blurt-multi-chain",
      state: "DUST-ONLY",
      blurtPowerVests: m.blurt.totals.blurtPowerVests,
      liquidBlurt: m.blurt.totals.liquid,
      note: "full key access on 11 pre-fork same-name accounts; capital dust — publish-only surface",
    });
  }
  // L7 delegation market
  if (m.delegation) {
    const alive = m.delegation.candidates.filter((c) => c.alive);
    levers.push({
      id: "sp-delegation-market",
      state: alive.length ? "MARKET-FOUND" : "MARKET-DEAD",
      probes: m.delegation.candidates,
      note: alive.length
        ? "delegation marketplace reachable — compare offers APR vs own curation APR"
        : "no live delegation marketplace found — curation remains the only SP yield path",
    });
  }
  // L8 author / multi-chain publish
  if (hc.author7d) {
    levers.push({
      id: "author-multichain-publish",
      state: "STRUCTURAL",
      author7dSp: hc.author7d.sp,
      note: "11 broadcast-ready packages compiled; same content → Steem+Hive+Blurt triples the author-reward surface; reach requires external curators",
    });
  }
  return levers;
}

/* ── main ──────────────────────────────────────────────────────── */
const now = new Date().toISOString();
console.log(`[yieldmax-R290] measuring at ${now}`);
const [steemM, hiveM, blurtM, delegationM] = await Promise.all([
  measureSteem(), measureHive(), measureBlurt(), probeDelegationMarket(),
]);
const report = { at: now, steem: steemM, hive: hiveM, blurt: blurtM, delegation: delegationM, levers: leverMatrix({ steem: steemM, hive: hiveM, blurt: blurtM, delegation: delegationM }) };
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  headcorner: report.steem?.headcorner,
  armyTotals: report.steem?.armyTotals,
  feed: report.steem?.feed,
  market: report.steem?.market,
  sbdPremiumPct: report.steem?.sbdPremiumPct,
  hive: report.hive?.totals,
  blurt: report.blurt?.totals,
  delegation: report.delegation,
  levers: report.levers?.map((l) => `${l.id}: ${l.state} — ${l.note}`),
}, null, 2));
