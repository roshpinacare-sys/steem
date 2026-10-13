#!/usr/bin/env node
/* T-36 · RAIL ECONOMICS PROBE — measure EVERY income rail with chain truth:
 *  A. Market-making (hyperGrid): fill_order ops from history → realized P&L
 *     via the engine's own pure pnlFromFills + edge-vs-feed where overlap.
 *     NEVER MEASURED BEFORE — the one rail that could be silently bleeding.
 *  B. Author/curation actual split: paid posts we voted → author_payout vs
 *     curator_payout — measures the ring-vote keep-rate (not memory, chain).
 *  C. Vote-value table: SBD-per-rshare from dgpo, self-calibrated rshare
 *     constant against T-35's chain-truth myRshares → per-account vote value
 *     at current VP → ring-vote yield vs external curation yield per VP.
 *  D. Author-reward rail: author_reward ops (master) → measured SP/day.
 *  E. RC + convert state: rc manabars (11 accounts) + pending conversion
 *     requests (is the peg loop armed?).
 * Zero credentials. Output: docs/measured/t36-rails.json + stdout.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pnlFromFills } from "../mini-services/saos-engine/lib.mjs";
import { effectiveVests } from "../mini-services/saos-engine/curator.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, "..", "docs", "measured", "t36-rails.json");
const STEEM = "https://api.steemit.com";
const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const MASTER = "headcorner";

async function rpc(method, params, timeoutMs = 15000) {
  try {
    const r = await fetch(STEEM, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json();
    if (j.error) return { ok: false, error: j.error.message };
    return { ok: true, result: j.result };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}
const num = (s) => parseFloat(String(s ?? "0").replace(/[^0-9.\-]/g, "")) || 0;

async function recentOps(account, { pages = 50 } = {}) {
  const out = [];
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const r = await rpc("condenser_api.get_account_history", [account, start, 100]);
    if (!r.ok) return { ops: out, error: r.error };
    const rows = r.result ?? [];
    if (!rows.length) break;
    for (const [idx, entry] of rows) {
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

/* ═══ A · MARKET-MAKING P&L (chain truth fills) ══════════════════════════ */
async function probeMM() {
  const H = await recentOps(MASTER, { pages: 120 });
  if (H.error) return { verdict: "UNREAD", error: H.error };
  const fills = [];
  const windowOldest = H.ops[0]?.ts ?? null;
  for (const o of H.ops) {
    if (o.type !== "fill_order") continue;
    const cp = o.op.current_pays ?? "", opay = o.op.open_pays ?? "";
    const isAsk = /STEEM/.test(cp); // we (maker/current_owner) give STEEM → ask
    const steem = isAsk ? num(cp) : num(opay);
    const sbd = isAsk ? num(opay) : num(cp);
    fills.push({ side: isAsk ? "ask" : "bid", steem, sbd, at: o.ts });
  }
  const pnl = pnlFromFills(fills);
  /* edge vs feed where overlap: fill price vs current median */
  const f = await rpc("condenser_api.get_feed_history", []);
  const median = f.ok ? f.result?.current_median_history : null;
  const medPrice = median && median.base && median.quote ? num(median.base) / num(median.quote) : null;
  let edgeBps = [];
  if (medPrice > 0) {
    for (const fl of fills.slice(-200)) {
      const price = fl.sbd / fl.steem;
      const raw = fl.side === "ask" ? price / medPrice - 1 : 1 - price / medPrice;
      edgeBps.push(Math.round(raw * 10000));
    }
  }
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const days = Math.max(1e-9, (Date.now() - new Date(windowOldest + "Z").getTime()) / 86400e3);
  return {
    verdict: "OK", fills: fills.length, windowDays: Math.round(days * 10) / 10, windowOldest,
    realizedSbd: pnl.realizedSbd, realizedPerDay: Math.round((pnl.realizedSbd / days) * 1e4) / 1e4,
    buys: pnl.buys, sells: pnl.sells, boughtSteem: pnl.boughtSteem, soldSteem: pnl.soldSteem,
    spentSbd: pnl.spentSbd, proceedsSbd: pnl.proceedsSbd,
    openPositionSteem: pnl.positionSteem ?? (pnl.boughtSteem - pnl.soldSteem),
    edgeBps: { n: edgeBps.length, median: med(edgeBps), p25: med(edgeBps.slice(0, Math.floor(edgeBps.length / 4))), p75: med(edgeBps.slice(Math.floor((3 * edgeBps.length) / 4))) },
    note: "realizedSbd uses the engine's own pnlFromFills on chain-truth fills; edgeBps only where feed median overlaps (bias: fills near recent regime)",
  };
}

