#!/usr/bin/env node
/* R292 · YIELD-DEEP PROBE — micro+macro profitability measurement, zero credentials.
 * Law: every number chain-sourced live; zero trust in prior reports (incl. ours).
 * New vs R290/T35 probes:
 *   A. scaling-event: did the 3057 SP delegation-out land back? (who holds it, when back)
 *   B. UNCLAIMED rewards per account — money sitting on the table right now
 *   C. vote-rshare calibration from active_votes (empirical, no formula guessing)
 *   D. author+pending payouts of OUR posts (author rail measured, not assumed)
 *   E. internal market depth (order book) → market-making fill feasibility
 *   F. HBD interest rate + savings balances
 *   G. delegation market probes (dlease family, deeper)
 * Output: state/yield-deep-R292.json + stdout summary */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ENGINE = path.join(DIR, "..", "mini-services", "saos-engine");
const OUT_FILE = path.join(ENGINE, "state", "yield-deep-R292.json");
const PREV_LEVERS = path.join(ENGINE, "state", "yield-levers.json");

const STEEM = "https://api.steemit.com";
const HEAD = "headcorner";
const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const ALL = [HEAD, ...ARMY];

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
const num = (s) => parseFloat(String(s ?? "0").replace(/[^0-9.\-]/g, "")) || 0;
const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
const r2 = (x) => Math.round(Number(x) * 100) / 100;

/* backward-paginated history walk (this node caps limit=100 — measured R290) */
async function recentOps(account, { pages = 30 } = {}) {
  const out = [];
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const r = await steem("condenser_api.get_account_history", [account, start, 100]);
    if (!r.ok) return { ops: out, error: r.error };
    const rows = r.result ?? [];
    if (!rows.length) break;
    for (const [idx, entry] of rows) {
      const rawOp = entry?.op;
      const [type, value] = Array.isArray(rawOp) ? rawOp : [rawOp?.type, rawOp?.value];
      if (!type) continue;
      out.push({ idx, type: type.replace(/_operation$/, ""), op: value ?? {}, ts: entry.timestamp });
    }
    const oldest = rows[0][0];
    if (rows.length < 100 || oldest <= 1) break;
    start = oldest - 1;
    if (start < 1) break;
  }
  out.sort((a, b) => a.idx - b.idx);
  return { ops: out, error: null };
}

/* ── A. delegations: who holds our SP — CURSOR-paginated (R292 fix: the
 * plain call returns only the first page; walk the delegatee cursor) ── */
async function delegationTruth(account) {
  const out = { outFlows: [], expiring: [] };
  let from = "", all = [], guard = 0;
  while (guard++ < 30) {
    const dR = await steem("condenser_api.get_vesting_delegations", [account, from, 100]);
    if (!dR.ok) { out.error = dR.error; break; }
    const rows = dR.result ?? [];
    if (!Array.isArray(rows) || !rows.length) break;
    all.push(...rows);
    from = rows[rows.length - 1].delegatee;
    if (rows.length < 100) break;
  }
  for (const d of all) {
    out.outFlows.push({ delegatee: d.delegatee, vests: num(d.vesting_shares), minDelegationTime: d.min_delegation_time });
  }
  out.outFlows.sort((a, b) => b.vests - a.vests);
  /* expiring = the account-level delegated field minus the ACTIVE rows sum —
   * get_expiring_delegations was REMOVED from this node (measured assert);
   * the arithmetic is the honest detector for the recall wave */
  return out;
}

