/* ═══════════ T-72 PROBE · THE PROOF RUNG — WHERE IS THE FIRST DOLLAR? ═══════════
 * The operator's verdict (trace 1a1051ae8f9d091d): a full month of activity,
 * not one dollar of profit — PROVE YOURSELF. This probe measures, from chain
 * truth and live price oracles only:
 *   1. LIVE USD LEGS — the cockpit's parity was lowConfidence internal-feed
 *      derived (steemUsd 0.0628). coingecko + coinpaprika agree-or-name-the-gap.
 *   2. VOTES IN FLIGHT — every machine vote since 2026-09-28 (chain vote ops),
 *      then per voted post: pending payout, total rshares, OUR rshares →
 *      expected curation ≈ pending × 50% × ourShare, with cashout dates.
 *   3. PENDING CONTENT — the 16 machine posts' pending_payout (local receipts).
 *   4. MACHINE-ERA ERAS — lifetime vs machine-era vs dead-zone from the
 *      measured valueLedger (T-65), priced at the live legs.
 * Read-only: zero orders, zero keys, zero state writes. */
import dns from "node:dns";
import * as fs from "node:fs";
dns.setDefaultResultOrder("ipv4first");

const EP = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
async function rpc(method, params, timeoutMs = 12_000) {
  let lastErr = null;
  for (const base of EP) {
    try {
      const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`http-${r.status}`);
      const j = await r.json();
      if (j?.error) throw new Error(String(j.error.message).slice(0, 140));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("steem-endpoints-exhausted");
}
const num = (s) => Number(String(s ?? "").split(" ")[0]) || 0;
const ACC = "headcorner";
const opName = (op) => (Array.isArray(op) ? op[0] : op?.type?.replace(/_operation$/, "") ?? op?.type);

/* 1 · live USD legs */
async function coingecko() {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem,hive,hive_dollar&vs_currencies=usd", { signal: AbortSignal.timeout(10_000) });
  return await r.json();
}
async function coinpaprika() {
  try {
    const r = await fetch("https://api.coinpaprika.com/v1/tickers/steem-steem", { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    return { steemUsd: j?.quotes?.USD?.price ?? null, src: "coinpaprika" };
  } catch { return { steemUsd: null, src: "coinpaprika-failed" }; }
}

/* 2 · machine votes since 2026-09-28 (chain truth) */
async function ourVotes() {
  const r = await rpc("account_history_api.get_account_history", { account: ACC, start: -1, limit: 10000, select_ops: ["vote"] });
  const hist = r?.history ?? [];
  const cutoff = Date.parse("2026-09-28T00:00:00Z");
  const out = [];
  for (const [i, e] of hist) {
    if (opName(e?.op) !== "vote") continue;
    const v = (Array.isArray(e.op) ? e.op[1] : e.op.value) ?? {};
    if (v.voter !== ACC) continue;
    const ts = Date.parse(`${e.timestamp}Z`);
    if (ts < cutoff) continue;
    out.push({ idx: i, at: new Date(ts).toISOString(), author: v.author, permlink: v.permlink, weight: v.weight });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/* 3 · per voted post: pending + our rshare share */
async function postMoney(votes) {
  const uniq = new Map();
  for (const v of votes) uniq.set(`${v.author}/${v.permlink}`, v);
  const keys = [...uniq.keys()];
  const rows = [];
  for (let i = 0; i < keys.length; i += 6) {
    const chunk = keys.slice(i, i + 6);
    const res = await Promise.all(chunk.map(async (k) => {
      const [author, permlink] = k.split("/");
      try {
        const c = await rpc("condenser_api.get_content", [author, permlink]);
        const mine = (c.active_votes ?? []).find((a) => a.voter === ACC);
        const pend = num(c.pending_payout_value);
        const tot = Number(c.total_vote_weight ?? c.total_vote_rshares ?? 0);
        const mineR = Number(mine?.rshares ?? 0);
        const share = tot > 0 ? mineR / tot : 0;
        return { key: k, pendingSbd: pend, cashout: c.cashout_time, ourShare: share, ourWeight: mine?.weight ?? null, voters: (c.active_votes ?? []).length, netRshares: tot };
      } catch (e) { return { key: k, err: String(e).slice(0, 80) }; }
    }));
    rows.push(...res);
  }
  return rows;
}

/* 4 · machine-era eras from the measured valueLedger (local) */
const payouts = JSON.parse(fs.readFileSync(new URL("../../state/payouts.json", import.meta.url), "utf8"));
const vl = payouts?.valueLedger?.ledger ?? [];

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const ERA_START = "2026-09-09"; // machine era (T-21 adoption window anchor)
const out = { at: new Date().toISOString(), account: ACC, prices: null, votes: null, postMoney: null, eras: null, forecast: payouts?.forecast ?? null };

/* parallel: prices + votes */
const [cg, cp, votes] = await Promise.all([coingecko().catch((e) => ({ err: String(e).slice(0, 100) })), coinpaprika(), ourVotes()]);
out.prices = { coingecko: cg, paprika: cp };
out.votes = { count: votes.length, span: votes.length ? [votes[0].at, votes[votes.length - 1].at] : null, weightHistogram: votes.reduce((m, v) => { m[v.weight] = (m[v.weight] ?? 0) + 1; return m; }, {}) };
out.postMoney = votes.length ? await postMoney(votes) : [];

/* eras priced */
const dyn = await rpc("condenser_api.get_dynamic_global_properties", []);
const tvs = num(dyn.total_vesting_shares), tvf = num(dyn.total_vesting_fund_steem);
const v2s = tvs > 0 && tvf > 0 ? tvf / tvs : null;
const pend = out.postMoney.filter((p) => p.pendingSbd > 0);
const expCuration = pend.reduce((s, p) => s + p.pendingSbd * 0.5 * p.ourShare, 0);
const steemUsd = cg?.steem?.usd ?? cp?.steemUsd ?? null;
const hiveUsd = cg?.hive?.usd ?? null;
const hbdUsd = cg?.hive_dollar?.usd ?? null;
out.eras = {
  v2s, steemUsd, hiveUsd, hbdUsd,
  lifetime: (() => {
    let curationVests = 0, authorVests = 0, authorSbd = 0, authorSteem = 0, claimSbd = 0, claimSteem = 0, claimVests = 0, n = 0;
    for (const r of vl) {
      n++;
      if (r.kind === "curation") curationVests += num(r.vests);
      else if (r.kind === "author") { authorSbd += num(r.authorSbd ?? r.sbd); authorSteem += num(r.authorSteem ?? r.steem); authorVests += num(r.authorVests ?? r.vests); }
      else if (r.kind === "claim") { claimSbd += num(r.sbd); claimSteem += num(r.steem); claimVests += num(r.vests); }
    }
    return { n, curationVests: r6(curationVests), authorSbd: r6(authorSbd), authorSteem: r6(authorSteem), authorVests: r6(authorVests), claimSbd: r6(claimSbd), claimSteem: r6(claimSteem), claimVests: r6(claimVests) };
  })(),
  machineEra: (() => {
    let curationVests = 0, authorSbd = 0, authorSteem = 0, authorVests = 0, n = 0, oldest = null;
    for (const r of vl) {
      const d = String(r.at ?? "").slice(0, 10);
      if (d < ERA_START) continue;
      n++; if (!oldest || d < oldest) oldest = d;
      if (r.kind === "curation") curationVests += num(r.vests);
      else if (r.kind === "author") { authorSbd += num(r.authorSbd ?? r.sbd); authorSteem += num(r.authorSteem ?? r.steem); authorVests += num(r.authorVests ?? r.vests); }
    }
    return { n, oldest, curationVests: r6(curationVests), authorSbd: r6(authorSbd), authorSteem: r6(authorSteem), authorVests: r6(authorVests) };
  })(),
  inFlight: { votedPostsPending: pend.length, pendingSbdSum: r6(pend.reduce((s, p) => s + p.pendingSbd, 0)), expectedCurationUsd: v2s && steemUsd ? r6(expCuration * v2s * steemUsd) : null, expectedCurationSbdEquiv: r6(expCuration) },
};

/* per-vote curation yield from the LAST settled window (the era rows) */
const eraRows = vl.filter((r) => r.kind === "curation" && String(r.at ?? "").slice(0, 10) >= ERA_START);
out.eras.machineCurationOps = eraRows.length;
out.eras.machineCurationVests = r6(eraRows.reduce((s, r) => s + num(r.vests), 0));
console.log(JSON.stringify(out, null, 1));