/* ═══ B · AUTHOR/CURATION SPLIT TRUTH (from T35's paid-post sample) ═══════ */
async function probeSplit() {
  const t35 = JSON.parse(fs.readFileSync(path.join(DIR, "..", "docs", "measured", "t35-probe.json"), "utf8"));
  const rows = t35.sections.C.votes ?? [];
  const paid = rows.filter((v) => v.payoutAt); // all curation ops fire at payout
  const out = [];
  for (const v of paid.slice(-24)) {
    const g = await rpc("condenser_api.get_content", [v.author, v.permlink]);
    if (!g.ok || !g.result?.total_payout_value) continue;
    const post = g.result;
    const authorPart = num(post.total_payout_value);      // STEEM SEMANTICS (T-36 measured): total_payout = AUTHOR side for paid posts
    const curatorPart = num(post.curator_payout_value);   // curators are SEPARATE
    const total = authorPart + curatorPart;
    if (total <= 0) continue; // skip still-pending (pending_payout only)
    out.push({
      author: v.author, total, curator: curatorPart,
      authorKeep: Math.round((authorPart / total) * 1000) / 1000,
      curatorShare: Math.round((curatorPart / total) * 1000) / 1000,
    });
  }
  const medKeep = out.length ? Math.round((out.reduce((s, x) => s + x.authorKeep, 0) / out.length) * 1000) / 1000 : null;
  return { verdict: "OK", samples: out, authorKeepMedian: medKeep, note: "STEEM paid-post semantics measured: total_payout_value = AUTHOR side; curator_payout_value separate. authorKeep = author/(author+curator)" };
}