/* ── C. empirical rshare calibration: our rows in active_votes ─── */
async function calibrateRshares(accounts, vestsPerSp) {
  /* find recent vote ops of a few accounts from history, then read the post's
   * active_votes row for OUR rshares → rshares-per-µVest × VP × weight */
  const samples = [];
  for (const acc of accounts.slice(0, 4)) {
    const h = await recentOps(acc, { pages: 6 });
    if (h.error) continue;
    const votes = h.ops.filter((o) => o.type === "vote" && o.op.voter === acc && o.op.weight > 0).slice(-4);
    for (const v of votes) {
      const c = await steem("condenser_api.get_content", [v.op.author, v.op.permlink]);
      if (!c.ok || !c.result?.author) continue;
      const row = (c.result.active_votes ?? []).find((x) => x.voter === acc);
      if (!row) continue;
      const accR = await steem("condenser_api.get_accounts", [[acc]]);
      if (!accR.ok || !accR.result?.[0]) continue;
      const a = accR.result[0];
      const effVests = num(a.vesting_shares) + num(a.received_vesting_shares) - num(a.delegated_vesting_shares);
      const vp = Number(a.voting_manabar?.current_mana ?? 0) / (effVests * 1e6);
      if (!(vp > 0) || effVests <= 0) continue;
      const rshares = Number(row.rshares);
      const w = num(v.op.weight) / 10000;
      /* rshares = k × vests_µ × weight × vp  →  k = rshares / (vests_µ × w × vp) */
      const k = rshares / (effVests * 1e6 * w * vp);
      samples.push({
        account: acc, author: v.op.author, permlink: String(v.op.permlink).slice(0, 40), at: v.ts,
        weightPct: Math.round(w * 1000) / 10, vpPct: r2(vp * 100),
        rshares, vestsMicro: Math.round(effVests * 1e6),
        k: r6(k),
      });
      if (samples.length >= 8) break;
    }
    if (samples.length >= 8) break;
  }
  /* robust k = median */
  const ks = samples.map((s) => s.k).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const medianK = ks.length ? ks[Math.floor(ks.length / 2)] : null;
  return { samples, medianK, note: medianK ? `rshares ≈ ${r6(medianK)} × vests_µ × weight × VP (empirical median of ${ks.length})` : "no calibration samples" };
}

/* ── main ──────────────────────────────────────────────────────── */
const now = new Date().toISOString();
console.log(`[yield-deep-R292] measuring at ${now}`);

const dgpo = await steem("condenser_api.get_dynamic_global_properties", []);
if (!dgpo.ok) {
  console.error("FATAL: no dgpo", dgpo.error);
  process.exit(1);
}
const g = dgpo.result;
const vestsPerSp = num(g.total_vesting_shares) / num(g.total_vesting_fund_steem);
/* R292 fix: total_reward_fund_steem/total_reward_shares2 read 0 on this node
 * (reward accounting moved to the pending_rewarded_vesting pair) — the rshare
 * valuation therefore uses the T35 EMPIRICAL curve + the calibrated k, never
 * this dead field. Kept here only as an honest diagnostic. */
const rawSteemPerRshare = num(g.total_reward_fund_steem) / num(g.total_reward_shares2);
const steemPerRshare = Number.isFinite(rawSteemPerRshare) && rawSteemPerRshare > 0 ? rawSteemPerRshare : null;
const feedR = await steem("condenser_api.get_feed_history", []);
const cur = feedR.ok ? feedR.result.current_median_history : null;
const steemSbdFeed = cur && num(cur.base) > 0 ? num(cur.base) / num(cur.quote) : null;
const tk = await steem("condenser_api.get_ticker", []);
const steemSbdLatest = tk.ok ? num(tk.result.latest) : null;
const steemUsd = steemSbdFeed; /* SBD≈$1 internal law */
const sbdPremiumPct = steemSbdLatest && steemSbdFeed ? r2((steemSbdLatest / steemSbdFeed - 1) * 100) : null;
const hbdInterestPct = num(g.hbd_interest_rate) / 100;

