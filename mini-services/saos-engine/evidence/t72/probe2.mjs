/* T-72 probe2 · THE BATTERY'S TRUE APR + CORRECT RSHARE MATH (scale-law-guarded) */
import dns from "node:dns";
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
  throw lastErr ?? new Error("exhausted");
}
const num = (s) => Number(String(s ?? "").split(" ")[0]) || 0;
const ACC = "headcorner";
const out = {};

/* 1 · reward fund — the curation pool physics */
try { out.rewardFund = await rpc("condenser_api.get_reward_fund", ["Steem"]); } catch (e) { out.rewardFund = { err: String(e).slice(0, 120) }; }

/* 2 · our last few votes: RAW active_votes entries (scale truth) */
let vh = null; try { vh = await rpc("account_history_api.get_account_history", { account: ACC, start: -1, limit: 500, select_ops: ["vote"] }); } catch (e) { out.vhErr = String(e).slice(0, 120); vh = { history: [] }; }
const votes = (vh?.history ?? []).map(([, e]) => e.op).filter((op) => (Array.isArray(op) ? op[0] : op?.type?.replace(/_operation$/, "")) === "vote").map((op) => (Array.isArray(op) ? op[1] : op.value)).filter((v) => v.voter === ACC).slice(-6);
out.voteSamples = [];
for (const v of votes) {
  try {
    const c = await rpc("condenser_api.get_content", [v.author, v.permlink]);
    const mine = (c.active_votes ?? []).find((a) => a.voter === ACC);
    const sumW = (c.active_votes ?? []).reduce((s, a) => s + Number(a.weight ?? 0), 0);
    const sumR = (c.active_votes ?? []).reduce((s, a) => s + Number(a.rshares ?? 0), 0);
    out.voteSamples.push({
      key: `${v.author}/${v.permlink}`.slice(0, 60), voteAt: v.timestamp, myWeight: v.weight,
      contentPend: num(c.pending_payout_value), cashout: c.cashout_time,
      myRshares: mine?.rshares ?? null, myAVWeight: mine?.weight ?? null,
      sumActiveWeights: sumW, sumActiveRshares: sumR,
      totalVoteWeight: Number(c.total_vote_weight ?? 0), netRshares: Number(c.net_rshares ?? 0),
      shareByWeights: sumW > 0 ? (mine?.weight ?? 0) / sumW : null,
      shareByRshares: sumR > 0 ? (mine?.rshares ?? 0) / sumR : null,
    });
  } catch (e) { out.voteSamples.push({ key: v.author + "/" + v.permlink, err: String(e).slice(0, 60) }); }
}

/* 3 · SBD real USD — coinpaprika steem-dollars + binance-style fallbacks */
try { const r = await fetch("https://api.coinpaprika.com/v1/tickers/sbd-steem-dollars", { signal: AbortSignal.timeout(10000) }); const j = await r.json(); out.sbdUsdPaprika = j?.quotes?.USD?.price ?? null; } catch (e) { out.sbdUsdPaprika = "err:" + String(e).slice(0, 50); }
/* internal market SBD→STEEM → USD: SBD in STEEM terms × STEEM/USD */
try { out.book1 = await rpc("condenser_api.get_order_book", [1]); } catch (e) { out.book1 = { err: String(e).slice(0, 120) }; }
try { const r = await fetch("https://api.coinpaprika.com/v1/tickers/steem-steem", { signal: AbortSignal.timeout(10000) }); const j = await r.json(); out.steemUsdPaprika = j?.quotes?.USD?.price ?? null; } catch (e) { out.steemUsdPaprika = null; }

/* 4 · DGP for vests conversion + wv2s */
const dyn = await rpc("condenser_api.get_dynamic_global_properties", []).catch((e) => ({ err: String(e).slice(0, 120) }));
out.dyn = { total_vesting_shares: dyn.total_vesting_shares, total_vesting_fund_steem: dyn.total_vesting_fund_steem, recent_claims: dyn.recent_claims ?? null, time: dyn.time };
const acc = await rpc("condenser_api.get_accounts", [[ACC]]).catch((e) => [null]);
out.account = { vesting_shares: acc[0]?.vesting_shares, voting_manabar: acc[0]?.voting_manabar, reward_sbd: acc[0]?.reward_sbd_balance, reward_steem: acc[0]?.reward_steem_balance, reward_vesting: acc[0]?.reward_vesting_balance, sbd_balance: acc[0]?.sbd_balance, balance: acc[0]?.balance };
console.log(JSON.stringify(out, null, 1));