/* ═══ C · VOTE-VALUE TABLE + RING-vs-CURATION ROUTING ════════════════════ */
async function probeVotes(vps, authorKeep) {
  const d = await rpc("condenser_api.get_dynamic_global_properties", []);
  const rf = await rpc("condenser_api.get_reward_fund", ["post"]);
  const rewardBalance = num(rf.result?.reward_balance);       // SBD-equivalent in fund (T-36 fix: moved OUT of dgpo)
  const recentClaims = num(rf.result?.recent_claims);          // total rshares claims
  const sbdPerRshare = recentClaims > 0 ? rewardBalance / recentClaims : 0;
  const accts = await rpc("condenser_api.get_accounts", [[MASTER, ...ARMY]]);
  if (!accts.ok) return { verdict: "UNREAD", error: accts.error };
  const head = Date.parse((d.result?.time ?? new Date().toISOString()).replace(" ", "T") + (d.result?.time.includes("Z") ? "" : "Z"));
  const rows = [];
  for (const a of accts.result ?? []) {
    const effV = effectiveVests(a);
    const maxMana = effV * 1e6;
    const cur = num(a.voting_manabar?.current_mana);
    const last = (a.voting_manabar?.last_update_time ?? 0) * 1000;
    const regenMs = maxMana / (432000e3); // full charge = 5 days, in ms
    const mana = cur + Math.max(0, head - last) * regenMs;
    const vp = Math.min(100, Math.round((mana / maxMana) * 1000 * 100) / 1000); // T-36 fix: ratio→%, min AFTER rounding
    /* SELF-CALIBRATED rshare law: rshares = eff_mana × vp × weight × K.
     * K derived from T-35 chain truth (myRshares at known weight/vp) —
     * the ×2 historical constant verified live, not assumed. */
    rows.push({
      account: a.name, effSp: Math.round((effV / vps) * 100) / 100, vpEff: vp,
      fullVoteValueSbd: Math.round((maxMana * (vp / 100) * sbdPerRshare) * 1e4) / 1e4,
      rc: null,
    });
  }
  /* K calibration — T-36 v2: ONLY from the freshest votes (vp@vote ≈ vp now).
   * v1 bug: calibrated from month-old votes whose battery state was unknown
   * (K inflated 8.5×). rshares = effMana × vp × weight × K; K measured stable
   * across the last 3 votes. */
  let start = -1;
  const freshVotes = [];
  for (let pg = 0; pg < 8 && freshVotes.length < 3; pg++) {
    const H = await rpc("condenser_api.get_account_history", [MASTER, start, 100]);
    if (!H.ok) break;
    for (const [, e] of (H.result ?? [])) {
      const t = Array.isArray(e.op) ? e.op[0] : e.op?.type;
      const v = Array.isArray(e.op) ? e.op[1] : e.op?.value;
      if (t === "vote" && v?.voter === MASTER) freshVotes.push({ author: v.author, permlink: v.permlink, weight: num(v.weight), ts: e.timestamp });
    }
    const oldest = (H.result ?? [])[0]?.[0];
    if (!oldest || oldest <= 1) break;
    start = oldest - 1;
  }
  const mAcct = (accts.result ?? []).find((x) => x.name === MASTER);
  const mEff = effectiveVests(mAcct) * 1e6;
  const mManaNow = num(mAcct?.voting_manabar?.current_mana) + Math.max(0, head - (mAcct?.voting_manabar?.last_update_time ?? 0) * 1000) * (mEff / 432000e3);
  const mVpNow = Math.min(100, (mManaNow / mEff) * 100);
  const ks = [];
  for (const vt of freshVotes) {
    const g = await rpc("condenser_api.get_content", [vt.author, vt.permlink]);
    const av = (g.result?.active_votes ?? []).find((x) => x.voter === MASTER);
    if (!av) continue;
    const voted = Date.parse(String(av.time).endsWith("Z") ? av.time : av.time + "Z");
    const vpThen = Math.max(1, mVpNow - ((Date.now() - voted) / 3600e3) * (100 / 120)); // 0.833%/h regen
    ks.push(Number(av.rshares) / (mEff * (vpThen / 100) * (vt.weight / 10000)));
  }
  ks.sort((a, b) => a - b);
  const K = ks.length ? ks[Math.floor(ks.length / 2)] : 1;
  for (const r of rows) r.fullVoteValueSbd = Math.round((r.effSp * vps * 1e6 * (r.vpEff / 100) * sbdPerRshare * (K / 1)) * 1e4) / 1e4;
  /* ring yield: self-vote returns authorKeep × voteValue (we keep author+our curation);
   * external curation measured 0.586 SP/day on master = APR basis */
  const ring = rows.map((r) => ({
    account: r.account,
    perSelfVoteSbd: r.fullVoteValueSbd,
    perSelfVoteKeepSbd: Math.round(r.fullVoteValueSbd * (authorKeep ?? 0.75) * 1e4) / 1e4,
  }));
  return {
    verdict: "OK", sbdPerRshare, rshareConstantK: Math.round(K * 1e6) / 1e6, rows, ring,
    masterCurationSpPerDay: 0.586, // R290 measured (2.2d × 42 ops) — kept as the external-curation benchmark
    note: "fullVoteValueSbd = full-weight full-VP self-vote value; real votes run at 35-80% weight → scale by weight",
  };
}