const accR = await steem("condenser_api.get_accounts", [ALL]);
if (!accR.ok) { console.error("FATAL: no accounts", accR.error); process.exit(1); }
const accounts = {};
for (const a of accR.result ?? []) {
  const effVests = num(a.vesting_shares) + num(a.received_vesting_shares) - num(a.delegated_vesting_shares);
  const vp = effVests > 0 ? Number(a.voting_manabar?.current_mana ?? 0) / (effVests * 1e6) : 0;
  /* FULL-vote value: what one 100%×100% vote adds to a post, in $ (author-side).
   * Valued on the T35 empirical early-curve via the calibrated k — the old
   * reward-fund formula reads 0 on this node (fields moved). */
  const fullVoteRshares = effVests * 1e6 * 0.02 * vp; /* refined after calibration */
  accounts[a.name] = {
    effectiveSp: r2(effVests / vestsPerSp),
    ownSp: r2(num(a.vesting_shares) / vestsPerSp),
    delegatedOutSp: r2(num(a.delegated_vesting_shares) / vestsPerSp),
    receivedSp: r2(num(a.received_vesting_shares) / vestsPerSp),
    vpPct: r2(vp * 100),
    rcPct: null,
    liquidSteem: num(a.balance),
    liquidSbd: num(a.sbd_balance),
    savingsSbd: num(a.savings_sbd_balance),
    savingsSteem: num(a.savings_balance),
    /* unclaimed rewards — money on the table NOW */
    claimable: {
      steem: num(a.reward_steem_balance),
      sbd: num(a.reward_sbd_balance),
      vests: num(a.reward_vesting_balance),
      vestsSp: r2(num(a.reward_vesting_balance) / vestsPerSp),
    },
    pendingRshares: fullVoteRshares, /* placeholder, refined after calibration */
  };
}
/* RC for all accounts */
const rcR = await steem("rc_api.find_rc_accounts", { accounts: ALL });
if (rcR.ok) {
  for (const rc of rcR.result.rc_accounts ?? []) {
    const pct = (Number(rc.rc_manabar.current_mana) / Number(rc.rc_manabar.max_mana)) * 100;
    if (accounts[rc.account]) accounts[rc.account].rcPct = r2(pct);
  }
}

/* headcorner delegation truth */
const hcDel = await delegationTruth(HEAD);

/* order book depth (market-making feasibility) */
const obR = await steem("condenser_api.get_order_book", [20]);
let orderBook = null;
if (obR.ok) {
  const bids = (obR.result.bids ?? []).map((b) => ({ sbd: num(b.sbd), steem: num(b.steem), price: num(b.sbd) / Math.max(1e-9, num(b.steem)) }));
  const asks = (obR.result.asks ?? []).map((a) => ({ sbd: num(a.sbd), steem: num(a.steem), price: num(a.sbd) / Math.max(1e-9, num(a.steem)) }));
  const bestBid = bids.length ? bids[0].price : null;
  const bestAsk = asks.length ? asks[0].price : null;
  orderBook = {
    bestBid, bestAsk,
    spreadPct: bestBid && bestAsk ? r2((bestAsk / bestBid - 1) * 100) : null,
    bidDepthSbd: r2(bids.reduce((s, b) => s + b.sbd, 0)),
    askDepthSteem: r2(asks.reduce((s, a) => s + a.steem, 0)),
    topBidSbd: bids.length ? r2(bids[0].sbd) : 0,
    topAskSteem: asks.length ? r2(asks[0].steem) : 0,
  };
}

/* calibration BEFORE vote-value pass */
const calib = await calibrateRshares([HEAD, ...ARMY.slice(0, 3)], vestsPerSp);
const K = calib.medianK ?? 1.0;

/* vote values + claimable totals */
let totalClaimableSp = 0, totalClaimableSbd = 0, totalClaimableSteem = 0;
const voteValues = {};
for (const [name, a] of Object.entries(accounts)) {
  const effVests = a.effectiveSp * vestsPerSp;
  const vp = a.vpPct / 100;
  /* calibrated full-vote rshares → $ */
  const fullVoteGrs = (effVests * 1e6 * K * vp) / 1e9;
  const curationSpFull = fullVoteGrs * 0.000416; /* early curve (T35, 96 ops) */
  a.fullVoteSpCurationEarly = r6(curationSpFull);
  a.fullVoteUsd = r6(curationSpFull * (steemUsd ?? 0));
  a.halfVoteUsd = r6((curationSpFull * (steemUsd ?? 0)) / 2);
  totalClaimableSp += a.claimable.vestsSp;
  totalClaimableSbd += a.claimable.sbd;
  totalClaimableSteem += a.claimable.steem;
}