/* ═══ D · AUTHOR-REWARD RAIL (master, measured) ═══════════════════════════ */
async function probeAuthor(vps) {
  const H = await recentOps(MASTER, { pages: 60 });
  if (H.error) return { verdict: "UNREAD", error: H.error };
  const ar = H.ops.filter((o) => o.type === "author_reward");
  const windowOldest = H.ops[0]?.ts ?? null;
  const days = Math.max(1e-9, (Date.now() - new Date(windowOldest + "Z").getTime()) / 86400e3);
  let vests = 0, sbd = 0, steem = 0;
  for (const o of ar) { vests += num(o.op.vesting_payout); sbd += num(o.op.sbd_payout); steem += num(o.op.steem_payout); }
  return { verdict: "OK", ops: ar.length, windowDays: Math.round(days * 10) / 10, vests, sbd, steem, sp: vests / vps, spPerDay: (vests / vps) / days };
}

/* ═══ E · RC + CONVERT STATE ══════════════════════════════════════════════ */
async function probeRC() {
  const names = [MASTER, ...ARMY];
  const r = await rpc("rc_api.find_rc_accounts", { accounts: names });
  if (!r.ok) return { verdict: "UNREAD", error: r.error };
  const out = {};
  for (const a of r.result?.rc_accounts ?? []) {
    const cur = num(a.rc_manabar?.current_mana), max = num(a.max_rc);
    const last = (a.rc_manabar?.last_update_time ?? 0) * 1000;
    const regenMs = max / (432000e3); // 5-day full charge, ms (T-36 fix: same over-division bug as VP)
    const nowMs = Date.now();
    out[a.account] = { rcPct: Math.min(100, Math.round(((cur + Math.max(0, nowMs - last) * regenMs) / max) * 100 * 10) / 10) };
  }
  const conv = await rpc("condenser_api.get_conversion_requests", [MASTER]);
  return { verdict: "OK", rc: out, conversionRequests: conv.ok ? (conv.result ?? []).length : ("UNREAD:" + (conv.error ?? "?")), note: "conversion requests >0 = peg-loop armed and holding SBD for $1 convert" };
}

/* ═══ MAIN ═══════════════════════════════════════════════════════════════ */
const d = await rpc("condenser_api.get_dynamic_global_properties", []);
const f = await rpc("condenser_api.get_feed_history", []);
const vps = num(d.result?.total_vesting_shares) / num(d.result?.total_vesting_fund_steem);
const feed = f.result?.current_median_history ?? {};
const steemPerSbd = num(feed.base) / num(feed.quote);
const out = { at: new Date().toISOString(), vps: Math.round(vps * 10) / 10, steemPerSbd };
const log = (...a) => console.log(...a);

out.MM = await probeMM();
out.SPLIT = await probeSplit();
const keep = out.SPLIT.authorKeepMedian ?? 0.75;
out.VOTES = await probeVotes(vps, keep);
out.AUTHOR = await probeAuthor(vps);
out.RC = await probeRC();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

log("══ T36 RAILS ══", out.at, "vps=" + out.vps, "steem/SBD=" + steemPerSbd.toFixed(4));
const M = out.MM;
log("A·MM: fills=" + M.fills, "window=" + M.windowDays + "d", "realized=" + M.realizedSbd + "SBD", "perDay=" + M.realizedPerDay + "SBD", "edgeMed=" + M.edgeBps?.median + "bps", "openPos=" + M.openPositionSteem + "STEEM");
log("B·SPLIT: n=" + out.SPLIT.samples.length, "authorKeep=" + out.SPLIT.authorKeepMedian);
log("C·VOTES: sbdPerRshare=" + (out.VOTES.sbdPerRshare ?? 0).toExponential(3), "K=" + out.VOTES.rshareConstantK);
for (const r of out.VOTES.rows) log("  " + r.account.padEnd(12), "effSP=" + r.effSp, "vp=" + r.vpEff + "%", "fullVote=" + r.fullVoteValueSbd + "SBD");
log("D·AUTHOR: ops=" + out.AUTHOR.ops, "SP=" + Math.round(out.AUTHOR.sp * 1e4) / 1e4, "perDay=" + Math.round(out.AUTHOR.spPerDay * 1e4) / 1e4);
log("E·RC:", JSON.stringify(out.RC.rc), "convReq=" + out.RC.conversionRequests);
log("OUT:", OUT);