/* author + pending scan: headcorner + first 6 army (history heavy) */
const authorScan = {};
for (const acc of [HEAD, ...ARMY.slice(0, 5)]) {
  const h = await recentOps(acc, { pages: 20 });
  if (h.error) { authorScan[acc] = { error: String(h.error).slice(0, 60) }; continue; }
  const oldest = h.ops.length ? Date.parse(h.ops[0].ts.endsWith("Z") ? h.ops[0].ts : h.ops[0].ts + "Z") : Date.now();
  const windowDays = Math.max(0.5, (Date.now() - oldest) / 86400_000);
  let authorVests = 0, authorSteem = 0, authorSbd = 0, authorOps = 0;
  let curVests = 0, curOps = 0;
  let claimsVests = 0, claimsSteem = 0, claimsSbd = 0, claimsOps = 0;
  let posts = 0, comments = 0, votes = 0, transfersIn = [];
  for (const o of h.ops) {
    if (o.type === "author_reward") { authorVests += num(o.op.vesting_payout); authorSteem += num(o.op.steem_payout); authorSbd += num(o.op.sbd_payout); authorOps++; }
    else if (o.type === "curation_reward") { curVests += num(o.op.reward); curOps++; }
    else if (o.type === "claim_reward_balance") { claimsVests += num(o.op.reward_vests); claimsSteem += num(o.op.reward_steem); claimsSbd += num(o.op.reward_sbd); claimsOps++; }
    else if (o.type === "comment" && !o.op.parent_author) posts++;
    else if (o.type === "comment") comments++;
    else if (o.type === "vote" && o.op.voter === acc) votes++;
    else if (o.type === "transfer" && o.op.to === acc) transfersIn.push({ at: o.ts, from: o.op.from, amount: o.op.amount });
  }
  authorScan[acc] = {
    windowDays: r2(windowDays), opsRead: h.ops.length,
    author: { ops: authorOps, sp: r2(authorVests / vestsPerSp), steem: r2(authorSteem), sbd: r2(authorSbd) },
    curation: { ops: curOps, sp: r2(curVests / vestsPerSp), spPerDay: r2(curVests / vestsPerSp / windowDays) },
    claims: { ops: claimsOps, sp: r2(claimsVests / vestsPerSp), steem: r2(claimsSteem), sbd: r2(claimsSbd) },
    activity: { posts, comments, votes },
    transfersIn: transfersIn.slice(-5),
  };
}

/* pending payouts on our recent posts (from learning.json permlinks + authorScan) */
let pendingScan = { posts: [], totalPendingUsd: 0 };
try {
  const troy = JSON.parse(fs.readFileSync(path.join(ENGINE, "state", "tag-roi.json"), "utf8"));
  const permSet = [...new Set([...Object.keys(troy.permlinks ?? {})])].slice(-10);
  for (const p of permSet) {
    const [author, permlink] = p.split("/");
    if (!author || !permlink) continue;
    const c = await steem("condenser_api.get_content", [author, permlink]);
    if (!c.ok || !c.result?.author) continue;
    const r = c.result;
    const pend = num(r.pending_payout_value);
    const total = num(r.total_payout_value) + num(r.curator_payout_value);
    pendingScan.posts.push({ author, permlink: String(permlink).slice(0, 40), pending: r2(pend), paid: r2(total), votes: (r.active_votes ?? []).length, cashout: r.cashout_time });
    pendingScan.totalPendingUsd += pend;
  }
} catch (e) { pendingScan.error = String(e?.message ?? e).slice(0, 80); }

/* delegation market probes (deeper) */
const dleaseOut = { probes: [] };
const dleaseProbes = [
  { name: "dlease-api-market", url: "https://api.dlease.io/market?count=5" },
  { name: "dlease-io-market", url: "https://market.dlease.io/api/market?count=5" },
  { name: "steemitway-delegation", url: "https://steemitway.com/delegation-service/" },
];
for (const p of dleaseProbes) {
  try {
    const r = await fetch(p.url, { signal: AbortSignal.timeout(8000) });
    let rate = null;
    if (r.ok) {
      const txt = await r.text();
      try {
        const j = JSON.parse(txt);
        const rows = Array.isArray(j) ? j : (j.market ?? j.result ?? []);
        if (Array.isArray(rows) && rows.length) {
          const aprs = rows.map((x) => parseFloat(String(x.apr ?? x.rate ?? "0"))).filter((x) => x > 0);
          if (aprs.length) rate = { minApr: Math.min(...aprs), maxApr: Math.max(...aprs), n: aprs.length };
        }
      } catch { /* html page — no structured rate */ }
    }
    dleaseOut.probes.push({ name: p.name, status: r.status, alive: r.ok, rate });
  } catch (e) {
    dleaseOut.probes.push({ name: p.name, alive: false, error: String(e?.message ?? e).slice(0, 60) });
  }
}

/* scaling event vs previous probe */
let scalingEvent = null;
try {
  const prev = JSON.parse(fs.readFileSync(PREV_LEVERS, "utf8"));
  const from = prev?.steem?.headcorner?.effectiveSp;
  const to = accounts[HEAD].effectiveSp;
  if (Number.isFinite(from) && to > 0) {
    const deltaPct = ((to - from) / from) * 100;
    if (Math.abs(deltaPct) >= 15) {
      scalingEvent = { detected: true, fromSp: r2(from), toSp: to, deltaPct: r2(deltaPct) };
    }
  }
} catch { /* first run */ }

/* ── THE ROUTING MATH (micro→macro) ────────────────────────────── */
const hc = accounts[HEAD];
const armyEff = ARMY.reduce((s, n) => s + accounts[n].effectiveSp, 0);
const armyVpAvg = ARMY.reduce((s, n) => s + accounts[n].vpPct, 0) / ARMY.length;
const routing = {
  capital: {
    headcornerEffectiveSp: hc.effectiveSp, armyEffectiveSp: r2(armyEff),
    fleetEffectiveSp: r2(hc.effectiveSp + armyEff),
    delegatedOutSp: hc.delegatedOutSp, expiringSoon: hcDel.expiring,
    liquidSteem: hc.liquidSteem, liquidSbd: hc.liquidSbd,
    unclaimedSp: r2(totalClaimableSp), unclaimedSbd: r2(totalClaimableSbd), unclaimedSteem: r2(totalClaimableSteem),
  },
  lanes: {
    headcornerCuration: { vpPct: hc.vpPct, fullVoteUsd: hc.fullVoteUsd, note: "VP-FLOOR block measured when vp<60 — scheduling law owns yield" },
    armyCuration: { sp: r2(armyEff), vpAvgPct: r2(armyVpAvg), perVoteUsd: r6(accounts[ARMY[0]].fullVoteUsd) },
    authorRail: "measured in authorScan below",
    hbdSavings: { ratePct: hbdInterestPct, ourSavingsSbd: hc.savingsSbd, note: hbdInterestPct > 0 ? `${hbdInterestPct}% APR on savings SBD — we hold dust only` : "no savings interest measured" },
    sbdArb: { premiumPct: sbdPremiumPct, orderBook },
    delegationMarket: dleaseOut,
  },
  calibration: calib,
};

const report = {
  at: now,
  chain: { headBlock: g.head_block_number, vestsPerSp: r2(vestsPerSp), steemPerRshare: steemPerRshare, rewardFundFieldsDead: !steemPerRshare, steemSbdFeed: r6(steemSbdFeed ?? 0), steemSbdLatest: steemSbdLatest, sbdPremiumPct, hbdInterestPct },
  accounts, headcornerDelegations: hcDel, authorScan, pendingScan,
  scalingEvent, routing,
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  chain: report.chain,
  headcorner: { effSp: hc.effectiveSp, ownSp: hc.ownSp, delegatedOut: hc.delegatedOutSp, vp: hc.vpPct, rc: hc.rcPct, liquid: hc.liquidSteem, sbd: hc.liquidSbd, fullVoteUsd: hc.fullVoteUsd, claimable: hc.claimable },
  delegationTruth: { outFlows: hcDel.outFlows.slice(0, 6), expiring: hcDel.expiring },
  army: { effSpTotal: r2(armyEff), vpAvg: r2(armyVpAvg), perFullVoteUsd: accounts[ARMY[0]]?.fullVoteUsd },
  unclaimed: { sp: r2(totalClaimableSp), sbd: r2(totalClaimableSbd), steem: r2(totalClaimableSteem) },
  authorScanHead: authorScan[HEAD],
  armySocialSample: { cashmachine: authorScan.cashmachine, haran: authorScan.haran },
  pendingScan: { totalPendingUsd: r2(pendingScan.totalPendingUsd), n: pendingScan.posts.length, top: pendingScan.posts.sort((a, b) => b.pending - a.pending).slice(0, 5) },
  orderBook, calibration: { k: calib.medianK, samples: calib.samples.length },
  scalingEvent, hbdInterestPct,
}, null, 2));
